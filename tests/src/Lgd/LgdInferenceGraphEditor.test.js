const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

describe('Imported inference graphs and edit invalidation.', () =>
{
    let directory;
    let service;
    let failures;

    beforeEach(async () =>
    {
        vscode.__reset();
        directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-inference-graph-'));
        failures = [];
        service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, error => failures.push(error));
    });

    afterEach(async () =>
    {
        await service.pendingDependencyUpdates;
        await fs.promises.rm(directory, { recursive: true, force: true });
        expect(failures).toEqual([]);
    });

    test('Refreshes a deep self-recursive imported field after unsaved edits and restores its original error.', async () =>
    {
        const original = 'class Link { Link next; String label = "leaf"; }\nmodule.exports = Link;';
        const remote = makeTextDocument(`file://${path.join(directory, 'Link.lgd')}`, original);
        await service.openDocument(remote);
        const depth = 32;
        const expression = `item.${'next.'.repeat(depth)}label`;
        const source = 'const Remote = require("./Link.js");\nclass Link { Number label = 7; }\n'
            + `class Reader { Number read(Remote item) { return ${expression}; } }`;
        const consumer = makeTextDocument(`file://${path.join(directory, 'Consumer.lgd')}`, source);
        const state = await service.openDocument(consumer);
        await service.pendingDependencyUpdates;
        const expected = { code: 'lgd.return.typeMismatch', message: 'Cannot return String from a Number method.' };
        expect(state.errors).toEqual([expect.objectContaining(expected)]);
        expect(source.slice(state.errors[0].offset, state.errors[0].endOffset)).toBe(expression);

        remote.setText(original.replace('String label = "leaf"', 'Number label = 7'));
        await service.updateDocument(remote);
        await service.pendingDependencyUpdates;
        expect(state.errors).toEqual([]);
        remote.setText(original);
        await service.updateDocument(remote);
        await service.pendingDependencyUpdates;
        expect(state.errors).toEqual([expect.objectContaining(expected)]);
    });

    test.each([ [ 'Left', 'Right' ], [ 'Right', 'Left' ] ])('Preserves known leaves and refreshed caches when importing %s before %s.', async (first, second) =>
    {
        await fs.promises.writeFile(path.join(directory, 'Left.lgd'), [
            'const Right = require("./Right.js");',
            'class Left { Right next; String label = "left"; }',
            'module.exports = Left;'
        ].join('\n'));

        await fs.promises.writeFile(path.join(directory, 'Right.lgd'), [
            'const Left = require("./Left.js");',
            'class Right { Left next; String label = "right"; }',
            'module.exports = Right;'
        ].join('\n'));
        const depth = 12;
        const consumers = new Map();
        for(const name of [ first, second ])
        {
            const source = `const Remote = require("./${name}.js");\n`
                + `class Reader { Number read(Remote item) { return item.${'next.'.repeat(depth)}label; } }`;
            const consumer = makeTextDocument(`file://${path.join(directory, `${name}Reader.lgd`)}`, source);
            const state = await service.openDocument(consumer);
            await service.pendingDependencyUpdates;
            expect(state.errors).toEqual([expect.objectContaining({ code: 'lgd.return.typeMismatch' })]);
            consumers.set(name, state);
        }

        const filename = path.join(directory, 'Left.lgd');
        const original = await fs.promises.readFile(filename, 'utf8');
        const edited = makeTextDocument(`file://${filename}`, original.replace('String label = "left"', 'Number label = 7'));
        await service.openDocument(edited);
        await service.pendingDependencyUpdates;
        expect(consumers.get('Left').errors).toEqual([]);
        expect(consumers.get('Right').errors).toEqual([expect.objectContaining({ code: 'lgd.return.typeMismatch' })]);
        edited.setText(original);
        await service.updateDocument(edited);
        await service.pendingDependencyUpdates;
        expect(consumers.get('Left').errors).toEqual([expect.objectContaining({ code: 'lgd.return.typeMismatch' })]);
    });
});
