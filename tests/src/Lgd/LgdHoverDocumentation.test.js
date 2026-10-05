const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const typescript = require('typescript-test-5-9');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');
const LgdHoverDocumentation = require('../../../src/Lgd/LgdHoverDocumentation');

/** @description Makes the built-in provider's separate signature and documentation Markdown entries. */
function hoverContents(signature, documentation)
{
    return [ new vscode.MarkdownString(`\n\`\`\`typescript\n${signature}\n\`\`\`\n`), new vscode.MarkdownString(documentation) ];
}

/** @description Reads actual TypeScript QuickInfo from a compiled JavaScript mirror without modifying it. */
function nativeQuickInfo(mirror, offset, dependencies = {})
{
    const fileName = path.resolve(__dirname, 'hover-mirror.js');
    const sources = new Map([ [ fileName, mirror.getText() ], ...Object.entries(dependencies) ]);
    const host = {
        getScriptFileNames: () => [...sources.keys()],
        getScriptVersion: () => '0',

        /** @description Reads the mirror and explicitly provided dependencies without a disk fallback. */
        getScriptSnapshot: name =>
        {
            const contents = sources.get(name);
            if(contents !== undefined)
            {
                return typescript.ScriptSnapshot.fromString(contents);
            }
        },
        getCurrentDirectory: () => __dirname,
        getCompilationSettings: () => ({ allowJs: true, checkJs: true, noLib: true, strictNullChecks: true }),
        getDefaultLibFileName: () => '',
        fileExists: name => sources.has(name),
        readFile: name => sources.get(name)
    };
    const service = typescript.createLanguageService(host);
    try
    {
        return service.getQuickInfoAtPosition(fileName, offset);
    }
    finally
    {
        service.dispose();
    }
}

/** @description Renders the native tag form verified against the installed TypeScript extension. */
function renderNativeHover(mirror, position, dependencies)
{
    const offset = mirror.offsetAt(position);
    const info = nativeQuickInfo(mirror, offset, dependencies);
    const description = typescript.displayPartsToString(info.documentation);
    const tags = (info.tags || []).map(tag => `*@${tag.name}* — ${typescript.displayPartsToString(tag.text)}`);
    const documentation = [ description, ...tags ].filter(Boolean).join('  \n\n');
    const range = new vscode.Range(mirror.positionAt(info.textSpan.start), mirror.positionAt(info.textSpan.start + info.textSpan.length));
    return { contents: hoverContents(typescript.displayPartsToString(info.displayParts), documentation), range: range };
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() =>
{
    vscode.__reset();
    vscode.commands.executeCommand.mockReset();
});

