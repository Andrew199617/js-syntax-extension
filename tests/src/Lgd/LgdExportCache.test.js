const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');

/** @description Creates a file URI for an incremental editor fixture. */
function sourceDocument(directory, name, source)
{
    return makeTextDocument(`file://${path.join(directory, name)}`, source);
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

describe('LGD incremental export signatures', () =>
{
    let directory;
    let service;
    let errors;

    beforeEach(async () =>
    {
        vscode.__reset();
        directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-export-cache-'));
        errors = [];
        service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, error => errors.push(error));
    });

    afterEach(async () =>
    {
        await service.pendingDependencyUpdates;
        jest.restoreAllMocks();
        await fs.promises.rm(directory, { recursive: true, force: true });
        expect(errors).toEqual([]);
    });

    test('reuses unchanged disk parses and exports while the consumer is edited', async () =>
    {
        await fs.promises.writeFile(path.join(directory, 'Base.lgd'), [
            'class Base { virtual String label(Number value) { return "ready"; } }',
            'module.exports = Base;'
        ].join('\n'));
        const source = 'Object Base = require("./Base.js");\nclass Child : Base {}';
        const document = sourceDocument(directory, 'Child.lgd', source);
        const state = await service.openDocument(document);
        await service.pendingDependencyUpdates;
        const parse = jest.spyOn(service.compiler, 'parse');
        const read = jest.spyOn(fs.promises, 'readFile');
        const editCount = 3;
        for(let index = 0; index < editCount; index++)
        {
            document.setText(`${source}\n// body edit ${index}`);
            await service.updateDocument(document);
            await service.pendingDependencyUpdates;
        }

        expect(parse).toHaveBeenCalledTimes(editCount);
        expect(read).not.toHaveBeenCalled();
        expect(state.externals.get('./Base.js')).toMatchObject({
            methodsKnown: true,
            methodSignatures: [expect.objectContaining({ name: 'label', virtual: true, returnTypeName: 'String' })]
        });
    });

    test('rechecks only affected open descendants when a signature changes through a closed base', async () =>
    {
        const rootSource = [
            'class Root { virtual String label(Number value) { return "old"; } }',
            'module.exports = Root;'
        ].join('\n');
        const root = sourceDocument(directory, 'Root.lgd', rootSource);
        await fs.promises.writeFile(path.join(directory, 'Middle.lgd'), [
            'Object Root = require("./Root.js");',
            'class Middle : Root {}',
            'module.exports = Middle;'
        ].join('\n'));
        await service.openDocument(root);
        const leaf = sourceDocument(directory, 'Leaf.lgd', [
            'Object Middle = require("./Middle.js");',
            'class Leaf : Middle { override String label(Number value) { return "leaf"; } }'
        ].join('\n'));
        const leafState = await service.openDocument(leaf);
        await service.openDocument(sourceDocument(directory, 'Unrelated.lgd', 'Number count = 1;'));
        await service.pendingDependencyUpdates;
        const compile = jest.spyOn(service.compiler, 'compileToJs');
        const read = jest.spyOn(fs.promises, 'readFile');

        root.setText(rootSource.replace('"old"', '"new"'));
        await service.updateDocument(root);
        await service.pendingDependencyUpdates;
        expect(compile).toHaveBeenCalledTimes(1);
        compile.mockClear();

        root.setText(rootSource.replace('Number value', 'String value'));
        await service.updateDocument(root);
        await service.pendingDependencyUpdates;
        expect(compile).toHaveBeenCalledTimes(2);
        expect(compile.mock.calls.map(([content]) => content)).toEqual([ root.getText(), leaf.getText() ]);
        expect(read).not.toHaveBeenCalled();
        const signature = leafState.externals.get('./Middle.js').methodSignatures.find(method => method.name === 'label');
        expect(signature.params[0].typeName).toBe('String');
        expect(leafState.errors.some(error => error.message.includes('parameter'))).toBe(true);

        root.setText(rootSource);
        await service.updateDocument(root);
        await service.pendingDependencyUpdates;
        expect(leafState.errors).toEqual([]);
    });

    test('resolves previously unknown targets and removes obsolete dependency edges', async () =>
    {
        const missingPath = path.join(directory, 'Missing.lgd');
        const consumer = sourceDocument(directory, 'Consumer.lgd', [
            'Object Missing = require("./Missing.js");',
            'class Consumer : Missing {}'
        ].join('\n'));
        const state = await service.openDocument(consumer);
        expect(state.externals.has('./Missing.js')).toBe(false);
        await fs.promises.writeFile(missingPath, 'class Missing { virtual Number size() { return 1; } }\nmodule.exports = Missing;');
        await service.invalidateFile(missingPath);
        expect(state.externals.get('./Missing.js')).toMatchObject({ methodsKnown: true });
        expect(state.externals.get('./Missing.js').methodSignatures[0].name).toBe('size');

        consumer.setText('Number count = 1;');
        await service.updateDocument(consumer);
        await service.pendingDependencyUpdates;
        const compile = jest.spyOn(service.compiler, 'compileToJs');
        await service.invalidateFile(missingPath);
        expect(compile).not.toHaveBeenCalled();
    });

    test('invalidates diamond ancestry before any open consumer is rechecked', async () =>
    {
        const source = 'class Root { virtual Number size() { return 1; } }\nmodule.exports = Root;';
        const root = sourceDocument(directory, 'Root.lgd', source);
        await service.openDocument(root);
        const consumer = sourceDocument(directory, 'Consumer.lgd', [
            'Object Root = require("./Root.js");',
            'Object Middle = require("./Middle.js");',
            'class Consumer : Middle { override Number size() { return 1; } }'
        ].join('\n'));
        const state = await service.openDocument(consumer);
        const middle = sourceDocument(directory, 'Middle.lgd', [
            'Object Root = require("./Root.js");',
            'class Middle : Root {}',
            'module.exports = Middle;'
        ].join('\n'));
        await service.openDocument(middle);
        await service.pendingDependencyUpdates;
        expect(state.errors).toEqual([]);

        root.setText(source.replace('Number size', 'String size').replace('return 1', 'return "one"'));
        await service.updateDocument(root);
        await service.pendingDependencyUpdates;
        expect(state.externals.get('./Middle.js').methodSignatures[0].returnTypeName).toBe('String');
        expect(state.errors.some(error => error.message.includes('must return String'))).toBe(true);
    });

    test('does not let a slow disk read replace the newer open source cache', async () =>
    {
        const sourcePath = path.join(directory, 'Base.lgd');
        const saved = 'class Base { virtual Number size() { return 1; } }\nmodule.exports = Base;';
        await fs.promises.writeFile(sourcePath, saved);
        let started;
        let release;
        const reading = new Promise(resolve =>
        {
            started = resolve;
        });
        const blocked = new Promise(resolve =>
        {
            release = resolve;
        });
        jest.spyOn(fs.promises, 'readFile').mockImplementationOnce(() =>
        {
            started();
            return blocked;
        });

        const lookup = service.readExportDeclaration(sourcePath);
        await reading;
        const opened = sourceDocument(directory, 'Base.lgd', saved.replace('Number size', 'String size').replace('return 1', 'return "one"'));
        await service.openDocument(opened);
        release(saved);

        expect((await lookup).methodSignatures[0].returnTypeName).toBe('String');
        expect((await service.readExportDeclaration(sourcePath)).sourceText).toBe(opened.getText());
    });

    test('reverts unsaved exported signatures to disk when their source closes', async () =>
    {
        const saved = 'class Base { virtual Number size() { return 1; } }\nmodule.exports = Base;';
        const basePath = path.join(directory, 'Base.lgd');
        await fs.promises.writeFile(basePath, saved);
        const base = sourceDocument(directory, 'Base.lgd', saved.replace('Number size', 'String size').replace('return 1', 'return "one"'));
        await service.openDocument(base);
        const consumer = sourceDocument(directory, 'Consumer.lgd', 'Object Base = require("./Base.js");\nclass Consumer : Base {}');
        const state = await service.openDocument(consumer);
        await service.pendingDependencyUpdates;
        expect(state.externals.get('./Base.js').methodSignatures[0].returnTypeName).toBe('String');

        service.closeDocument(base);
        await service.pendingDependencyUpdates;
        expect(state.externals.get('./Base.js').methodSignatures[0].returnTypeName).toBe('Number');
    });
});
