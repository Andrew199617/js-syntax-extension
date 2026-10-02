const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdDefinitionProvider = require('../../../src/Lgd/LgdDefinitionProvider');
const LgdReferenceProvider = require('../../../src/Lgd/LgdReferenceProvider');

/** @description An exported LGD declaration with a comment before its source name. */
const exportedText = '// Exported source\r\nreadonly Object Widget = { run() {} };\r\nmodule.exports = Widget;\r\n';
let directory;

/**
 * @description Opens a source document with one relative import in a fresh service.
 * @param {string} spec the relative require path.
 * @param {string} suffix the source after the import declaration.
 * @returns {Promise<object>} the source document, state, and service.
 */
async function openImport(spec, suffix)
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
    const source = `readonly Object Imported = require('${spec}');\r\n${suffix}`;
    const document = makeTextDocument(`file://${path.join(directory, 'Main.lgd')}`, source);
    const state = await service.openDocument(document);
    return { service: service, document: document, state: state };
}

/**
 * @description Builds an exact source range for the first occurrence of a word.
 * @param {object} document the source or mirror document.
 * @param {string} word the requested word.
 * @returns {object} the word range.
 */
function wordRange(document, word)
{
    const start = document.getText().indexOf(word);
    return new vscode.Range(document.positionAt(start), document.positionAt(start + word.length));
}

jest.mock('vscode', () =>
{
    const fake = require('./fakeVscode');

    const api = fake.createFakeVscode(jest);
    api.Uri = { file: filePath => fake.makeTextDocument(`file://${filePath}`, '').uri };
    return api;
});

beforeEach(async () =>
{
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-definition-'));
    await fs.promises.writeFile(path.join(directory, 'Widget.lgd'), exportedText);
    vscode.__reset();
    vscode.commands.executeCommand.mockReset();
    vscode.commands.executeCommand.mockResolvedValue([]);
});

afterEach(async () =>
{
    await fs.promises.rm(directory, { recursive: true, force: true });
});