describe('Redundant LGD hover type documentation', () =>
{
    test.each([ 'number', 'string', 'boolean', 'bigint', 'symbol' ])('removes the pure duplicate primitive %s tag', type =>
    {
        const signature = { language: 'typescript', value: `const value: ${type}` };
        const contents = [ signature, { value: `*@type* — {${type}}` } ];
        const filtered = LgdHoverDocumentation.deduplicate(contents);
        expect(filtered).toEqual([signature]);
        expect(filtered[0]).toBe(signature);
        expect(contents).toHaveLength(2);
    });

    test('retains prose, other tags, Markdown metadata and the original objects', () =>
    {
        const contents = hoverContents('const currentLine: number', 'Current editor line.\n\n*@type* — {number}  \n\n*@see* — position.line  \n\n*@deprecated* — Use the current editor position.');
        contents[1] = { value: contents[1].value };
        Object.setPrototypeOf(contents[1], null);
        Object.assign(contents[1], { baseUri: { path: '/docs/' }, isTrusted: { enabledCommands: ['openLink'] }, supportHtml: true, supportThemeIcons: true });
        Object.freeze(contents[1]);
        const filtered = LgdHoverDocumentation.deduplicate(contents);
        expect(filtered[0]).toBe(contents[0]);
        expect(filtered[1].value).toBe('Current editor line.\n\n*@see* — position.line  \n\n*@deprecated* — Use the current editor position.');
        expect(filtered[1]).toBeInstanceOf(vscode.MarkdownString);
        expect(filtered[1].baseUri).toBe(contents[1].baseUri);
        expect(filtered[1].isTrusted).toBe(contents[1].isTrusted);
        expect(filtered[1].supportHtml).toBe(true);
        expect(filtered[1].supportThemeIcons).toBe(true);
        expect(contents[1].value).toContain('*@type*');
    });

    test('constructs usable MarkdownString instances with private accessor state and unchanged native metadata', () =>
    {
        const documentation = new vscode.MarkdownString('Current editor line.\n\n*@type* — {number}\n\n*@see* — position.line\n\n*@deprecated* — Use the current editor position.', true);
        documentation.isTrusted = { enabledCommands: ['openLink'] };
        documentation.baseUri = { path: '/docs/' };
        documentation.supportHtml = true;
        documentation.supportAlertSyntax = true;
        Object.freeze(documentation);
        const signature = new vscode.MarkdownString('```typescript\nconst currentLine: number\n```');
        const contents = [ signature, documentation ];

        const invalidClone = Object.create(Object.getPrototypeOf(documentation));
        expect(() =>
        {
            invalidClone.value = 'Invalid backing state';
        }).toThrow(TypeError);

        expect(Object.keys(documentation)).toEqual([]);

        const filtered = LgdHoverDocumentation.deduplicate(contents);
        expect(filtered[0]).toBe(signature);
        expect(filtered[1]).toBeInstanceOf(vscode.MarkdownString);
        expect(filtered[1]).not.toBe(documentation);
        expect(filtered[1].value).toBe('Current editor line.\n\n*@see* — position.line\n\n*@deprecated* — Use the current editor position.');
        expect(filtered[1].isTrusted).toBe(documentation.isTrusted);
        expect(filtered[1].baseUri).toBe(documentation.baseUri);
        expect(filtered[1].supportHtml).toBe(true);
        expect(filtered[1].supportThemeIcons).toBe(true);
        expect(filtered[1].supportAlertSyntax).toBe(true);
        filtered[1].appendMarkdown('\nAdditional replacement text.');
        expect(filtered[1].value).toContain('Additional replacement text.');
        expect(documentation.value).not.toContain('Additional replacement text.');
        expect(documentation.value).toContain('*@type* — {number}');
    });

    test.each([
        [ 'number | null', '(null | number)' ],
        [ 'number | string', 'string|number' ],
        [ 'Promise<number | null>', 'Promise<(null|number)>' ],
        [ 'Geometry.Point', 'Geometry.Point' ]
    ])('compares only structurally equivalent concrete types %s and %s', (signatureType, tagType) =>
    {
        const contents = hoverContents(`let value: ${signatureType}`, `*@type* — {${tagType}}`);
        expect(LgdHoverDocumentation.deduplicate(contents)).toEqual([contents[0]]);
    });

    test.each([
        [ 'number', 'string' ],
        [ 'any', 'number' ],
        [ 'any', 'any' ],
        [ 'unknown', 'unknown' ],
        [ 'number', 'number | null' ],
        [ 'number | null', '?number' ],
        [ 'Promise<number>', 'Promise<string>' ],
        [ 'number', 'LineNumber' ],
        [ 'Geometry.Point', 'Other.Point' ],
        [ 'number[]', 'Array.<number>' ],
        [ 'number', 'number /* explanation */' ],
        [ '{ line: number }', '{ line: number }' ]
    ])('keeps unequal or uncertain types %s and %s', (signatureType, tagType) =>
    {
        const contents = hoverContents(`const value: ${signatureType}`, `*@type* — {${tagType}}`);
        expect(LgdHoverDocumentation.deduplicate(contents)).toBe(contents);
    });

    test.each([
        '*@type* — {number} — Counts visible lines.',
        '*@type* — {number}\nCounts visible lines.',
        '*@example*  \n```text\n\n*@type* — {number}\n\n```',
        '    *@type* — {number}',
        '> *@type* — {number}'
    ])('keeps authored explanations and examples: %s', documentation =>
    {
        const contents = hoverContents('const value: number', documentation);
        expect(LgdHoverDocumentation.deduplicate(contents)).toBe(contents);
    });

    test('keeps authored JSDoc without a concrete visible signature', () =>
    {
        const contents = [{ value: '*@type* — {number}' }];
        expect(LgdHoverDocumentation.deduplicate(contents)).toBe(contents);
        const method = hoverContents('function read(): number', '*@type* — {number}');
        expect(LgdHoverDocumentation.deduplicate(method)).toBe(method);
    });

    test('cleans one combined Markdown entry without treating code samples as tags', () =>
    {
        const text = '```typescript\nconst value: number\n```\n\n*@type* — {number}\n\nExplanation.';
        expect(LgdHoverDocumentation.deduplicate(text)).toBe('```typescript\nconst value: number\n```\n\nExplanation.');
    });

    test('handles native imported-constant and property signatures conservatively', () =>
    {
        for(const signature of [ '(alias) const value: Geometry.Point\nimport value', '(property) Geometry.value: Geometry.Point' ])
        {
            const contents = hoverContents(signature, '*@type* — {Geometry.Point}');
            expect(LgdHoverDocumentation.deduplicate(contents)).toEqual([contents[0]]);
            const alias = hoverContents(signature, '*@type* — {PointAlias}');
            expect(LgdHoverDocumentation.deduplicate(alias)).toBe(alias);
        }
    });

    test('preserves import context and source documentation on an actual imported constant reference', async () =>
    {
        const source = 'import { currentLine } from "./lines.js";\ncurrentLine;';
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument('file:///workspace/examples/ImportedHover.lgd', source);
        const state = await service.openDocument(document);
        const dependencies = { [path.resolve(__dirname, 'lines.js')]: '/** Current imported line.\n * @type {number}\n * @see editor.line\n */\nexport const currentLine = 7;' };
        let nativeHover;
        vscode.commands.executeCommand.mockImplementation((command, uri, position) =>
        {
            nativeHover = renderNativeHover(state.jsDocument, position, dependencies);
            return [nativeHover];
        });

        const hover = await LgdHoverProvider.create(service).provideHover(document, document.positionAt(source.lastIndexOf('currentLine')));
        const text = hover.contents.map(entry => entry.value).join('\n');
        expect(text).toContain('(alias) const currentLine: number\nimport currentLine');
        expect(text).toContain('Current imported line.');
        expect(text).toContain('*@see* — editor.line');
        expect(text).not.toContain('*@type*');
        expect(nativeHover.contents[1].value).toContain('*@type* — {number}');
        expect(document.getText(hover.range)).toBe('currentLine');
    });

    test('deduplicates actual mirror QuickInfo at declarations and references without changing source, generated annotations or ranges', async () =>
    {
        const source = await fs.promises.readFile(path.join(__dirname, '../../fixtures/redundant-type-hover.lgd'), 'utf8');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument('file:///workspace/examples/Hover.lgd', source);
        const state = await service.openDocument(document);
        const beforeMirror = state.jsDocument.getText();
        const provider = LgdHoverProvider.create(service);
        const nativeHovers = [];
        vscode.commands.executeCommand.mockImplementation((command, uri, position) =>
        {
            expect(command).toBe('vscode.executeHoverProvider');
            expect(uri).toBe(state.jsDocument.uri);
            const nativeHover = renderNativeHover(state.jsDocument, position);
            nativeHovers.push(nativeHover);
            return [nativeHover];
        });

        for(const name of [ 'currentLine', 'documentedLine' ])
        {
            for(const offset of [ source.indexOf(name), source.lastIndexOf(name) ])
            {
                const hover = await provider.provideHover(document, document.positionAt(offset));
                const text = hover.contents.map(entry => entry.value).join('\n');
                expect(text).toContain(`const ${name}: number`);
                expect(text).not.toContain('*@type*');
                expect(document.getText(hover.range)).toBe(name);
                if(name === 'documentedLine')
                {
                    expect(text).toContain('Current editor line.');
                    expect(text).toContain('*@see* — position.line');
                    expect(text).toContain('*@deprecated* — Use the current editor position.');
                }
            }
        }

        expect(nativeHovers.every(hover => hover.contents[1].value.includes('*@type* — {number}'))).toBe(true);
        expect(document.getText()).toBe(source);
        expect(state.jsDocument.getText()).toBe(beforeMirror);
        expect(beforeMirror).toContain('/** @type {number} */');
        expect(beforeMirror).toContain(' * @type {number}');
    });
});
