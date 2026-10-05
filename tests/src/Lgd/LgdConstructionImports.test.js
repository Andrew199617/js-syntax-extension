const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const vscode = require('vscode');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdConstructorHover = require('../../../src/Lgd/LgdConstructorHover');
const { makeTextDocument } = require('./fakeVscode');

/** @description Creates a source-aware service that reads each defining module's own current output model. */
function createService(models)
{
    return LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, error =>
    {
        throw error;
    }, document => ({ javascriptObjectModel: models.get(path.basename(document.uri.fsPath)) || 'oloo' }));
}

/** @description Writes local LGD sources and only their compiled, dependency-free JavaScript. */
async function compileFile(service, directory, name, source)
{
    const filename = path.join(directory, `${name}.lgd`);
    await fs.promises.writeFile(filename, source);
    const document = makeTextDocument(`file://${filename}`, source);
    const externals = await service.collectExternalTypes(document);
    const compiled = LgdCompiler.create().compileToJs(source, externals, service.getOutputOptions(document));
    expect(compiled.errors.filter(error => error.severity !== 'warning')).toEqual([]);
    await fs.promises.writeFile(path.join(directory, `${name}.js`), compiled.code);
    return { document: document, compiled: compiled, externals: externals };
}

/** @description Executes the locally compiled module graph in a separate Node process. */
function runFile(directory, name)
{
    const child = spawnSync(process.execPath, [path.join(directory, `${name}.js`)], { encoding: 'utf8' });
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    return JSON.parse(child.stdout);
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() => vscode.__reset());