describe('LGD cross-file definitions', () =>
{
    test.each([ './Widget.js', './Widget.lgd.js', './Widget.lgd', './Widget' ])('resolves %s value references to the exported source name without a JS result', async spec =>
    {
        const { service, document } = await openImport(spec, 'Imported.run();\r\n');
        const provider = LgdDefinitionProvider.create(service);
        const source = makeTextDocument(`file://${path.join(directory, 'Widget.lgd')}`, exportedText);

        const result = await provider.provideDefinition(document, document.positionAt(document.getText().lastIndexOf('Imported')));

        expect(result).toEqual([{ uri: expect.objectContaining({ fsPath: source.uri.fsPath }), range: wordRange(source, 'Widget') }]);
    });

    test('resolves imported type names, including typed function parameters', async () =>
    {
        const suffix = 'Imported instance = Imported;\r\nFunction accept = (Imported input) => input;\r\nObject receiver = { accept(Imported value) {} };';
        const { service, document } = await openImport('./Widget.js', suffix);
        const provider = LgdDefinitionProvider.create(service);
        const source = makeTextDocument(`file://${path.join(directory, 'Widget.lgd')}`, exportedText);
        const expected = [{ uri: expect.objectContaining({ fsPath: source.uri.fsPath }), range: wordRange(source, 'Widget') }];

        const declarationType = await provider.provideDefinition(document, document.positionAt(document.getText().indexOf('Imported instance')));
        const parameterType = await provider.provideDefinition(document, document.positionAt(document.getText().indexOf('Imported input')));
        const methodType = await provider.provideDefinition(document, document.positionAt(document.getText().indexOf('Imported value')));

        expect(declarationType).toEqual(expected);
        expect(parameterType).toEqual(expected);
        expect(methodType).toEqual(expected);
    });

    test('resolves the imported binding declaration and plain JavaScript require bindings', async () =>
    {
        const { service, document } = await openImport('./Widget.js', 'const Alias = require("./Widget.js");\r\nAlias.run();');
        const provider = LgdDefinitionProvider.create(service);
        const targetPath = path.join(directory, 'Widget.lgd');

        const declared = await provider.provideDefinition(document, wordRange(document, 'Imported').start);
        const used = await provider.provideDefinition(document, document.positionAt(document.getText().lastIndexOf('Alias')));

        expect(declared[0].uri.fsPath).toBe(targetPath);
        expect(used[0].uri.fsPath).toBe(targetPath);
    });

    test('leaves the built-in result intact while the mirror has an incomplete edit', async () =>
    {
        const { service, document, state } = await openImport('./Widget.js', 'Imported.run();\r\nfunction unfinished(');
        const local = new vscode.Location(state.jsDocument.uri, wordRange(state.jsDocument, 'Imported'));
        vscode.commands.executeCommand.mockResolvedValue([local]);

        const result = await LgdDefinitionProvider.create(service).provideDefinition(document, document.positionAt(document.getText().lastIndexOf('Imported')));

        expect(result).toEqual([new vscode.Location(document.uri, wordRange(document, 'Imported'))]);
    });

    test('uses unsaved exported source names and positions rather than the disk version', async () =>
    {
        const { service, document } = await openImport('./Widget.js', 'Imported.run();\r\n');
        const changed = '// Unsaved changes\r\n\r\nObject Updated = { run() {} };\r\nmodule.exports = Updated;\r\n';
        const target = makeTextDocument(`file://${path.join(directory, 'Widget.lgd')}`, changed);
        await service.openDocument(target);
        const provider = LgdDefinitionProvider.create(service);

        const result = await provider.provideDefinition(document, document.positionAt(document.getText().lastIndexOf('Imported')));

        expect(result).toEqual([{ uri: expect.objectContaining({ fsPath: target.uri.fsPath }), range: wordRange(target, 'Updated') }]);
    });

    test.each([
        'function run(Imported) { return Imported; }',
        '{\r\nNumber Imported = 1;\r\nImported;\r\n}',
        'function run(require) { const Local = require("./Widget.js"); return Local; }',
        'const other = { Imported: 1 }; other.Imported;',
        '// Imported',
        'const label = "Imported";'
    ])('does not redirect shadowed bindings or non-reference text: %s', async suffix =>
    {
        const { service, document } = await openImport('./Widget.js', suffix);
        const provider = LgdDefinitionProvider.create(service);

        const result = await provider.provideDefinition(document, document.positionAt(document.getText().lastIndexOf(suffix.includes('return Local') ? 'Local' : 'Imported')));

        expect(result).toEqual([]);
    });

    test('does not treat an attached source docblock as an imported binding reference', async () =>
    {
        const suffix = '/** Local documentation */\r\nreadonly Object Local = require("./Widget.js");';
        const { service, document } = await openImport('./Widget.js', suffix);
        const position = document.positionAt(document.getText().indexOf('Local documentation'));

        const result = await LgdDefinitionProvider.create(service).provideDefinition(document, position);

        expect(result).toEqual([]);
    });

    test('keeps ordinary JS definition links when no LGD export exists', async () =>
    {
        const { service, document } = await openImport('./Plain.js', 'Imported.run();\r\n');
        const target = makeTextDocument('file:///library/Plain.js', 'const Native = {};');
        const selection = wordRange(target, 'Native');
        const link = { targetUri: target.uri, targetRange: wordRange(target, 'const Native'), targetSelectionRange: selection };
        vscode.commands.executeCommand.mockResolvedValue([link]);

        const result = await LgdDefinitionProvider.create(service).provideDefinition(document, document.positionAt(document.getText().lastIndexOf('Imported')));

        expect(result).toEqual([new vscode.Location(target.uri, selection)]);
    });

    test('maps another known mirror and preserves library definition and reference locations', async () =>
    {
        const { service, document } = await openImport('./Widget.js', 'Number local = 0;\r\nlocal;');
        const target = makeTextDocument(`file://${path.join(directory, 'Other.lgd')}`, 'Number external = 1;');
        const targetState = await service.openDocument(target);
        const library = makeTextDocument('file:///library/types.d.ts', 'declare const external: number;');
        const returned = [
            new vscode.Location(targetState.jsDocument.uri, wordRange(targetState.jsDocument, 'external')),
            new vscode.Location(library.uri, wordRange(library, 'external'))
        ];
        vscode.commands.executeCommand.mockResolvedValue(returned);
        const expected = [ new vscode.Location(target.uri, wordRange(target, 'external')), returned[1] ];
        const position = document.positionAt(document.getText().lastIndexOf('local'));

        const definitions = await LgdDefinitionProvider.create(service).provideDefinition(document, position);
        const references = await LgdReferenceProvider.create(service).provideReferences(document, position, { includeDeclaration: true });

        expect(definitions).toEqual(expected);
        expect(references).toEqual(expected);
    });
});
