const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdSemanticTokensProvider = require('../../../src/Lgd/LgdSemanticTokensProvider');
const LgdDefinitionProvider = require('../../../src/Lgd/LgdDefinitionProvider');
const LgdMirrorCompletion = require('../../../src/Lgd/LgdMirrorCompletion');

/** @description Opens a current LGD source and its mapped JavaScript mirror. */
async function openSource(source, options = {})
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined, () => options);
    const document = makeTextDocument('file:///workspace/Arrays.lgd', source);
    const state = await service.openDocument(document);
    return { service: service, document: document, state: state };
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() => vscode.__reset());

describe('LGD postfix array editor evidence', () =>
{
    test('Colors only the named type leaves and navigates array element type references.', async () =>
    {
        const source = 'class Item { Number value = 1; }\nItem[][]? items = null;\nclass Reader { String?[] labels = []; Item[] read(Item[] values) { return values; } }';
        const { service, document, state } = await openSource(source);
        expect(state.errors).toEqual([]);
        const spans = LgdSemanticTokensProvider.create(service).collectTypeSpans(source, state.declarations);
        const annotations = spans.map(span => source.slice(span.start, span.end));
        expect(annotations).toEqual(expect.arrayContaining([ 'Item', 'String', 'Number' ]));
        expect(annotations.some(type => type.includes('[') || type.includes('?'))).toBe(false);
        const offset = source.indexOf('Item[][]?');
        const definitions = await LgdDefinitionProvider.create(service).provideDefinition(document, document.positionAt(offset));
        expect(definitions[0].uri.toString()).toBe(document.uri.toString());
        expect(document.offsetAt(definitions[0].range.start)).toBe(source.indexOf('Item'));
    });

    test.each([ 'const string[] lines = ["one"];\nlines.pu', 'class Item { String label = "one"; }\nItem[] items = [Item.create()];\nitems[0].la' ])('Maps native mirror member completion edits for %s', async source =>
    {
        const { service, document, state } = await openSource(source);
        const position = document.positionAt(source.length);
        const start = source.lastIndexOf('.') + 1;
        const sourceRange = new vscode.Range(document.positionAt(start), position);
        const mirrorRange = new vscode.Range(service.toJsPosition(document.uri, sourceRange.start), service.toJsPosition(document.uri, sourceRange.end));
        const insertion = new vscode.Range(mirrorRange.start, mirrorRange.start);
        const provided = { label: 'member', kind: vscode.CompletionItemKind.Property, range: { inserting: insertion, replacing: mirrorRange },
            textEdit: { range: mirrorRange, newText: 'member' }, additionalTextEdits: [{ range: insertion, newText: '' }], command: { command: 'mirror.action' } };
        const insertReplace = { ...provided, label: 'insertReplace', textEdit: { insert: insertion, replace: mirrorRange, newText: 'member' } };
        vscode.commands.executeCommand.mockResolvedValue({ items: [ provided, insertReplace ] });
        const items = await LgdMirrorCompletion.provide(service, document, position);
        expect(items).toHaveLength(2);
        expect(items[0].range.replacing).toEqual(sourceRange);
        expect(items[0].textEdit.range).toEqual(sourceRange);
        expect(items[0].additionalTextEdits[0].range).toEqual(new vscode.Range(sourceRange.start, sourceRange.start));
        expect(items[0].command).toBeUndefined();
        expect(items[1].textEdit.insert).toEqual(new vscode.Range(sourceRange.start, sourceRange.start));
        expect(items[1].textEdit.replace).toEqual(sourceRange);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.executeCompletionItemProvider', state.jsDocument.uri, service.toJsPosition(document.uri, position));
        expect(provided.textEdit.range).toBe(mirrorRange);
    });

    test('Rejects a result from a replaced mirror after an unchanged-source output-model recompile.', async () =>
    {
        const source = 'class Reader { String[] read(String[] values) { return values; } }\nconst string[] lines = ["one"];\nlines.pu';
        const options = { javascriptObjectModel: 'oloo' };
        const { service, document, state } = await openSource(source, options);
        const previousMap = state.map;
        let finish;
        vscode.commands.executeCommand.mockImplementation(() => new Promise(resolve =>
        {
            finish = resolve;
        }));

        const pending = LgdMirrorCompletion.provide(service, document, document.positionAt(source.length));
        options.javascriptObjectModel = 'class';
        await service.updateDocument(document);
        expect(state.map).not.toBe(previousMap);
        finish({ items: [{ label: 'push' }] });
        expect(await pending).toBeNull();
    });

    test('Rejects generated-comment edits and stale native completion results.', async () =>
    {
        const source = 'const string[] lines = ["one"];\nlines.pu';
        const { service, document, state } = await openSource(source);
        const generated = new vscode.Range(state.jsDocument.positionAt(0), state.jsDocument.positionAt('/** @'.length));
        vscode.commands.executeCommand.mockResolvedValue({ items: [{ label: 'unsafe', textEdit: { range: generated, newText: 'unsafe' } }] });
        expect(await LgdMirrorCompletion.provide(service, document, document.positionAt(source.length))).toEqual([]);
        let finish;
        vscode.commands.executeCommand.mockImplementation(() => new Promise(resolve =>
        {
            finish = resolve;
        }));

        const pending = LgdMirrorCompletion.provide(service, document, document.positionAt(source.length));
        document.setText(source.replace('lines.pu', 'lines.ma'));
        finish({ items: [{ label: 'push' }] });
        expect(await pending).toBeNull();
    });
});
