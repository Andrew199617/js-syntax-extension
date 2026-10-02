const vscode = require('vscode');
const manifest = require('../../../package.json');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdSemanticTokensProvider = require('../../../src/Lgd/LgdSemanticTokensProvider');

/** @description Uri of the LGD document used across semantic token tests. */
const LGD_URI = 'file:///workspace/Typed.lgd';

/** @description LGD source with typed params and a JSDoc type tag. */
const LGD_TEXT = [
    'readonly Object Commands = {',
    '    findNextChar(vscode.TextDocument document, Number line) {',
    '        return line;',
    '    },',
    '    create() {',
    '        /** @type {vscode.Command} */',
    '        this.command = {};',
    '        return this;',
    '    }',
    '};',
    ''
].join('\n');

/**
 * @description Opens the typed fixture in a fresh language service.
 * @returns {Promise<object>} the service and document.
 */
async function openTypedDocument()
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
    const document = makeTextDocument(LGD_URI, LGD_TEXT);
    await service.openDocument(document);

    return { service: service, document: document };
}

/**
 * @description Reads the token text for one pushed token.
 * @param {object} document the text document.
 * @param {object} token the pushed {range, tokenType} token.
 * @returns {string} the covered text.
 */
function tokenText(document, token)
{
    return document.getText(token.range);
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() =>
{
    vscode.__reset();
});

