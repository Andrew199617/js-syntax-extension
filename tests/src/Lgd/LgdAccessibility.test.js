const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');

let directory;
let service;

/** @description Creates a real project source without relying on editor workspace membership. */
async function write(relative, lines)
{
    const filename = path.join(directory, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, lines.join('\r\n'));
    return filename;
}

/** @description Opens the test consumer through the actual import graph and export cache. */
async function open(relative, lines)
{
    const filename = await write(relative, lines);
    const document = makeTextDocument(pathToFileURL(filename).toString(), lines.join('\r\n'));
    return service.openDocument(document);
}

/** @description Retains only accessibility diagnostics for cross-file assertions. */
function accessErrors(state)
{
    return state.errors.filter(error => error.code?.startsWith('lgd.access.'));
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(async () =>
{
    vscode.__reset();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lgd-access-'));
    service = LgdLanguageService.create({ set: jest.fn(), delete: jest.fn() }, error =>
    {
        throw error;
    });

    await fs.writeFile(path.join(directory, 'package.json'), '{}');
});

afterEach(() => fs.rm(directory, { recursive: true, force: true }));

test.each([ 'oloo', 'class' ])('Checks imported private, internal, and public fields with %s output.', async objectModel =>
{
    service.getOutputOptions = () => ({ javascriptObjectModel: objectModel });
    await write('models/Value.lgd', [
        'public class Value { private Number secret; internal Number local; public Number exposed; }',
        'module.exports = Value;'
    ]);
    const state = await open('client/Use.lgd', [
        'const Value = require("../models/Value.js");',
        'const value = Value.create();',
        'value.secret; value.local; value.exposed;'
    ]);
    expect(accessErrors(state)).toHaveLength(1);
    expect(accessErrors(state)[0].message).toContain('secret');
    expect(state.errors).toHaveLength(1);
});

test('Rejects internal types and members across nested manifest projects.', async () =>
{
    await write('library/lgdconfig.json', ['{}']);
    await write('library/Hidden.lgd', [ 'internal class Hidden {}', 'module.exports = Hidden;' ]);
    await write('library/Api.lgd', [ 'public class Api { internal Number local; public Number exposed; }', 'module.exports = Api;' ]);
    const state = await open('client/Use.lgd', [
        'const Hidden = require("../library/Hidden.js");',
        'const Api = require("../library/Api.js");',
        'const value = Api.create(); value.local; value.exposed;'
    ]);
    expect(accessErrors(state)).toHaveLength(2);
    expect(accessErrors(state).map(error => error.message)).toEqual(expect.arrayContaining([
        expect.stringContaining('Hidden'), expect.stringContaining('local')
    ]));
});

test('Carries protected ownership across aliased multi-hop imports and inheritance.', async () =>
{
    await write('Root.lgd', [
        'class Root { protected Root() {} protected Number score() { return 1; } private Number secret() { return 2; } }',
        'module.exports = Root;'
    ]);
    await write('Middle.lgd', [ 'const Alias = require("./Root.js");', 'class Middle : Alias {}', 'module.exports = Middle;' ]);
    const state = await open('Use.lgd', [
        'const Parent = require("./Middle.js");',
        'class Child : Parent { test(Child own, Parent parent) { own.score(); parent.score(); this.secret(); } }',
        'Child.create().score();'
    ]);
    expect(accessErrors(state)).toHaveLength([ 'score', 'score', 'secret' ].length);
    expect(accessErrors(state).filter(error => error.message.includes('score'))).toHaveLength(2);
    expect(accessErrors(state).filter(error => error.message.includes('secret'))).toHaveLength(1);
});

test('Retains imported constructor visibility at factory and direct construction sites.', async () =>
{
    await write('Locked.lgd', [ 'class Locked { private Locked() {} }', 'module.exports = Locked;' ]);
    const state = await open('Use.lgd', [ 'const Locked = require("./Locked.js");', 'Locked.create(); new Locked();' ]);
    expect(accessErrors(state)).toHaveLength(2);
});

test('Refreshes open consumers after an exported visibility edit with unchanged member names.', async () =>
{
    const filename = await write('Value.lgd', [ 'class Value { public Number count; }', 'module.exports = Value;' ]);
    const state = await open('Use.lgd', [ 'const Value = require("./Value.js");', 'Value.create().count;' ]);
    expect(accessErrors(state)).toEqual([]);
    await write('Value.lgd', [ 'class Value { private Number count; }', 'module.exports = Value;' ]);
    await service.invalidateFile(filename);
    expect(accessErrors(state)).toHaveLength(1);
    await write('Value.lgd', [ 'class Value { public Number count; }', 'module.exports = Value;' ]);
    await service.invalidateFile(filename);
    expect(accessErrors(state)).toEqual([]);
});

test('Recomputes project membership after manifest creation and removal without changing LGD source.', async () =>
{
    await write('library/Value.lgd', [ 'class Value { internal Number count; }', 'module.exports = Value;' ]);
    const state = await open('Use.lgd', [ 'const Value = require("./library/Value.js");', 'Value.create().count;' ]);
    expect(accessErrors(state)).toEqual([]);
    const manifest = await write('library/lgdconfig.json', ['{}']);
    await service.refreshProjectIdentities();
    expect(accessErrors(state)).toHaveLength(1);
    await fs.unlink(manifest);
    await service.refreshProjectIdentities();
    expect(accessErrors(state)).toEqual([]);
});

test('Does not merge standalone sibling files into a project merely because their directory matches.', async () =>
{
    await fs.unlink(path.join(directory, 'package.json'));
    await write('Value.lgd', [ 'class Value { internal Number count; }', 'module.exports = Value;' ]);
    const state = await open('Use.lgd', [ 'const Value = require("./Value.js");', 'Value.create().count;' ]);
    expect(accessErrors(state)).toHaveLength(1);
});

test('Does not confuse same-named exported classes when checking private ownership.', async () =>
{
    await write('Other.lgd', [ 'class Value { private Number count; }', 'module.exports = Value;' ]);
    const state = await open('Use.lgd', [
        'const Other = require("./Other.js");',
        'class Value { private Number count; test(Other other) { other.count; } }'
    ]);
    expect(accessErrors(state)).toHaveLength(1);
});
