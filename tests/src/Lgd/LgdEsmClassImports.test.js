const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

/** @description A real LGD class whose declared fields require class-backed initialization. */
const BASE_SOURCE = [
    '/** @description Shared command state. */',
    'class BaseCommand {',
    '    String title;',
    '    BaseCommand(String title) { this.title = title; }',
    '    virtual String read() { return title; }',
    '}'
].join('\r\n');

/** @description Creates a source document in the test module graph. */
function sourceDocument(directory, name, source)
{
    return makeTextDocument(`file://${path.join(directory, name)}`, source);
}

/** @description Runs emitted JavaScript as real Node ESM, loading only a local foreign-module stub. */
async function executeModules(directory, baseCode, childCode, commonJs = false)
{
    await fs.promises.writeFile(path.join(directory, 'package.json'), JSON.stringify({ type: commonJs ? 'commonjs' : 'module' }));
    await fs.promises.writeFile(path.join(directory, 'BaseCommand.js'), baseCode);
    await fs.promises.writeFile(path.join(directory, 'Child.mjs'), childCode);
    const stub = path.join(directory, 'node_modules/vscode');
    await fs.promises.mkdir(stub, { recursive: true });
    await fs.promises.writeFile(path.join(stub, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
    await fs.promises.writeFile(path.join(stub, 'index.js'), 'export default { marker: "foreign" };');
    const runner = [
        `import Oloo from ${JSON.stringify(require.resolve('@mavega/oloo'))};`,
        'globalThis.Oloo = Oloo.Oloo;',
        'const { default: Child } = await import("./Child.mjs");',
        'const first = Child.create("ready");',
        'const second = Child.create("next");',
        'first.items.push(1);',
        'console.log(JSON.stringify([first.read(), second.read(), first.items, second.items, first.foreign()]));'
    ].join('\n');
    await fs.promises.writeFile(path.join(directory, 'Run.mjs'), runner);
    return JSON.parse(execFileSync(process.execPath, [path.join(directory, 'Run.mjs')], { encoding: 'utf8' }).trim());
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

describe('source-backed LGD ESM class imports', () =>
{
    let directory;
    let service;
    let failures;

    beforeEach(async () =>
    {
        vscode.__reset();
        directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-esm-classes-'));
        failures = [];
        service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, error => failures.push(error));
    });

    afterEach(async () =>
    {
        await service.pendingDependencyUpdates;
        await fs.promises.rm(directory, { recursive: true, force: true });
        expect(failures).toEqual([]);
    });

    test('compiles the reported extensionless ESM class-base fixture and keeps source-backed hover details', async () =>
    {
        const fixtures = path.join(__dirname, '../../fixtures/esm-class-base');
        const base = await fs.promises.readFile(path.join(fixtures, 'BaseCommand.lgd'), 'utf8');
        const source = await fs.promises.readFile(path.join(fixtures, 'GoToAssignment.lgd'), 'utf8');
        await fs.promises.writeFile(path.join(directory, 'BaseCommand.lgd'), base);
        const document = sourceDocument(directory, 'GoToAssignment.lgd', source);
        const state = await service.openDocument(document);
        expect(state.errors).toEqual([]);
        const hover = await LgdHoverProvider.create(service).provideHover(document, document.positionAt(source.indexOf('GoToAssignment :')));
        expect(hover.contents).toContain('class GoToAssignment : BaseCommand');
        expect(hover.contents).toContain('title: String');
        expect(hover.contents).toContain('assignmentIndex: Number');
        expect(hover.contents).toContain('readTitle()');
        expect(hover.contents).toContain('Command to go to the start of an assignment.');
        const nativeOptions = { javascriptObjectModel: 'class' };
        service.getOutputOptions = () => nativeOptions;
        const nativeExternals = await service.collectExternalTypes(document);
        expect(nativeExternals.get('./BaseCommand').constructionKind).toBe('native');
        const native = service.compiler.compileToJs(source, nativeExternals, nativeOptions);
        expect(native.errors.map(error => error.code)).toEqual(['lgd.output.fieldInitializationOrder']);
    });

    test.each([
        [ 'export default BaseCommand;', false ],
        [ 'export { BaseCommand as default };', false ],
        [ 'module.exports = BaseCommand;', true ]
    ])('resolves a default import from %s and preserves field initialization in actual ESM runtime', async (exportText, commonJs) =>
    {
        const baseSource = `${BASE_SOURCE}\r\n${exportText}`;
        await fs.promises.writeFile(path.join(directory, 'BaseCommand.lgd'), baseSource);
        const source = [
            'import BaseCommand from "./BaseCommand.js";',
            'import vscode from "vscode";',
            '/** @description Goes to an assignment. */',
            'class Child : BaseCommand {',
            '    Array items = [];',
            '    Child(String title) : base(title) {}',
            '    String foreign() { return vscode.marker; }',
            '}',
            'export default Child;'
        ].join('\r\n');
        const document = sourceDocument(directory, 'Child.lgd', source);
        const state = await service.openDocument(document);
        expect(state.errors).toEqual([]);
        expect(state.externals.has('vscode')).toBe(false);
        expect(state.jsDocument.getText()).toContain('import vscode from "vscode";');
        expect(state.declarations[0].baseIsLgdClass).toBe(true);
        const base = service.compiler.compileToJs(baseSource);
        expect(base.errors).toEqual([]);
        expect(await executeModules(directory, base.code, state.jsDocument.getText(), commonJs)).toEqual([ 'ready', 'next', [1], [], 'foreign' ]);
        const hover = await LgdHoverProvider.create(service).provideHover(document, document.positionAt(source.indexOf('Child :')));
        expect(hover.contents).toContain('class Child : BaseCommand');
        expect(hover.contents).toContain('title: String');
        expect(hover.contents).toContain('items: Array');
        expect(hover.contents).toContain('read()');
        expect(hover.contents).toContain('Goes to an assignment.');
        const importedHover = await LgdHoverProvider.create(service).provideHover(document, document.positionAt(source.indexOf('BaseCommand from')));
        expect(importedHover.contents).toContain('Shared command state.');
    });

    test.each([ './BaseCommand', './BaseCommand.lgd', './BaseCommand.js', './BaseCommand.lgd.js' ])('uses existing relative LGD source mappings for %s', async spec =>
    {
        await fs.promises.writeFile(path.join(directory, 'BaseCommand.lgd'), `${BASE_SOURCE}\nexport default BaseCommand;`);
        const source = `import command from "${spec}";\nconst Alias = command;\nclass Child : Alias { Number count; Child() : base("ready") {} }`;
        const state = await service.openDocument(sourceDocument(directory, 'Child.lgd', source));
        expect(state.errors).toEqual([]);
        expect(state.declarations[0].baseIsLgdClass).toBe(true);
    });

    test.each([
        [ 'import { BaseCommand as Parent } from "./BaseCommand";', 'Parent' ],
        [ 'import * as commands from "./BaseCommand";', 'commands.BaseCommand' ],
        [ 'import * as commands from "./BaseCommand";\nconst Parent = commands.BaseCommand;', 'Parent' ]
    ])('resolves explicitly declared named and namespace exports: %s', async (importText, baseName) =>
    {
        await fs.promises.writeFile(path.join(directory, 'BaseCommand.lgd'), `${BASE_SOURCE}\nexport { BaseCommand };`);
        const source = `${importText}\nclass Child : ${baseName} { Number count; Child() : base("ready") {} }`;
        const document = sourceDocument(directory, 'Child.lgd', source);
        const state = await service.openDocument(document);
        expect(state.errors).toEqual([]);
        expect((await service.getTypeSummary(document.uri, 'Child')).members.map(member => member.name)).toEqual(expect.arrayContaining([ 'title', 'count', 'read', 'create' ]));
    });

    test('runs namespace inheritance from an explicitly exported class and imported factory receivers', async () =>
    {
        const baseSource = BASE_SOURCE.replace('class BaseCommand', 'export class BaseCommand');
        await fs.promises.writeFile(path.join(directory, 'BaseCommand.lgd'), baseSource);
        const source = [
            'import * as commands from "./BaseCommand.js";',
            'import vscode from "vscode";',
            'class Child : commands.BaseCommand {',
            '    Array items = [];',
            '    Child(String title) : base(title) {}',
            '    String foreign() { return vscode.marker; }',
            '}',
            'const sample = commands.BaseCommand.create("sample");',
            'sample.read();',
            'export default Child;'
        ].join('\n');
        const document = sourceDocument(directory, 'Child.lgd', source);
        const state = await service.openDocument(document);
        expect(state.errors).toEqual([]);
        const base = service.compiler.compileToJs(baseSource);
        expect(base.errors).toEqual([]);
        expect(await executeModules(directory, base.code, state.jsDocument.getText())).toEqual([ 'ready', 'next', [1], [], 'foreign' ]);
    });

    test.each([ 'oloo', 'class' ])('keeps require and default-import field/base diagnostics equivalent in %s output', async objectModel =>
    {
        await fs.promises.writeFile(path.join(directory, 'BaseCommand.lgd'), `${BASE_SOURCE}\nmodule.exports = BaseCommand;`);
        service.getOutputOptions = () => ({ javascriptObjectModel: objectModel });
        const child = 'class Child : BaseCommand { Number count; Child() : base("ready") {} }';
        const required = await service.openDocument(sourceDocument(directory, 'Required.lgd', `const BaseCommand = require("./BaseCommand");\n${child}`));
        const imported = await service.openDocument(sourceDocument(directory, 'Imported.lgd', `import BaseCommand from "./BaseCommand";\n${child}`));
        expect(imported.errors.map(error => error.code)).toEqual(required.errors.map(error => error.code));
        expect(imported.errors.some(error => error.code === 'lgd.member.foreignBaseFields' || error.code === 'lgd.member.unresolvedBaseImport')).toBe(false);
        if(objectModel === 'class')
        {
            expect(imported.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.output.fieldInitializationOrder' })]));
        }
        else
        {
            expect(imported.errors).toEqual([]);
        }
    });

    test.each([
        [ 'import Parent from "./BaseCommand";', 'Parent', 'const Alias = Parent;\nclass Child : Alias { Number count; }' ],
        [ 'import * as commands from "./BaseCommand";', 'commands', 'class Child : commands.BaseCommand { Number count; }' ]
    ])('keeps parameter-shadowed imports unresolved instead of promoting a class identity: %s', async (importText, parameter, body) =>
    {
        await fs.promises.writeFile(path.join(directory, 'BaseCommand.lgd'), `${BASE_SOURCE}\nexport default BaseCommand;\nexport { BaseCommand };`);
        const source = `${importText}\nfunction create(${parameter}) {\n${body}\n}`;
        const state = await service.openDocument(sourceDocument(directory, 'Shadowed.lgd', source));
        expect(state.errors.some(error => error.code === 'lgd.member.foreignBaseFields' || error.code === 'lgd.member.unresolvedBaseImport')).toBe(true);
        expect(state.declarations.find(declaration => declaration.name === 'Child').baseIsLgdClass).toBe(false);
    });

    test('does not infer class identity from default-export calls or dynamic import text', async () =>
    {
        await fs.promises.writeFile(path.join(directory, 'Factory.lgd'), `${BASE_SOURCE}\nexport default BaseCommand.create();`);
        const invalid = await service.openDocument(sourceDocument(directory, 'Invalid.lgd', 'import Parent from "./Factory";\nclass Child : Parent { Number count; }'));
        expect(invalid.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.member.unresolvedBaseImport' })]));
        await fs.promises.writeFile(path.join(directory, 'BaseCommand.lgd'), `${BASE_SOURCE}\nexport default BaseCommand;`);
        const source = [
            'const future = import ("./foreign")',
            'import Parent from "./BaseCommand";',
            '// import Fake from "./NotAClass";',
            'const example = "import Other from \\"./NotAClass\\";";',
            'class Child : Parent { Number count; Child() : base("ready") {} }'
        ].join('\n');
        const document = sourceDocument(directory, 'Dynamic.lgd', source);
        const externals = await service.collectExternalTypes(document);
        expect(externals.get('./BaseCommand').kind).toBe('class');
        expect(externals.has('./foreign')).toBe(false);
        expect(externals.has('./NotAClass')).toBe(false);
    });

    test('reuses unchanged ESM source caches and refreshes imports when a missing source appears', async () =>
    {
        const basePath = path.join(directory, 'Missing.lgd');
        const source = 'import Parent from "./Missing";\nclass Child : Parent { Number count; Child() : base("ready") {} }';
        const document = sourceDocument(directory, 'Child.lgd', source);
        const state = await service.openDocument(document);
        expect(state.errors.some(error => error.code === 'lgd.member.unresolvedBaseImport')).toBe(true);
        await fs.promises.writeFile(basePath, `${BASE_SOURCE}\nexport default BaseCommand;`);
        await service.invalidateFile(basePath);
        expect(state.errors).toEqual([]);
        const parse = jest.spyOn(service.compiler, 'parse');
        const read = jest.spyOn(fs.promises, 'readFile');
        document.setText(`${source}\n// consumer edit`);
        await service.updateDocument(document);
        await service.pendingDependencyUpdates;
        expect(parse).toHaveBeenCalledTimes(1);
        expect(read).not.toHaveBeenCalled();
        parse.mockRestore();
        read.mockRestore();
        document.setText('Number count = 1;');
        await service.updateDocument(document);
        await service.pendingDependencyUpdates;
        expect(service.dependents.has(basePath)).toBe(false);
    });

    test('never guesses undeclared named CommonJS exports and distinguishes unresolved imports from object factories', async () =>
    {
        await fs.promises.writeFile(path.join(directory, 'BaseCommand.lgd'), `${BASE_SOURCE}\nmodule.exports = BaseCommand;`);
        const unknown = await service.openDocument(sourceDocument(directory, 'Unknown.lgd', 'import { BaseCommand } from "./BaseCommand";\nclass Child : BaseCommand { Number count; }'));
        expect(unknown.errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: "Cannot resolve imported base 'BaseCommand' from './BaseCommand'. Export an LGD class with the requested import name." })]));
        await fs.promises.writeFile(path.join(directory, 'Factory.lgd'), 'Object Factory = { create() { return this; } };\nexport default Factory;');
        const factory = await service.openDocument(sourceDocument(directory, 'FactoryChild.lgd', 'import Factory from "./Factory";\nclass Child : Factory { Number count; }'));
        expect(factory.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.member.foreignBaseFields', message: expect.stringContaining("Base 'Factory' is not a known LGD class") })]));
        const missing = await service.openDocument(sourceDocument(directory, 'MissingChild.lgd', 'import Missing from "./Missing";\nclass Child : Missing { Number count; }'));
        expect(missing.errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("Cannot resolve imported base 'Missing' from './Missing'") })]));
        const upperCase = LgdCompiler.create().compileToJs('const UpperCase = makeFactory();\nclass Child : UpperCase { Number count; }');
        expect(upperCase.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.member.foreignBaseFields' })]));
    });

    test('preserves native class support and its inherited declared-field order guard for ESM imports', async () =>
    {
        const baseSource = `${BASE_SOURCE.replace('    String title;\r\n', '').replace('return title;', 'return this.title;')}\nexport default BaseCommand;`;
        await fs.promises.writeFile(path.join(directory, 'BaseCommand.lgd'), baseSource);
        service.getOutputOptions = () => ({ javascriptObjectModel: 'class' });
        const source = 'import BaseCommand from "./BaseCommand.js";\nimport vscode from "vscode";\nclass Child : BaseCommand { Child(String title) : base(title) { this.items = []; } String foreign() { return vscode.marker; } }\nexport default Child;';
        const state = await service.openDocument(sourceDocument(directory, 'Child.lgd', source));
        expect(state.errors).toEqual([]);
        const base = service.compiler.compileToJs(baseSource, new Map(), { javascriptObjectModel: 'class' });
        expect(base.errors).toEqual([]);
        expect(await executeModules(directory, base.code, state.jsDocument.getText())).toEqual([ 'ready', 'next', [1], [], 'foreign' ]);
        const guarded = service.compiler.compileToJs(source.replace('Child(String title)', 'Number count; Child(String title)'), state.externals, { javascriptObjectModel: 'class' });
        expect(guarded.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.output.fieldInitializationOrder' })]));
        expect(guarded.errors.some(error => error.code === 'lgd.member.foreignBaseFields')).toBe(false);
    });

    test('follows explicit reexports and local import aliases and refreshes a named ancestor across cache edits', async () =>
    {
        const original = `${BASE_SOURCE}\nexport { BaseCommand };`;
        const baseDocument = sourceDocument(directory, 'BaseCommand.lgd', original);
        await fs.promises.writeFile(path.join(directory, 'BaseCommand.lgd'), original);
        await fs.promises.writeFile(path.join(directory, 'Alias.lgd'), 'import { BaseCommand as Parent } from "./BaseCommand";\nconst Alias = Parent;\nexport { Alias as default };');
        await fs.promises.writeFile(path.join(directory, 'Bridge.lgd'), 'export { default as Parent } from "./Alias";');
        const consumer = sourceDocument(directory, 'Child.lgd', 'import { Parent } from "./Bridge";\nclass Child : Parent { Number count; Child() : base("ready") {} }');
        const state = await service.openDocument(consumer);
        expect(state.errors).toEqual([]);
        await service.openDocument(baseDocument);
        await service.pendingDependencyUpdates;
        const compile = jest.spyOn(service.compiler, 'compileToJs');
        baseDocument.setText(original.replaceAll('String title', 'Number title'));
        await service.updateDocument(baseDocument);
        await service.pendingDependencyUpdates;
        expect(compile.mock.calls.map(([source]) => source)).toContain(consumer.getText());
        expect(state.errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('must be Number') })]));
        baseDocument.setText(original);
        await service.updateDocument(baseDocument);
        await service.pendingDependencyUpdates;
        expect(state.errors).toEqual([]);
    });

    test('terminates import cycles without caching incomplete ancestry or flattening reexport cycles', async () =>
    {
        await fs.promises.writeFile(path.join(directory, 'First.lgd'), 'import Second from "./Second";\nclass First : Second { virtual Number first() { return 1; } }\nexport default First;');
        await fs.promises.writeFile(path.join(directory, 'Second.lgd'), 'import First from "./First";\nclass Second : First { virtual Number second() { return 2; } }\nexport default Second;');
        const document = sourceDocument(directory, 'Child.lgd', 'import First from "./First";\nclass Child : First {}');
        const state = await service.openDocument(document);
        expect(state.jsDocument).toBeTruthy();
        const imported = state.externals.get('./First');
        expect(imported.kind).toBe('class');
        expect(imported.methodsKnown).toBe(false);
        expect(service.exportCache.get(path.join(directory, 'First.lgd')).exported).toBeUndefined();
        await fs.promises.writeFile(path.join(directory, 'LoopA.lgd'), 'export { default } from "./LoopB";');
        await fs.promises.writeFile(path.join(directory, 'LoopB.lgd'), 'export { default } from "./LoopA";');
        const looping = await service.openDocument(sourceDocument(directory, 'LoopChild.lgd', 'import Parent from "./LoopA";\nclass Child : Parent { Number count; }'));
        expect(looping.errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('Cannot resolve imported base') })]));
    });
});
