const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdCompletionProvider = require('../../../src/Lgd/LgdCompletionProvider');
const LgdDefinitionProvider = require('../../../src/Lgd/LgdDefinitionProvider');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');
const LgdClassMemberLookup = require('../../../src/Lgd/LgdClassMemberLookup');

/** @description Opens a source in a recording editor service. */
async function openSource(source, options = {})
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined, () => options);
    const document = makeTextDocument('file:///workspace/Fields.lgd', source);
    const state = await service.openDocument(document);
    return { service: service, document: document, state: state };
}

/** @description Complete field and method metadata used to inspect different receiver completions. */
const SOURCE = [
    'class Sample {',
    '    Number value = 1;',
    '    static Number total = 0;',
    '    Number read() { return this.value; }',
    '    static Number next() { return Sample.total; }',
    '}',
    'Sample item = Sample.create();'
].join('\n');

jest.mock('vscode', () =>
{
    const fake = require('./fakeVscode');

    const api = fake.createFakeVscode(jest);
    api.Uri = { file: filePath => fake.makeTextDocument(`file://${filePath}`, '').uri };
    return api;
});

beforeEach(() => vscode.__reset());

describe('LGD declared field editor metadata', () =>
{
    test('Separates type and instance completions and keeps exact field details.', async () =>
    {
        const typed = await openSource(`${SOURCE}\nSample.`);
        const typeItems = await LgdCompletionProvider.create(typed.service).provideCompletionItems(typed.document, typed.document.positionAt(typed.document.getText().length));
        expect(typeItems.map(item => item.label)).toEqual([ 'create', 'total', 'next' ]);
        const instance = await openSource(`${SOURCE}\nitem.`);
        const instancePosition = instance.document.positionAt(instance.document.getText().length);
        const instanceItems = await LgdCompletionProvider.create(instance.service).provideCompletionItems(instance.document, instancePosition);
        expect(instanceItems.map(item => item.label)).toEqual([ 'value', 'read' ]);
        const offset = SOURCE.indexOf('this.value') + 'this.'.length;
        const detail = instance.service.getThisMemberDetail(instance.document, instance.document.positionAt(offset), 'value');
        expect(detail).toMatchObject({ name: 'value', kind: 'field', typeName: 'Number', static: false });
        const staticOffset = SOURCE.indexOf('Sample.total') + 'Sample.'.length;
        expect(instance.service.getThisMembers(instance.document, instance.document.positionAt(staticOffset))).toEqual([]);
    });

    test('Navigates local typed instance and static fields to their declared names.', async () =>
    {
        const { service, document } = await openSource(`${SOURCE}\nitem.value;\nSample.total;`);
        const provider = LgdDefinitionProvider.create(service);
        for(const name of [ 'value', 'total' ])
        {
            const access = document.getText().lastIndexOf(`.${name}`) + 1;
            const result = await provider.provideDefinition(document, document.positionAt(access));
            expect(result[0].uri.toString()).toBe(document.uri.toString());
            expect(document.getText(result[0].range)).toBe(name);
            expect(document.offsetAt(result[0].range.start)).toBe(SOURCE.indexOf(`${name} =`));
        }
    });

    test('Refreshes inherited field types and static receiver rules across an import chain.', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-declared-fields-'));
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        function document(name, source)
        {
            return makeTextDocument(`file://${path.join(directory, name)}`, source);
        }

        const rootSource = 'class Root { String value = "old"; static Number total = 0; }\nmodule.exports = Root;';
        const root = document('Root.lgd', rootSource);
        const consumer = document('Consumer.lgd', [
            'const Remote = require("./Middle.js");',
            'class Consumer { Number read(Remote item) { return item.value; } }',
            'Remote.total;'
        ].join('\n'));
        try
        {
            await fs.promises.writeFile(path.join(directory, 'Middle.lgd'), 'const Root = require("./Root.js");\nclass Middle : Root {}\nmodule.exports = Middle;');
            await service.openDocument(root);
            const state = await service.openDocument(consumer);
            await service.pendingDependencyUpdates;
            expect(state.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.return.typeMismatch' })]));
            const valueOffset = consumer.getText().indexOf('item.value') + 'item.'.length;
            const definition = await LgdDefinitionProvider.create(service).provideDefinition(consumer, consumer.positionAt(valueOffset));
            expect(definition[0].uri.fsPath).toBe(root.uri.fsPath);
            expect(root.getText(definition[0].range)).toBe('value');
            root.setText(rootSource.replace('String value = "old"', 'Number value = 2').replace('static Number total', 'Number total'));
            await service.updateDocument(root);
            await service.pendingDependencyUpdates;
            expect(state.errors.some(error => error.code === 'lgd.return.typeMismatch')).toBe(false);
            expect(state.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.member.receiverKind' })]));
            const metadata = state.externals.get('./Middle.js').members.find(member => member.name === 'value');
            expect(metadata).toMatchObject({ kind: 'field', typeName: 'Number', static: false, declaringType: 'Root' });
        }
        finally
        {
            await service.pendingDependencyUpdates;
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });
});

describe('Source-backed declared field hover', () =>
{
    test.each([ 'oloo', 'class' ])('Shows declared default-only instance and static types in %s output.', async objectModel =>
    {
        const source = 'class Sample { String label; Number value; static Boolean ready; }\nSample item = Sample.create();\nitem.label; item.value; Sample.ready;';
        const { service, document, state } = await openSource(source, { javascriptObjectModel: objectModel });
        expect(state.errors).toEqual([]);
        const provider = LgdHoverProvider.create(service);
        for(const entry of [ [ 'item.label', 'String Sample.label' ], [ 'item.value', 'Number Sample.value' ], [ 'Sample.ready', 'static Boolean Sample.ready' ] ])
        {
            const offset = source.lastIndexOf(entry[0]) + entry[0].indexOf('.') + 1;
            const hover = await provider.provideHover(document, document.positionAt(offset));
            expect(hover.contents).toContain(entry[1]);
            expect(document.getText(hover.range)).toBe(entry[0].split('.')[1]);
        }

        const declaration = await provider.provideHover(document, document.positionAt(source.indexOf('label;')));
        expect(declaration.contents).toContain('String Sample.label');
        document.setText(`${source}\nitem.value = 2;`);
        expect(LgdClassMemberLookup.get(state, document.positionAt(source.indexOf('label;')))).toBeNull();
    });

    test('Uses declaring types for inherited imported fields and consumer aliases.', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-field-hovers-'));
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const root = makeTextDocument(`file://${path.join(directory, 'Root.lgd')}`, 'class Root { String label; static Number total; }\nmodule.exports = Root;');
        const consumer = makeTextDocument(`file://${path.join(directory, 'Consumer.lgd')}`, 'const Alias = require("./Middle.js");\nAlias item = Alias.create();\nitem.label; Alias.total;');
        try
        {
            await fs.promises.writeFile(path.join(directory, 'Middle.lgd'), 'const Root = require("./Root.js");\nclass Middle : Root {}\nmodule.exports = Middle;');
            await service.openDocument(root);
            await service.openDocument(consumer);
            const provider = LgdHoverProvider.create(service);
            for(const entry of [ [ 'item.label', 'String Root.label' ], [ 'Alias.total', 'static Number Root.total' ] ])
            {
                const offset = consumer.getText().lastIndexOf(entry[0]) + entry[0].indexOf('.') + 1;
                const hover = await provider.provideHover(consumer, consumer.positionAt(offset));
                expect(hover.contents).toContain(entry[1]);
            }
        }
        finally
        {
            await service.pendingDependencyUpdates;
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });
});
