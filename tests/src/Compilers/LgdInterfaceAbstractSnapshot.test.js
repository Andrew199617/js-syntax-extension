const fs = require('fs').promises;
const Module = require('module');
const path = require('path');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

/** @description Directory holding the interface/abstract snapshot fixtures. */
const FIXTURE_DIR = path.join(__dirname, '..', '..', 'fixtures', 'interface-abstract');

/**
 * @description Reads one fixture file as UTF-8 text.
 * @param {string} name the fixture file name.
 * @returns {Promise<string>} the fixture content.
 */
function readFixture(name)
{
    return fs.readFile(path.join(FIXTURE_DIR, name), 'utf8');
}

/**
 * @description Compiles the snapshot input and asserts zero diagnostics.
 * @returns {Promise<string>} the emitted JavaScript.
 */
async function compileInput()
{
    const result = LgdCompiler.create().compileToJs(await readFixture('input.lgd'));
    expect(result.errors).toEqual([]);
    return result.code;
}

describe('LGD interface/abstract snapshot.', () =>
{
    test('Compiles the interface/abstract input to the expected JS line for line.', async () =>
    {
        const actualLines = (await compileInput()).split('\n');
        const expectedLines = (await readFixture('expected.js')).split('\n');

        expect(actualLines.length).toBe(expectedLines.length);
        for(let index = 0; index < actualLines.length; index++)
        {
            expect(actualLines[index]).toBe(expectedLines[index]);
        }
    });

    test('The emitted JS runs: overrides, base dispatch, and accessors behave.', async () =>
    {
        const file = path.join(FIXTURE_DIR, 'expected.js');
        const compiled = new Module(file, module);
        compiled.filename = file;
        compiled.paths = Module._nodeModulePaths(FIXTURE_DIR);
        compiled._compile(await compileInput(), file);
        const MemoryStore = compiled.exports;

        const store = MemoryStore.create('main');
        store.write('a');
        store.write('b');

        expect(store.size()).toBe(2);
        expect(store.describe()).toBe('main (memory)');
        expect(store.read()).toBe('main');
        expect(store.name).toBe('main');

        store.name = 'renamed';
        expect(store.name).toBe('renamed');
        expect(store.getName()).toBe('renamed');
    });
});
