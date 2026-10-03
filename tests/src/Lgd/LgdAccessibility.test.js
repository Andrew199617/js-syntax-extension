const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const ObjectInheritanceContracts = require('../../../src/Lgd/QuickFixes/ObjectInheritanceContracts');
const LgdCompletionProvider = require('../../../src/Lgd/LgdCompletionProvider');
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

test('Checks chained member and method results using their defining-file type identities.', async () =>
{
    await write('Item.lgd', [
        'class Item { private Number secret; public Number count; }',
        'module.exports = Item;'
    ]);

    await write('Box.lgd', [
        'const Item = require("./Item.js");',
        'class Box { Item item = Item.create(); Item getItem() { return item; } }',
        'module.exports = Box;'
    ]);
    const state = await open('Use.lgd', [
        'const Box = require("./Box.js");',
        'class Item { public Number secret; }',
        'const box = Box.create();',
        'box.item.secret; box.getItem().secret;',
        'box.item.count;'
    ]);
    expect(accessErrors(state)).toHaveLength(2);
    expect(accessErrors(state).every(error => error.message.includes('secret'))).toBe(true);
    await write('Item.lgd', [ 'class Item { public Number secret; public Number count; }', 'module.exports = Item;' ]);
    await service.invalidateFile(path.join(directory, 'Item.lgd'));
    expect(accessErrors(state)).toEqual([]);
});

test('Offers only accessible instance and static completions at the cursor.', async () =>
{
    const state = await open('Use.lgd', [
        'class Value { private Number secret; public Number count; private static Number hidden; public static Number total; }',
        'Value value = Value.create();',
        'value.count; Value.total;'
    ]);
    const provider = LgdCompletionProvider.create(service);
    const source = state.document.getText();
    const instanceOffset = source.indexOf('value.count') + 'value.'.length;
    const typeOffset = source.indexOf('Value.total') + 'Value.'.length;
    const instance = await provider.provideCompletionItems(state.document, state.document.positionAt(instanceOffset));
    const type = await provider.provideCompletionItems(state.document, state.document.positionAt(typeOffset));
    expect(instance.map(item => item.label)).toEqual(['count']);
    expect(type.map(item => item.label)).toEqual(expect.arrayContaining([ 'total', 'create' ]));
    expect(type.map(item => item.label)).not.toContain('hidden');
});

test('Keeps own private members in this completions while hiding private inherited members.', async () =>
{
    const state = await open('Use.lgd', [
        'class Base { private Number hidden; protected Number shared; }',
        'class Child : Base { private Number own; inspect() { this.own; } }'
    ]);
    const source = state.document.getText();
    const offset = source.indexOf('this.own') + 'this.'.length;
    const items = await LgdCompletionProvider.create(service).provideCompletionItems(state.document, state.document.positionAt(offset));
    expect(items.map(item => item.label)).toEqual(expect.arrayContaining([ 'shared', 'own' ]));
    expect(items.map(item => item.label)).not.toContain('hidden');
});

test('Rejects satisfying an inaccessible abstract obligation from a different project.', async () =>
{
    await write('library/lgdconfig.json', ['{}']);
    await write('library/Base.lgd', [
        'public abstract class Base { internal abstract Number read(); }',
        'module.exports = Base;'
    ]);
    const state = await open('Use.lgd', [
        'const Base = require("./library/Base.js");',
        'class Derived : Base { public Number read() { return 1; } }'
    ]);
    expect(state.errors.some(error => error.message.includes('inaccessible internal abstract'))).toBe(true);
});

test.each([
    'const IValue = require("./library/IValue.js");',
    'const ordinary = 0, IValue = require("./library/IValue.js");',
    'const IValue = (require("./library/IValue.js"));'
])('Checks internal interface imports before type-only erasure: %s', async imported =>
{
    await write('library/lgdconfig.json', ['{}']);
    await write('library/IValue.lgd', [ 'internal interface IValue { Number read(); }', 'module.exports = IValue;' ]);
    const state = await open('Use.lgd', [
        imported
    ]);
    expect(accessErrors(state)).toHaveLength(1);
    const error = accessErrors(state)[0];
    expect(state.document.getText().slice(error.offset, error.endOffset)).toBe('IValue');
    expect(state.jsDocument.getText()).not.toContain('require(');
});

test('Rejects overriding an internal abstract accessor from another project.', async () =>
{
    await write('library/lgdconfig.json', ['{}']);
    await write('library/Base.lgd', [
        'public abstract class Base { public abstract Number Score { get; internal set; } }',
        'module.exports = Base;'
    ]);
    const state = await open('Use.lgd', [
        'const Base = require("./library/Base.js");',
        'class Child : Base {',
        '    public override get Number Score() { return 1; }',
        '    internal override set Score(Number value) {}',
        '}'
    ]);
    expect(state.errors.some(error => error.code === 'lgd.access.override')).toBe(true);
    expect(state.errors.some(error => error.message.includes('inaccessible internal abstract'))).toBe(true);
});

test('Uses canonical declaring ownership when a protected base is imported through a symlink.', async () =>
{
    const basePath = await write('Base.lgd', [
        'class Base { protected Number read() { return 1; } }',
        'module.exports = Base;'
    ]);
    await fs.symlink(basePath, path.join(directory, 'Alias.lgd'));
    const state = await open('Use.lgd', [
        'const Base = require("./Alias.js");',
        'class Child : Base { Number value() { return this.read(); } }'
    ]);
    expect(state.errors).toEqual([]);
});

test('Preserves project identity when an inheritance quick fix clones imported contracts.', () =>
{
    const source = 'const Object Base = { create() { return {}; }, Number run() { return 1; } };';
    const declaration = LgdCompiler.create().parse(source).declarations[0];
    const entry = { sourcePath: '/project/Base.lgd', exportName: 'Base' };
    const externals = new Map([[ './Base', entry ]]);
    externals.sourceContext = { sourcePath: '/project/Use.lgd', projectId: 'compilation' };
    const context = { state: { externals: externals }, source: {} };
    const base = { declaration: declaration, snapshot: { text: source }, entry: entry };
    const shape = { baseName: 'Base', object: { properties: [{ key: { name: 'run' } }] } };
    const plan = ObjectInheritanceContracts.plan(context, base, shape);
    expect(plan).not.toBeNull();
    expect(plan.externals.sourceContext).toBe(externals.sourceContext);
});

test('Checks known classes returned directly by require and chained factory aliases.', async () =>
{
    await write('Value.lgd', [ 'class Value { private Number secret; }', 'module.exports = Value;' ]);
    const state = await open('Use.lgd', [
        'require("./Value.js").create().secret;',
        'const value = require("./Value.js").create(); value.secret;',
        'function ordinary(require) { return require("./Value.js").create().secret; }'
    ]);
    expect(accessErrors(state)).toHaveLength(2);
});
