const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdCompletionProvider = require('../../../src/Lgd/LgdCompletionProvider');

/** @description Opens the marked source and requests completion in its current source text. */
async function complete(source)
{
    const offset = source.indexOf('¦');
    const text = source.replace('¦', '');
    const document = makeTextDocument('file:///workspace/type-completion.lgd', text);
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
    await service.openDocument(document);
    const items = await LgdCompletionProvider.create(service).provideCompletionItems(document, document.positionAt(offset));
    return { items: items, document: document };
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() => vscode.__reset());

describe('LGD type-space completion', () =>
{
    test.each([
        'Object¦ match = textLine.match(/=(\\s*)/);',
        'Reg¦ match = textLine.match(/=(\\s*)/);',
        'const Reg¦ match = textLine.match(/=/);',
        'Function work = (Reg¦ value) => value;',
        'Function work = function(Reg¦ value) { return value; };',
        'Object worker = { Reg¦ run(String value) { return value.match(/=/); } };',
        'Object worker = { run(Reg¦ value) { return value; } };',
        'class Worker {\n Reg¦ value;\n}',
        'class Worker {\n static Reg¦ value;\n}',
        'class Worker {\n Worker(Reg¦ value) {}\n}',
        'class Worker {\n run(¦) {}\n}',
        'class Worker {\n Worker(¦) {}\n}',
        'Object worker = { run(¦) {} };',
        'Function work = (¦) => null;',
        'const value = (¦) unknownValue;',
        'class Worker {\n Reg¦ run() { return null; }\n}',
        'interface Worker {\n Reg¦ run();\n}',
        'interface Worker {\n Reg¦ value { get; set; }\n}',
        'const value = (Reg¦) unknownValue;',
        'class Worker : Reg¦ {}',
        'Reg¦',
        'Function work = (Reg¦) => null;'
    ])('completes standard-library types at a supported type slot: %s', async source =>
    {
        const input = source.replace('Object¦', '¦Object');
        const { items } = await complete(input);
        expect(items.some(item => item.label === 'RegExpMatchArray')).toBe(true);
        expect(items.find(item => item.label === 'RegExpMatchArray').kind).toBe(vscode.CompletionItemKind.Interface);
        expect(items.map(item => item.label)).toEqual([...new Set(items.map(item => item.label))]);
    });

    test.each([
        'const match = Reg¦;',
        'consume(Reg¦);',
        'if(Reg¦) {}',
        'Object worker = { value: Reg¦ };',
        'String text = "Reg¦";',
        '// Reg¦',
        '/* Reg¦ */',
        'const expression = /Reg¦/;',
        'RegExpMatchArray match¦ = textLine.match(/=/);',
        'return Reg¦;',
        'class Reg¦ {}'
    ])('keeps value/name/literal contexts out of type completion: %s', async source =>
    {
        const { items } = await complete(source);
        expect(items).toBeNull();
    });

    test('uses a source replacement range and preserves nullable/array suffixes', async () =>
    {
        const { items, document } = await complete('Reg¦ExpMatchArray?[] values = [];');
        const item = items.find(candidate => candidate.label === 'RegExpMatchArray');
        expect(document.getText(item.range)).toBe('RegExpMatchArray');
        expect(item.insertText).toBe('RegExpMatchArray');
        expect(item.filterText).toBe('RegExpMatchArray');
    });

    test('includes lowercase aliases, local types, and return-only void with their kinds', async () =>
    {
        const { items } = await complete('class Result {}\ninterface IResult {}\nObject worker = { ¦Object run() { return null; } };');
        expect(items.find(item => item.label === 'Result').kind).toBe(vscode.CompletionItemKind.Class);
        expect(items.find(item => item.label === 'IResult').kind).toBe(vscode.CompletionItemKind.Interface);
        expect(items.find(item => item.label === 'string').kind).toBe(vscode.CompletionItemKind.Keyword);
        expect(items.find(item => item.label === 'void').kind).toBe(vscode.CompletionItemKind.Keyword);
    });

    test('keeps visible local types available in an empty type slot at end of file', async () =>
    {
        const { items } = await complete('class Result {}\n¦');
        expect(items.find(item => item.label === 'Result').kind).toBe(vscode.CompletionItemKind.Class);
    });

    test('does not leak block-local types into another scope', async () =>
    {
        const { items } = await complete('{\n class Hidden {}\n}\n¦Object value = null;');
        expect(items.some(item => item.label === 'Hidden')).toBe(false);
        expect(items.some(item => item.label === 'void')).toBe(false);
        expect(items.some(item => item.label === 'window')).toBe(false);
    });

    test('completes only real local import aliases and namespace type exports', async () =>
    {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lgd-type-imports-'));
        try
        {
            await fs.writeFile(path.join(directory, 'Types.lgd'), 'export class Result {}\nexport interface IResult {}\nexport String value = "ordinary";');
            const source = 'import { Result as Alias, IResult } from "./Types";\nimport * as kinds from "./Types";\n¦Object value = null;';
            const document = makeTextDocument(`file://${path.join(directory, 'Consumer.lgd')}`, source.replace('¦', ''));
            const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
            await service.openDocument(document);
            const provider = LgdCompletionProvider.create(service);
            const items = await provider.provideCompletionItems(document, document.positionAt(source.indexOf('¦')));
            expect(items.find(item => item.label === 'Alias').kind).toBe(vscode.CompletionItemKind.Class);
            expect(items.find(item => item.label === 'IResult').kind).toBe(vscode.CompletionItemKind.Interface);
            expect(items.find(item => item.label === 'kinds').kind).toBe(vscode.CompletionItemKind.Module);
            expect(items.some(item => item.label === 'Result')).toBe(false);
            expect(items.some(item => item.label === 'as')).toBe(false);

            const qualified = source.replace('¦Object', 'kinds.¦');
            document.setText(qualified.replace('¦', ''));
            await service.updateDocument(document);
            const members = await provider.provideCompletionItems(document, document.positionAt(qualified.indexOf('¦')));
            expect(members.map(item => item.label)).toEqual([ 'IResult', 'Result' ]);

            const shadowed = `${source.slice(0, source.indexOf('¦'))}Function run = (Object kinds) => {\n kinds.¦Result value = null;\n};`;
            document.setText(shadowed.replace('¦', ''));
            await service.updateDocument(document);
            const hidden = await provider.provideCompletionItems(document, document.positionAt(shadowed.indexOf('¦')));
            expect(hidden).toEqual([]);
        }
        finally
        {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    test.each([ 'import { Item as Entry } from "./Types";\nEntry', 'import * as types from "./Types";\ntypes.Item' ])('retains imported array type checks: %s', async imported =>
    {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lgd-imported-array-'));
        try
        {
            await fs.writeFile(path.join(directory, 'Types.lgd'), 'export class Item { Number score = 1; Item() {} }');
            const name = imported.slice(imported.lastIndexOf('\n') + 1);
            const source = `${imported}[] items = [${name}.create()];\nString wrong = items[0].score;`;
            const document = makeTextDocument(`file://${path.join(directory, 'Consumer.lgd')}`, source);
            const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
            const state = await service.openDocument(document);
            expect(state.errors).toEqual([expect.objectContaining({ message: 'Cannot assign Number to String.' })]);
        }
        finally
        {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    test('uses installed declarations for an explicit imported namespace without inventing package types', async () =>
    {
        const source = 'import vscode from "vscode";\nvscode.¦Position position = opaqueCall();';
        const document = makeTextDocument(`file://${path.join(__dirname, 'Consumer.lgd')}`, source.replace('¦', ''));
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const state = await service.openDocument(document);
        expect(state.errors).toEqual([]);
        const items = await LgdCompletionProvider.create(service).provideCompletionItems(document, document.positionAt(source.indexOf('¦')));
        expect(items.find(item => item.label === 'Position').kind).toBe(vscode.CompletionItemKind.Class);
        expect(items.some(item => item.label === 'window')).toBe(false);
        expect(items.some(item => item.label === 'showInformationMessage')).toBe(false);
    });

    test.each([ '(vscode.Position) raw', '(vscode.Position)(raw)', '(vscode.Position?) (raw)' ])('erases a known imported type assertion with a grouped operand: %s', async expression =>
    {
        const source = `import vscode from "vscode";\nObject raw = opaqueCall();\nvscode.Position? converted = ${expression};`;
        const document = makeTextDocument(`file://${path.join(__dirname, 'Consumer.lgd')}`, source);
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const state = await service.openDocument(document);
        expect(state.errors).toEqual([]);
        expect(state.casts).toHaveLength(1);
        expect(state.casts[0].known).toBeTruthy();
        expect(state.jsDocument.getText()).not.toContain('Position)(raw)');
        expect(state.jsDocument.getText()).toContain('converted = ');
        expect(state.jsDocument.getText()).not.toContain('converted = (vscode.Position');
    });

    test('preserves ordinary grouped member calls when a parameter shadows an imported namespace', async () =>
    {
        const source = 'import vscode from "vscode";\nFunction read = (Object vscode, raw) => {\n const value = (vscode.Position)(raw);\n};';
        const document = makeTextDocument(`file://${path.join(__dirname, 'Consumer.lgd')}`, source);
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const state = await service.openDocument(document);
        expect(state.errors).toEqual([]);
        expect(state.casts).toEqual([]);
        expect(state.jsDocument.getText()).toContain('(vscode.Position)(raw)');
    });

    test('completes a cast type inside an executable template interpolation', async () =>
    {
        const { items } = await complete(`String label = \`\${(Reg¦)raw}\`;`);
        expect(items.find(item => item.label === 'RegExpMatchArray').kind).toBe(vscode.CompletionItemKind.Interface);
    });

    test('keeps existing this-member completion inside an executable template interpolation', async () =>
    {
        const source = `Object writer = { title: "ready", Read() { return \`\${this.¦}\`; } };`;
        const { items } = await complete(source);
        expect(items.map(item => item.label)).toEqual([ 'title', 'Read' ]);
    });

    test.each([ 'String label = `Reg¦`;', `String label = \`\${Reg¦}\`;`, 'String label = "(Reg¦)";', '/* (Reg¦) */' ])('keeps non-code template text and plain interpolation values out of type completion: %s', async source =>
    {
        const { items } = await complete(source);
        expect(items).toBeNull();
    });

    test('respects a value shadow inside an executable template cast-type slot', async () =>
    {
        const source = `const RegExpMatchArray = 42;\nString label = \`\${(RegExpMatchArray¦)raw}\`;`;
        const { items } = await complete(source);
        expect(items.some(item => item.label === 'RegExpMatchArray')).toBe(false);
    });

    test('an ordinary shadowing value does not masquerade as an ambient type', async () =>
    {
        const source = 'const RegExpMatchArray = 42;\n¦Object value = null;';
        const { items } = await complete(source);
        expect(items.some(item => item.label === 'RegExpMatchArray')).toBe(false);
    });

    test('omits removed local types and recovers added types before asynchronous recompilation', async () =>
    {
        const document = makeTextDocument('file:///workspace/type-completion.lgd', 'class Result {}\nObject value = null;');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        await service.openDocument(document);
        const provider = LgdCompletionProvider.create(service);
        document.setText('Res');
        const removed = await provider.provideCompletionItems(document, document.positionAt('Res'.length));
        expect(removed.some(item => item.label === 'Result')).toBe(false);
        document.setText('class Fresh {}\nFre');
        const added = await provider.provideCompletionItems(document, document.positionAt(document.getText().length));
        expect(added.find(item => item.label === 'Fresh').kind).toBe(vscode.CompletionItemKind.Class);
        expect(added.some(item => item.label === 'Result')).toBe(false);
    });

    test('uses the current document after a partial edit with stale compiled state', async () =>
    {
        const document = makeTextDocument('file:///workspace/type-completion.lgd', 'Object match = null;');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        await service.openDocument(document);
        document.setText('Reg match = textLine.match(/=/);');
        const items = await LgdCompletionProvider.create(service).provideCompletionItems(document, document.positionAt('Reg'.length));
        expect(items.some(item => item.label === 'RegExpMatchArray')).toBe(true);
    });
});