describe.each([ 'oloo', 'class' ])('Mixed construction graphs with %s consumer output.', consumerModel =>
{
    test('Executes exact BaseCommand constructors through CommonJS aliases, named projections and re-exports.', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-cjs-construction-'));
        try
        {
            const models = new Map([ [ 'Factory.lgd', 'oloo' ], [ 'Native.lgd', 'class' ], [ 'Main.lgd', consumerModel ] ]);
            const service = createService(models);
            const fixture = await fs.promises.readFile(path.join(__dirname, '../../fixtures/construction/BaseCommand.lgd'), 'utf8');
            await compileFile(service, directory, 'Factory', fixture);
            await compileFile(service, directory, 'Native', fixture);
            await compileFile(service, directory, 'Barrel', 'const Factory = require("./Factory.js"); const Native = require("./Native.js"); module.exports = { Factory, Renamed: Native };');
            await fs.promises.writeFile(path.join(directory, 'Foreign.js'), 'module.exports = class Foreign { constructor(value) { this.value = value; } static create() { throw new Error("foreign create called"); } };');
            const source = [
                'const Factory = require("./Factory.js"); const Native = require("./Native.js"); const Foreign = require("./Foreign.js");',
                'const namespace = require("./Barrel.js"); const { Factory: Projection } = require("./Barrel.js");',
                'const Alias = Factory; const NativeAlias = Native;',
                'const direct = new Factory("lgd.run", "Run"); const empty = new Factory();',
                'const native = new Native("lgd.native", "Native"); const nativeEmpty = new Native();',
                'const alias = new Alias("lgd.alias", "Alias"); const projection = new Projection("lgd.projection", "Projection");',
                'const named = new namespace.Factory("lgd.named", "Named"); const renamed = new namespace.Renamed("lgd.renamed", "Renamed");',
                'const nativeAlias = new NativeAlias("lgd.nativeAlias", "NativeAlias"); const foreign = new Foreign(8);',
                'console.log(JSON.stringify({ commandName: direct.commandName, command: direct.command, emptyOwnCommand: Object.hasOwn(empty, "command"), independent: direct !== empty, native: native.commandName, nativeEmptyOwnCommand: Object.hasOwn(nativeEmpty, "command"), aliases: [alias.commandName, projection.commandName, named.commandName, renamed.commandName, nativeAlias.commandName], foreign: foreign.value }));'
            ].join('\n');
            const result = await compileFile(service, directory, 'Main', source);
            expect(result.externals.get('./Factory.js').constructionKind).toBe('factory');
            expect(result.externals.get('./Native.js').constructionKind).toBe('native');
            const exports = result.externals.moduleExports.get('./Barrel.js');
            expect(exports.get('Factory').constructionKind).toBe('factory');
            expect(exports.get('Renamed').constructionKind).toBe('native');
            for(const spelling of [ 'Factory.create("lgd.run"', 'Alias.create("lgd.alias"', 'Projection.create("lgd.projection"', 'namespace.Factory.create("lgd.named"' ])
            {
                expect(result.compiled.code).toContain(spelling);
            }

            for(const spelling of [ 'new Native("lgd.native"', 'new namespace.Renamed("lgd.renamed"', 'new NativeAlias("lgd.nativeAlias"', 'new Foreign(8)' ])
            {
                expect(result.compiled.code).toContain(spelling);
            }

            expect(runFile(directory, 'Main')).toEqual({ commandName: 'lgd.run', command: { title: 'Run', command: 'lgd.run' }, emptyOwnCommand: false, independent: true,
                native: 'lgd.native', nativeEmptyOwnCommand: false, aliases: [ 'lgd.alias', 'lgd.projection', 'lgd.named', 'lgd.renamed', 'lgd.nativeAlias' ], foreign: 8 });
        }
        finally
        {
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });

    test('Runs an explicit CommonJS object export through its real ESM default namespace import.', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-cjs-default-namespace-'));
        try
        {
            const commonJsDirectory = path.join(directory, 'cjs');
            await fs.promises.mkdir(commonJsDirectory);
            await fs.promises.writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
            await fs.promises.writeFile(path.join(commonJsDirectory, 'package.json'), '{"type":"commonjs"}');
            const models = new Map([ [ 'Factory.lgd', 'oloo' ], [ 'Main.lgd', consumerModel ] ]);
            const service = createService(models);
            await compileFile(service, commonJsDirectory, 'Factory', 'class Foo { Number value = 7; Foo() {} }\nmodule.exports = { Foo };');
            const source = 'import pack from "./cjs/Factory.js";\nconst instance = new pack.Foo(); console.log(instance.value);';
            const result = await compileFile(service, directory, 'Main', source);
            expect(result.compiled.code).toContain('pack.Foo.create()');
            const expectedValue = 7;
            expect(runFile(directory, 'Main')).toBe(expectedValue);
        }
        finally
        {
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });

    test('Runs a static numeric CommonJS constructor export without corrupting selector caches.', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-cjs-numeric-construction-'));
        try
        {
            const service = createService(new Map([[ 'Main.lgd', consumerModel ]]));
            await compileFile(service, directory, 'Provider', 'class Foo { Number value = 7; Foo() {} }\nmodule.exports = { 0: Foo };');
            const source = 'const pack = require("./Provider.js");\nconst instance = new pack[0](); console.log(instance.value);';
            const result = await compileFile(service, directory, 'Main', source);
            expect(result.externals.moduleExports.get('./Provider.js').get('0').constructionKind).toBe('factory');
            expect(result.compiled.code).toContain('pack[0].create()');
            const expectedValue = 7;
            expect(runFile(directory, 'Main')).toBe(expectedValue);
            const restricted = 'class Foo { private Foo() {} }\nmodule.exports = { 0: Foo };';
            await compileFile(service, directory, 'Provider', restricted);
            const consumer = makeTextDocument(`file://${path.join(directory, 'Consumer.lgd')}`, source);
            const externals = await service.collectExternalTypes(consumer);
            expect(LgdCompiler.create().compileToJs(source, externals).errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.access.inaccessible' })]));
        }
        finally
        {
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });

    test('Executes ESM default, named, namespace imports, aliases and explicit re-exports with mixed models.', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-esm-construction-'));
        try
        {
            await fs.promises.writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
            const models = new Map([ [ 'Factory.lgd', 'oloo' ], [ 'Native.lgd', 'class' ], [ 'Main.lgd', consumerModel ] ]);
            const service = createService(models);
            const definition = 'export class Command { Command(String commandName, String title) { this.command = {title, command: commandName}; } Command() {} get String commandName() { return this.command.command; } }\nexport default Command;';
            await compileFile(service, directory, 'Factory', definition);
            await compileFile(service, directory, 'Native', definition);
            await compileFile(service, directory, 'Barrel', 'export { Command as Factory } from "./Factory.js"; export { default as Native } from "./Native.js";');
            await fs.promises.writeFile(path.join(directory, 'Foreign.js'), 'export default class Foreign { constructor(value) { this.value = value; } static create() { throw new Error("foreign create called"); } }');
            const source = [
                'import DefaultFactory from "./Factory.js"; import { Command as NamedFactory } from "./Factory.js";',
                'import Native from "./Native.js"; import * as namespace from "./Barrel.js"; import Foreign from "./Foreign.js";',
                'const Alias = NamedFactory;',
                'const full = new DefaultFactory("lgd.run", "Run"); const empty = new NamedFactory();',
                'const alias = new Alias("lgd.alias", "Alias"); const named = new namespace.Factory("lgd.named", "Named");',
                'const native = new Native("lgd.native", "Native"); const exportedNative = new namespace.Native("lgd.reexport", "Reexport"); const foreign = new Foreign(9);',
                'console.log(JSON.stringify({ commandName: full.commandName, command: full.command, emptyOwnCommand: Object.hasOwn(empty, "command"), independent: full !== empty, names: [alias.commandName, named.commandName, native.commandName, exportedNative.commandName], foreign: foreign.value }));'
            ].join('\n');
            const result = await compileFile(service, directory, 'Main', source);
            expect(result.compiled.code).toContain('DefaultFactory.create("lgd.run"');
            expect(result.compiled.code).toContain('NamedFactory.create()');
            expect(result.compiled.code).toContain('namespace.Factory.create("lgd.named"');
            expect(result.compiled.code).toContain('new namespace.Native("lgd.reexport"');
            expect(result.compiled.code).toContain('new Foreign(9)');
            expect(runFile(directory, 'Main')).toEqual({ commandName: 'lgd.run', command: { title: 'Run', command: 'lgd.run' }, emptyOwnCommand: false, independent: true,
                names: [ 'lgd.alias', 'lgd.named', 'lgd.native', 'lgd.reexport' ], foreign: 9 });
        }
        finally
        {
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });
});

describe('Construction metadata refresh and editor mappings.', () =>
{
    test('Invalidates unchanged defining-source and re-export metadata when the defining model changes.', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-construction-refresh-'));
        try
        {
            const models = new Map([[ 'Provider.lgd', 'oloo' ]]);
            const service = createService(models);
            const definition = 'export class Example { Example() {} }';
            await compileFile(service, directory, 'Provider', definition);
            await compileFile(service, directory, 'Barrel', 'export { Example } from "./Provider.js";');
            const source = 'import { Example } from "./Barrel.js"; new Example();';
            const document = makeTextDocument(`file://${path.join(directory, 'Consumer.lgd')}`, source);
            const state = await service.openDocument(document);
            expect(state.jsDocument.getText()).toContain('Example.create()');
            const before = service.exportCache.get(path.join(directory, 'Provider.lgd')).signature;
            models.set('Provider.lgd', 'class');
            await service.invalidateFile(path.join(directory, 'Provider.lgd'));
            expect(state.jsDocument.getText()).toContain('new Example()');
            const after = service.exportCache.get(path.join(directory, 'Provider.lgd')).signature;
            expect(after).not.toBe(before);
            expect(state.externals.moduleExports.get('./Barrel.js').get('Example').constructionKind).toBe('native');
        }
        finally
        {
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });

    test('Preserves constructor visibility through a named CommonJS destructuring import.', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-construction-access-'));
        try
        {
            const service = createService(new Map());
            await compileFile(service, directory, 'Provider', 'class Restricted { private Restricted() {} public Restricted(Number value) {} } module.exports = { Restricted };');
            const source = 'const { Restricted: Alias } = require("./Provider.js"); new Alias(); new Alias("bad");';
            const document = makeTextDocument(`file://${path.join(directory, 'Consumer.lgd')}`, source);
            const externals = await service.collectExternalTypes(document);
            const result = LgdCompiler.create().compileToJs(source, externals);
            expect(result.code).toContain('Alias.create()');
            expect(result.errors).toEqual(expect.arrayContaining([
                expect.objectContaining({ code: 'lgd.access.inaccessible' }),
                expect.objectContaining({ code: 'lgd.constructor.argumentType', offset: source.indexOf('"bad"') })
            ]));
        }
        finally
        {
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });

    test('Reports established cross-model inheritance instead of hiding its unsupported lifecycle.', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-construction-inheritance-'));
        try
        {
            const models = new Map([ [ 'Factory.lgd', 'oloo' ], [ 'Native.lgd', 'class' ] ]);
            const service = createService(models);
            await compileFile(service, directory, 'Factory', 'class Parent { Parent() {} } module.exports = Parent;');
            await compileFile(service, directory, 'Native', 'class Parent { Parent() {} } module.exports = Parent;');
            for(const [ provider, consumerModel ] of [ [ 'Factory', 'class' ], [ 'Native', 'oloo' ] ])
            {
                const source = `const Parent = require("./${provider}.js");\nclass Child : Parent { Child() : base() {} }\nnew Child();`;
                const document = makeTextDocument(`file://${path.join(directory, 'Consumer.lgd')}`, source);
                const externals = await service.collectExternalTypes(document);
                const result = LgdCompiler.create().compileToJs(source, externals, { javascriptObjectModel: consumerModel });
                expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.output.mixedBase', offset: source.indexOf('Parent {') })]));
            }
        }
        finally
        {
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });

    test('Keeps original new-call overload previews on the callee, new keyword and erroneous argument.', async () =>
    {
        const source = 'class Command { Command() {} Command(String name, Number count) {} }\nconst full = new Command("run", "bad");';
        const service = createService(new Map());
        const document = makeTextDocument('file:///workspace/Command.lgd', source);
        const state = await service.openDocument(document);
        expect(state.jsDocument.getText()).toContain('Command.create("run", "bad")');
        for(const offset of [ source.indexOf('new Command'), source.indexOf('Command("run"'), source.indexOf('"bad"') ])
        {
            const detail = LgdConstructorHover.get(state, document.positionAt(offset));
            expect(detail).not.toBeNull();
            expect(detail.native).toBe(true);
            expect(detail.name).toBe('new Command');
            expect(LgdConstructorHover.render(detail)).toContain('new Command(String name, Number count)');
        }
    });
});
