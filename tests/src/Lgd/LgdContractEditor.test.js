const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');
const LgdDefinitionProvider = require('../../../src/Lgd/LgdDefinitionProvider');
const LgdSemanticTokensProvider = require('../../../src/Lgd/LgdSemanticTokensProvider');

/** @description Creates a recording language service with optional compiler output settings. */
function createService(options = {})
{
    return LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined, () => options);
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

describe('LGD interface and abstract editor contracts', () =>
{
    beforeEach(() => vscode.__reset());

    test('hovers and highlights erased interface and abstract declarations', async () =>
    {
        const source = [
            'interface ILabel { String label(Number value); String name { get; set; } }',
            'abstract class LabelBase : ILabel { abstract String label(Number value); abstract String name { get; set; } }'
        ].join('\n');
        const document = makeTextDocument('file:///workspace/Labels.lgd', source);
        const service = createService();
        const state = await service.openDocument(document);
        expect(state.errors).toEqual([]);
        const provider = LgdHoverProvider.create(service);
        const interfaceHover = await provider.provideHover(document, document.positionAt(source.indexOf('ILabel')));
        const abstractHover = await provider.provideHover(document, document.positionAt(source.indexOf('LabelBase')));
        expect(interfaceHover.contents).toContain('interface ILabel {');
        expect(interfaceHover.contents).toContain('name: String');
        expect(interfaceHover.contents).not.toContain('create(');
        expect(abstractHover.contents).toContain('abstract class LabelBase : ILabel {');
        expect(abstractHover.contents).not.toContain('create(');
        const spans = LgdSemanticTokensProvider.create(service).collectSemanticSpans(source, state);
        const keywords = spans.filter(span => span.tokenType === 'keyword').map(span => source.slice(span.start, span.end));
        expect(keywords).toEqual(expect.arrayContaining([ 'interface', 'abstract', 'class', 'get', 'set' ]));
        const interfaceTypes = spans.filter(span => source.slice(span.start, span.end) === 'ILabel');
        expect(interfaceTypes).toHaveLength(2);
        expect(interfaceTypes.every(span => span.tokenType === 'class')).toBe(true);
        const propertyStart = source.indexOf('String name');
        expect(spans).toContainEqual({ start: propertyStart, end: propertyStart + 'String'.length, tokenType: 'class' });
    });

    test('navigates erased local interfaces from heritage positions', async () =>
    {
        const source = 'interface IEmpty {}\nclass Empty : IEmpty {}';
        const document = makeTextDocument('file:///workspace/Empty.lgd', source);
        const service = createService();
        await service.openDocument(document);
        const definitions = await LgdDefinitionProvider.create(service).provideDefinition(document, document.positionAt(source.lastIndexOf('IEmpty')));
        expect(definitions).toHaveLength(1);
        expect(definitions[0].uri).toEqual(document.uri);
        expect(document.getText(definitions[0].range)).toBe('IEmpty');
    });

    test('uses output settings for the in-memory mirror and changes models on recompile', async () =>
    {
        const options = { javascriptObjectModel: 'class' };
        const document = makeTextDocument('file:///workspace/Counter.lgd', 'class Counter { Counter(Number value) { this.value = value; } }');
        const service = createService(options);
        const state = await service.openDocument(document);
        expect(state.errors).toEqual([]);
        expect(state.jsDocument.getText()).toContain('class Counter');
        options.javascriptObjectModel = 'oloo';
        await service.updateDocument(document);
        expect(state.jsDocument.getText()).toContain('const Counter = {');
    });

    test('refreshes transitive interface contracts without reparsing unchanged imports', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-contract-editor-'));
        const service = createService();
        try
        {
            const root = makeTextDocument(`file://${path.join(directory, 'IRoot.lgd')}`, 'interface IRoot { String label(Number value); }\nmodule.exports = IRoot;');
            await service.openDocument(root);
            await fs.promises.writeFile(path.join(directory, 'IChild.lgd'), 'const IRoot = require("./IRoot.js");\ninterface IChild : IRoot {}\nmodule.exports = IChild;');
            const source = 'const IChild = require("./IChild.js");\nclass Label : IChild { String label(Number value) { return "label"; } }';
            const child = makeTextDocument(`file://${path.join(directory, 'Label.lgd')}`, source);
            const state = await service.openDocument(child);
            await service.pendingDependencyUpdates;
            expect(state.errors).toEqual([]);
            expect(state.externals.get('./IChild.js')).toMatchObject({ kind: 'interface', contractsKnown: true });
            expect(state.jsDocument.getText()).not.toContain('require("./IChild.js")');
            const read = jest.spyOn(fs.promises, 'readFile');
            child.setText(`${source}\n// local edit`);
            await service.updateDocument(child);
            await service.pendingDependencyUpdates;
            expect(read).not.toHaveBeenCalled();
            read.mockRestore();
            root.setText(root.getText().replace('Number value', 'Boolean value'));
            await service.updateDocument(root);
            await service.pendingDependencyUpdates;
            expect(state.errors.some(error => error.message.includes('Boolean'))).toBe(true);
        }
        finally
        {
            await service.pendingDependencyUpdates;
            jest.restoreAllMocks();
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });
});