describe('LgdSemanticTokensProvider', () =>
{
    test('enables LGD semantic tokens by default while leaving theme colors unchanged', () =>
    {
        const defaults = manifest.contributes.configurationDefaults;
        expect(defaults['[lgd]']).toEqual({ 'editor.semanticHighlighting.enabled': true });
        expect(defaults['editor.semanticHighlighting.enabled']).toBeUndefined();
    });

    test('reports class tokens for typed parameter types.', async () =>
    {
        const { service, document } = await openTypedDocument();
        const provider = LgdSemanticTokensProvider.create(service);

        const tokens = await provider.provideDocumentSemanticTokens(document);

        expect(tokens).not.toBeNull();
        const texts = tokens.pushed.map(token => tokenText(document, token));
        expect(texts).toContain('vscode.TextDocument');
        expect(texts).toContain('Number');
        const types = tokens.pushed.filter(token => token.tokenType === 'class');
        expect(types.map(token => tokenText(document, token))).toContain('Number');
        const lineParameter = tokens.pushed.find(token => tokenText(document, token) === 'line');
        expect(lineParameter.tokenType).toBe('parameter');
    });

    test('reports a class token for the JSDoc @type tag.', async () =>
    {
        const { service, document } = await openTypedDocument();
        const provider = LgdSemanticTokensProvider.create(service);

        const tokens = await provider.provideDocumentSemanticTokens(document);

        const texts = tokens.pushed.map(token => tokenText(document, token));
        expect(texts).toContain('vscode.Command');
    });

    test('reports declared return types even when a method has no typed parameters', async () =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, 'class Counter { Number count() { return 1; } void reset() {} }');
        await service.openDocument(document);
        const provider = LgdSemanticTokensProvider.create(service);
        const tokens = await provider.provideDocumentSemanticTokens(document);
        expect(tokens.pushed.map(token => tokenText(document, token))).toEqual([ 'class', 'Counter', 'Number', 'return', 'void' ]);
    });

    test('groups void with async as keywords rather than class/type tokens', async () =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, 'class Command { async void execute() {} void reset() {} }');
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const keywords = tokens.pushed.filter(token => token.tokenType === 'keyword').map(token => tokenText(document, token));
        expect(keywords).toEqual([ 'class', 'async', 'void', 'void' ]);
        expect(tokens.pushed.filter(token => token.tokenType === 'class').map(token => tokenText(document, token))).toEqual(['Command']);
    });

    test('gives constructor and method parameter declarations and references the same role without leaking to properties or shadows', async () =>
    {
        const source = [
            'class Command {',
            '    Command(String commandName) {',
            '        this.commandName = commandName;',
            '        commandName = "next";',
            '        this.read = () => commandName;',
            '        this.text = "commandName"; // commandName stays a comment',
            '        { const commandName = "local"; console.log(commandName); }',
            '    }',
            '    void update(String commandName) { this.commandName = commandName; }',
            '}',
            'Command.'
        ].join('\n');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const parameters = tokens.pushed.filter(token => token.tokenType === 'parameter');
        const offsets = parameters.map(token => document.offsetAt(token.range.start));
        const expectedOffsets = [
            source.indexOf('commandName)'),
            source.indexOf('= commandName;') + '= '.length,
            source.indexOf('commandName = "next"'),
            source.indexOf('=> commandName;') + '=> '.length,
            source.lastIndexOf('commandName)'),
            source.lastIndexOf('= commandName;') + '= '.length
        ];
        expect(offsets).toEqual(expectedOffsets);
        expect(parameters.every(token => tokenText(document, token) === 'commandName')).toBe(true);
    });

    test('retains parameter references at the generated base-call mapping boundary', async () =>
    {
        const source = 'class Base { Base(String commandName) {} }\nclass Derived : Base { Derived(String commandName) : base(commandName) {} }';
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const parameters = tokens.pushed.filter(token => token.tokenType === 'parameter');
        const offsets = parameters.map(token => document.offsetAt(token.range.start));
        expect(offsets).toEqual(Array.from(source.matchAll(/commandName/g), match => match.index));
    });

    test('uses one keyword role for declarations, control flow, operators, modules, and contextual syntax', async () =>
    {
        const source = [
            'import fallback, { item as renamed } from "module";',
            'export const ready = true;',
            'export default async function run(items) {',
            '    let total = 0; var count = 0;',
            '    for (const item of items) { if(item) continue; else total++; }',
            '    for (const key in items) { break; }',
            '    while(total) { break; } do { count++; } while(false);',
            '    try { await fallback(); } catch(error) { debugger; } finally { delete items.value; }',
            '    switch(total) { case 0: return typeof total; default: throw new Error("stop"); }',
            '    return void total;',
            '}',
            'function* values() { yield 1; }',
            'const holder = { get value() { return this.current; }, set value(input) { this.current = input; } };',
            'const Native = class extends Error { static make() { return new this(); } constructor() { super(); } };',
            'if(holder instanceof Object) holder.value = 1;',
            'const target = function() { return new.target; };'
        ].join('\n');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const keywords = new Set(tokens.pushed.filter(token => token.tokenType === 'keyword').map(token => tokenText(document, token)));
        const expected = [ 'import',
            'as',
            'from',
            'export',
            'const',
            'default',
            'async',
            'function',
            'let',
            'var',
            'for',
            'of',
            'in',
            'if',
            'continue',
            'else',
            'break',
            'while',
            'do',
            'try',
            'await',
            'catch',
            'debugger',
            'finally',
            'delete',
            'switch',
            'case',
            'return',
            'typeof',
            'throw',
            'new',
            'void',
            'yield',
            'get',
            'set',
            'this',
            'class',
            'extends',
            'static',
            'super',
            'instanceof' ];
        expect([...keywords].sort()).toEqual(expected.sort());
    });

    test.each([ 'with', 'assert' ])('recognizes the existing JavaScript import %s clause as contextual syntax', async keyword =>
    {
        const source = `import settings from "settings.json" ${keyword} { type: "json" };`;
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const keywords = tokens.pushed.filter(token => token.tokenType === 'keyword').map(token => tokenText(document, token));
        expect(keywords).toEqual([ 'import', 'from', keyword ]);
    });

    test('recognizes JavaScript resource declarations without classifying a same-name identifier', async () =>
    {
        const source = 'async function acquire() { await using resource = open(); }\nconst using = 1;';
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const keywords = tokens.pushed.filter(token => token.tokenType === 'keyword').map(token => tokenText(document, token));
        expect(keywords).toEqual([ 'async', 'function', 'await', 'using', 'const' ]);
    });

    test('restores erased LGD declaration and method keywords from their parsed source spans', async () =>
    {
        const source = [
            'export readonly Number total = 1;',
            'class Base { Base(String name) {} virtual async void run(String name) { await Promise.resolve(); } }',
            'class Derived : Base {',
            '    Derived(String name) : base(name) {}',
            '    override async void run(String name) { await base.run(name); }',
            '}'
        ].join('\n');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        const state = await service.openDocument(document);
        expect(state.errors).toEqual([]);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const keywords = tokens.pushed.filter(token => token.tokenType === 'keyword').map(token => tokenText(document, token));
        expect(keywords).toEqual([ 'export',
            'readonly',
            'class',
            'virtual',
            'async',
            'void',
            'await',
            'class',
            'base',
            'override',
            'async',
            'void',
            'await',
            'base' ]);
    });

    test('does not turn contextual identifiers, property names, literal values, or comment text into keywords', async () =>
    {
        const source = [
            'const words = { class: 1, new: 1, async: 1, await: 1, void: 1, return: 1, virtual: 1, override: 1, readonly: 1, as: 1 };',
            'const async = words.async, from = words.as, virtual = words.virtual;',
            'words.class; words.new; words.return; words.await;',
            'const methods = { async() {}, get() {}, set() {} };',
            'const text = "class virtual new async await void return";',
            'const template = `readonly override await`; // class async return',
            'const pattern = /class|return|await/;',
            'const literals = [true, false, null];'
        ].join('\n');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const keywords = tokens.pushed.filter(token => token.tokenType === 'keyword').map(token => tokenText(document, token));
        expect(keywords.every(word => word === 'const')).toBe(true);
        expect(keywords).toHaveLength(source.split('const ').length - 1);
    });

    test('returns null when the document is not open.', async () =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const provider = LgdSemanticTokensProvider.create(service);
        const document = makeTextDocument(LGD_URI, LGD_TEXT);

        expect(await provider.provideDocumentSemanticTokens(document)).toBeNull();
    });

    test('waits for the first compilation and retains constructor tokens when base arguments are invalid', async () =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const source = 'class Base { Base(String title) {} }\nclass Derived : Base { Derived() : base(42) {} async void reset() {} }';
        const document = makeTextDocument(LGD_URI, source);
        document.version = 1;
        let release;
        const gate = new Promise(resolve =>
        {
            release = resolve;
        });
        vscode.workspace.openTextDocument.mockImplementationOnce(async options =>
        {
            await gate;
            return makeTextDocument('untitled:delayed-mirror', options.content);
        });

        const opening = service.openDocument(document);
        const requested = LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        expect(service.getState(document.uri).declarations).toEqual([]);
        release();
        const tokens = await requested;
        const state = await opening;
        expect(state.errors).toHaveLength(1);
        expect(source.slice(state.errors[0].offset, state.errors[0].endOffset)).toBe('42');
        const names = tokens.pushed.map(token => tokenText(document, token));
        expect(names.filter(name => name === 'Derived')).toHaveLength(2);
        expect(names).toContain('void');
    });

    test.each([ 'canceled', 'changed', 'closed' ])('discards a %s semantic request while compilation is pending', async reason =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument(LGD_URI, 'class Original { Original() {} }');
        document.version = 1;
        let release;
        const gate = new Promise(resolve =>
        {
            release = resolve;
        });
        service.collectExternalTypes = async () =>
        {
            await gate;
            return new Map();
        };

        const cancellation = { isCancellationRequested: false };
        const opening = service.openDocument(document);
        const requested = LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document, cancellation);
        if(reason === 'canceled')
        {
            cancellation.isCancellationRequested = true;
        }
        else if(reason === 'changed')
        {
            document.version++;
            document.setText('class Updated {}');
        }
        else
        {
            service.closeDocument(document);
        }

        release();
        expect(await requested).toBeNull();
        await opening;
    });

    test('does not reuse old tokens after a newer mirror update fails', async () =>
    {
        const { service, document } = await openTypedDocument();
        document.version = 1;
        await service.updateDocument(document);
        document.version++;
        document.setText('class Updated { Updated() {} }');
        vscode.workspace.applyEdit.mockResolvedValueOnce(false);
        await expect(service.updateDocument(document)).rejects.toThrow();
        const provider = LgdSemanticTokensProvider.create(service);
        expect(await provider.provideDocumentSemanticTokens(document)).toBeNull();
    });

    test('exposes class in the legend.', () =>
    {
        expect(LgdSemanticTokensProvider.legend.tokenTypes).toContain('class');
    });
});

test('semantic JSDoc types exclude comment-looking text inside strings and line comments', () =>
{
    const service = LgdLanguageService.create({}, () => undefined);
    const provider = LgdSemanticTokensProvider.create(service);
    const source = [
        'const text = "/** @type {FakeType} */";',
        '// /** @type {CommentedType} */',
        '/** @type {ActualType} */',
        'Object settings = {};'
    ].join('\n');

    expect(provider.collectTypeSpans(source, []).map(span => source.slice(span.start, span.end))).toEqual(['ActualType']);
});
