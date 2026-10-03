const fs = require('fs');
const path = require('path');
const virtualMachine = require('vm');
const { Oloo } = require('@mavega/oloo');
const vscode = require('vscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');
const LgdCodeActionProvider = require('../../../src/Lgd/LgdCodeActionProvider');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const DiagnosticQuickFix = require('../../../src/Lgd/QuickFixes/DiagnosticQuickFix');
const { makeTextDocument } = require('./fakeVscode');

/** @description Exercises transported diagnostics and real dependency snapshots against the reported partial class. */
async function setup(source, baseSource, options = {})
{
    const document = makeTextDocument('file:///workspace/GoToLastParagraph.lgd', source);
    const base = makeTextDocument('file:///workspace/BaseCommand.lgd', baseSource);
    document.version = 1;
    base.version = 1;
    const mirrorApi = require('./fakeVscode').createFakeVscode(jest);

    vscode.workspace.applyEdit.mockImplementation(mirrorApi.workspace.applyEdit);
    vscode.workspace.openTextDocument.mockImplementation(uri =>
    {
        if(uri.fsPath === base.uri.fsPath)
        {
            return base;
        }

        return mirrorApi.workspace.openTextDocument(uri);
    });

    const diagnostics = new Map();
    const collection = { set: (uri, entries) => diagnostics.set(uri.toString(), entries), delete: uri => diagnostics.delete(uri.toString()) };
    const service = LgdLanguageService.create(collection, error =>
    {
        throw error;
    });

    service.getOutputOptions = () => options;
    await service.openDocument(base);
    await service.openDocument(document);
    const provider = LgdCodeActionProvider.create(service);
    const range = new vscode.Range(document.positionAt(0), document.positionAt(source.length));
    const actions = await provider.provideCodeActions(document, range, { diagnostics: JSON.parse(JSON.stringify(diagnostics.get(document.uri.toString()))) }, {});
    return { document: document, base: base, service: service, provider: provider, actions: actions, diagnostics: diagnostics };
}

/** @description Builds a valid already-migrated command base with inspectable constructor effects. */
function classBase(virtual = true)
{
    return [
        '/** @type {BaseCommandType} */',
        'class BaseCommand {',
        '    BaseCommand(String commandName, String title) {',
        '        this.command = { command: commandName, title: title };',
        '        this.history = [];',
        '    }',
        `    ${virtual ? 'virtual ' : ''}async executeCommand() {}`,
        '}',
        'module.exports = BaseCommand;'
    ].join('\r\n');
}

/** @description Applies a verified source proposal to its original snapshot without changing the mock editor. */
function apply(proposal)
{
    return proposal.target.text.slice(0, proposal.offset) + proposal.newText + proposal.target.text.slice(proposal.endOffset);
}

jest.mock('vscode', () =>
{
    const api = require('./fakeVscode').createFakeVscode(jest);

    api.window = { setStatusBarMessage: jest.fn() };
    api.CodeAction = jest.fn((title, kind) => ({ title: title, kind: kind }));
    api.CodeActionKind = { QuickFix: { value: 'quickfix' } };
    api.Uri = { file: filename => require('./fakeVscode').makeTextDocument(`file://${filename}`, '').uri };
    return api;
});

/** @description Unmodified source from the reported GoToLastParagraph class. */
let reported;
beforeAll(async () =>
{
    reported = await fs.promises.readFile(path.join(__dirname, '../../fixtures/partial-class-go-to-last-paragraph.lgd'), 'utf8');
});

describe('partially migrated class quick fixes', () =>
{
    test.each([ 'oloo', 'class' ])('migrates the exact report against a verified class base in %s output', async javascriptObjectModel =>
    {
        const example = await setup(reported, classBase(), { javascriptObjectModel: javascriptObjectModel });
        const actions = example.actions.filter(action => action.title.startsWith('Migrate'));
        expect(actions).toHaveLength(1);
        const proposal = example.provider.proposals.get(actions[0].command.arguments[0]);
        const converted = apply(proposal);
        expect(converted).toContain('class GoToLastParagraph : BaseCommand {');
        expect(converted).toContain('GoToLastParagraph() : base("lgd.goToLastParagraph", "Go To Last Paragraph") {}');
        expect(converted).toContain('override async executeCommand()');
        expect(converted.slice(converted.indexOf('async executeCommand'))).toBe(reported.slice(reported.indexOf('async executeCommand')));
        const externals = example.service.getState(example.document.uri).externals;
        const compiler = LgdCompiler.create();
        const compiled = compiler.compileToJs(converted, externals, { javascriptObjectModel: javascriptObjectModel });
        expect(compiled.errors.filter(error => error.severity !== 'warning')).toEqual([]);
        expect(compiler.compileToTs(converted, externals).errors.filter(error => error.severity !== 'warning')).toEqual([]);
        const baseModule = { exports: {} };
        virtualMachine.runInNewContext(compiler.compileToJs(classBase(), new Map(), { javascriptObjectModel: javascriptObjectModel }).code, { module: baseModule });
        const childModule = { exports: {} };
        const modules = new Map([ [ '@mavega/oloo', { Oloo: Oloo } ], [ './BaseCommand', baseModule.exports ], [ 'vscode', { window: {} } ] ]);
        virtualMachine.runInNewContext(compiled.code, { module: childModule, require: specifier => modules.get(specifier) });
        const first = javascriptObjectModel === 'class' ? new childModule.exports() : childModule.exports.create();
        const second = javascriptObjectModel === 'class' ? new childModule.exports() : childModule.exports.create();
        expect({ ...first.command }).toEqual({ command: 'lgd.goToLastParagraph', title: 'Go To Last Paragraph' });
        expect(first.history).not.toBe(second.history);
        await expect(first.executeCommand()).resolves.toBeUndefined();
        example.base.version++;
        expect(DiagnosticQuickFix.canApply(proposal)).toBe(false);
    });

    test.each([ 'BaseCommand', 'BaseCommandType' ])('deduplicates class @extends {%s} and create actions and removes empty docs', async typeName =>
    {
        const source = reported.replace('/**\r\n* @description Command to help navigate in a window.\r\n*/', `/** @extends {${typeName}} */`);
        const example = await setup(source, classBase());
        expect(example.actions.filter(action => action.title.startsWith('Migrate'))).toHaveLength(1);
        const action = example.actions.find(candidate => candidate.title.startsWith('Migrate'));
        expect(action.diagnostics).toHaveLength(2);
        const converted = apply(example.provider.proposals.get(action.command.arguments[0]));
        expect(converted).not.toContain('@extends');
        expect(converted).not.toContain('/**  */');
        expect(converted).toContain('@description Initialize an instance');
    });

    test('preserves a completed constructor while migrating a documented base alias', async () =>
    {
        const source = 'const Object BaseCommand = require("./BaseCommand");\r\n/** @extends {BaseCommandType} */\r\nclass Child { Child() {} }';
        const baseSource = '/** @type {BaseCommandType} */\r\nclass BaseCommand {}\r\nmodule.exports = BaseCommand;';
        const example = await setup(source, baseSource);
        expect(example.actions).toHaveLength(1);
        const converted = apply(example.provider.proposals.get(example.actions[0].command.arguments[0]));
        expect(converted).toContain('class Child : BaseCommand { Child() {} }');
    });

    test('atomically prepares nonvirtual class base methods with keyword syntax', async () =>
    {
        const example = await setup(reported, classBase(false));
        const action = example.actions.find(candidate => candidate.title.startsWith('Migrate'));
        expect(action).toBeDefined();
        const proposal = example.provider.proposals.get(action.command.arguments[0]);
        expect(proposal.additionalEdits).toHaveLength(1);
        expect(proposal.additionalEdits[0].newText).toContain('virtual async executeCommand');
        expect(proposal.additionalEdits[0].newText).not.toContain('@virtual');
        expect(example.actions.some(candidate => candidate.title.startsWith('Make BaseCommand.executeCommand virtual'))).toBe(true);
    });

    test.each([
        [ 'create()', 'static create()' ],
        [ 'create()', 'async create()' ],
        [ 'class GoToLastParagraph {', 'class GoToLastParagraph { GoToLastParagraph() {}' ],
        [ 'class GoToLastParagraph {', 'class GoToLastParagraph : OtherBase {' ],
        [ 'BaseCommand.create("lgd.goToLastParagraph"', 'BaseCommand.create(this.commandName' ],
        [ 'return goToLastParagraph;', 'goToLastParagraph.extra = true; return goToLastParagraph;' ],
        [ 'return goToLastParagraph;', '// retain this factory note\r\n    return goToLastParagraph;' ],
        [ '@description Command to help navigate in a window.', '@extends {MissingType}' ]
    ])('does not guess unsafe factory changes: %s', async (before, after) =>
    {
        const example = await setup(reported.replace(before, after), classBase());
        expect(example.actions.filter(action => action.title.startsWith('Migrate'))).toEqual([]);
    });
});

describe('constructor spelling quick fixes', () =>
{
    test.each([ 'oloo', 'class' ])('renames a guarded constructor and preserves its body in %s output', async javascriptObjectModel =>
    {
        const source = '/** @description Keeps docs. */\r\nclass Example {\r\n    /** @description Initializes state. */\r\n    constructor(String title = "ready") { this.title = title; }\r\n}';
        const example = await setup(source, classBase(), { javascriptObjectModel: javascriptObjectModel });
        expect(example.actions).toHaveLength(1);
        expect(example.actions[0].title).toBe("Rename constructor to 'Example'");
        const proposal = example.provider.proposals.get(example.actions[0].command.arguments[0]);
        expect(apply(proposal)).toBe(source.replace('constructor(', 'Example('));
        const compiled = LgdCompiler.create().compileToJs(apply(proposal), new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(compiled.errors).toEqual([]);
        expect(compiled.declarations[0].constructorMember.params[0]).toMatchObject({ name: 'title', typeName: 'String', defaultText: '"ready"' });
        example.document.setText(apply(proposal));
        example.document.version++;
        const refreshed = await example.service.updateDocument(example.document);
        expect(refreshed.errors).toEqual([]);
        expect(refreshed.jsDocument.getText()).not.toContain('(String title');
        if(javascriptObjectModel === 'oloo')
        {
            expect(refreshed.jsDocument.getText()).not.toContain('constructor(title');
        }

        const position = example.document.positionAt(example.document.getText().indexOf('Example'));
        const hover = await LgdHoverProvider.create(example.service).provideHover(example.document, position);
        expect(hover.contents).toContain('create(String title)');
        expect(DiagnosticQuickFix.canApply(proposal)).toBe(false);
    });

    test('combines inheritance documentation and constructor spelling without a dead-end intermediate state', async () =>
    {
        const source = 'const Object BaseCommand = require("./BaseCommand");\r\n/** @extends {BaseCommandType} */\r\nclass Child { constructor() { this.ready = true; } }';
        const baseSource = '/** @type {BaseCommandType} */\r\nclass BaseCommand {}\r\nmodule.exports = BaseCommand;';
        const example = await setup(source, baseSource);
        expect(example.actions).toHaveLength(1);
        const proposal = example.provider.proposals.get(example.actions[0].command.arguments[0]);
        expect(apply(proposal)).toContain('class Child : BaseCommand { Child() { this.ready = true; } }');
        expect(example.actions[0].diagnostics).toHaveLength(2);
    });

    test.each([
        'class Example { constructor() {} Example() {} }',
        'class Example { constructor() {} create() {} }',
        'class Example { constructor() {} constructor(Number value) {} }',
        'class Example { async constructor() {} }',
        'class Example { Object constructor() {} }'
    ])('declines conflicting constructor forms: %s', async source =>
    {
        const example = await setup(source, classBase());
        expect(example.actions).toEqual([]);
    });
});

describe('named constructor factory migration', () =>
{
    test('offers the canonical inherited allocation migration on the named-constructor screenshot', async () =>
    {
        const source = reported.replace('create()', 'GoToLastParagraph()');
        const example = await setup(source, classBase());
        const actions = example.actions.filter(action => action.title.startsWith('Migrate'));
        expect(actions).toHaveLength(1);
        const converted = apply(example.provider.proposals.get(actions[0].command.arguments[0]));
        expect(converted).toContain('GoToLastParagraph() : base("lgd.goToLastParagraph", "Go To Last Paragraph") {}');
        expect(converted).not.toContain('return goToLastParagraph;');
        expect(LgdCompiler.create().compileToJs(converted, example.service.getState(example.document.uri).externals).errors.filter(error => error.severity !== 'warning')).toEqual([]);
    });

    test.each([ 'BaseCommand', 'constructor', 'create' ])('migrates the original BaseCommand root factory using %s spelling', async spelling =>
    {
        const original = await fs.promises.readFile(path.join(__dirname, '../../fixtures/basecommand.lgd'), 'utf8');
        const source = original.replace('BaseCommand(String commandName', `${spelling}(String commandName`);
        const example = await setup(source, classBase());
        const actions = example.actions.filter(action => action.title.includes('factory to instance initialization'));
        expect(actions).toHaveLength(1);
        const converted = apply(example.provider.proposals.get(actions[0].command.arguments[0]));
        expect(converted).toContain('BaseCommand(String commandName, String title)');
        expect(converted).toContain('this.command = {');
        expect(converted).toContain('/** @type {vscode.Command} */');
        expect(converted).not.toContain('const Object baseCommand');
        expect(converted).not.toContain('return baseCommand;');
        expect(converted.slice(converted.indexOf('get commandName'))).toBe(source.slice(source.indexOf('get commandName')));
        const compiled = LgdCompiler.create().compileToJs(converted);
        expect(compiled.errors.filter(error => error.severity !== 'warning')).toEqual([]);
        const module = { exports: {} };
        virtualMachine.runInNewContext(compiled.code, { module: module, require: () => ({}) });
        const first = module.exports.create('first', 'First');
        const second = module.exports.create('second', 'Second');
        expect(first.commandName).toBe('first');
        expect(second.commandName).toBe('second');
        expect(first.command).not.toBe(second.command);
    });

    test.each([ 'oloo', 'class' ])('preserves fields, comments and initializer order in the %s root migration', async javascriptObjectModel =>
    {
        const source = [
            'class Example {',
            '    Number count = 0;',
            '    Example(Function record) {',
            '        // Keep allocation context.',
            '        const Object instance = Object.create(Example);',
            '        instance.count = record(1);',
            '        // Keep second initialization.',
            '        instance.label = record(2);',
            '        return instance;',
            '    }',
            '}',
            'module.exports = Example;'
        ].join('\r\n');
        const example = await setup(source, classBase(), { javascriptObjectModel: javascriptObjectModel });
        const actions = example.actions.filter(action => action.title.includes('factory to instance initialization'));
        expect(actions).toHaveLength(1);
        const converted = apply(example.provider.proposals.get(actions[0].command.arguments[0]));
        expect(converted).toContain('Number count = 0;');
        expect(converted).toContain('// Keep allocation context.');
        expect(converted).toContain('// Keep second initialization.');
        const compiled = LgdCompiler.create().compileToJs(converted, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(compiled.errors).toEqual([]);
        const module = { exports: {} };
        virtualMachine.runInNewContext(compiled.code, { module: module });
        const calls = [];
        function record(value)
        {
            calls.push(value);
            return value;
        }

        const instance = javascriptObjectModel === 'class' ? new module.exports(record) : module.exports.create(record);
        expect(calls).toEqual([ 1, 2 ]);
        expect(instance.count).toBe(1);
        expect(instance.label).toBe(2);
    });

    test.each([
        'save(instance);',
        'instance.child = instance;',
        'instance.count = instance.count + 1;',
        'instance.callback = () => instance;',
        'instance.count = this.count;',
        'instance[key()] = 1;',
        'if(ready) { instance.count = 1; }',
        'instance.count += 1;'
    ])('does not rewrite escaping aliases or extra factory work: %s', async work =>
    {
        const source = `class Example {\r\n    Example() {\r\n        const Object instance = Object.create(Example);\r\n        ${work}\r\n        return instance;\r\n    }\r\n}`;
        const example = await setup(source, classBase());
        expect(example.actions.filter(action => action.title.startsWith('Migrate'))).toEqual([]);
    });

    test('does not merely rename a constructor returning an arbitrary object', async () =>
    {
        const example = await setup('class Example { constructor() { return makeOtherObject(); } }', classBase());
        expect(example.actions).toEqual([]);
    });

    test('declines a class base whose constructor still returns a separate allocation', async () =>
    {
        const invalidBase = classBase().replace('this.command = {', 'return {');
        const example = await setup(reported, invalidBase);
        expect(example.actions.filter(action => action.title.startsWith('Migrate'))).toEqual([]);
    });

    test.each([ 'const Object instance = Object.create(/* preserve */ Example);', 'return /* preserve */ instance;' ])('retains comments inside removed allocation statements: %s', async statement =>
    {
        let source = 'class Example {\r\n    Example() {\r\n        const Object instance = Object.create(Example);\r\n        instance.value = 1;\r\n        return instance;\r\n    }\r\n}';
        source = statement.startsWith('const') ? source.replace('const Object instance = Object.create(Example);', statement) : source.replace('return instance;', statement);
        const example = await setup(source, classBase());
        expect(example.actions.filter(action => action.title.startsWith('Migrate'))).toEqual([]);
    });

    test.each([ 'Function Object', '' ])('does not remove a shadowed Object allocator (%s)', async parameters =>
    {
        const prefix = parameters ? '' : 'const Object = customAllocator;\r\n';
        const source = `${prefix}class Example {\r\n    Example(${parameters}) {\r\n        const Object instance = Object.create(Example);\r\n        instance.value = 1;\r\n        return instance;\r\n    }\r\n}`;
        const example = await setup(source, classBase());
        expect(example.actions.filter(action => action.title.startsWith('Migrate'))).toEqual([]);
    });

    test.each([ 'this.executeCommand();', 'save(this);', 'this.command = this.makeCommand();', 'this.executeCommand = callback;' ])('does not change constructor-time receiver behavior: %s', async work =>
    {
        const baseSource = classBase().replace('this.history = [];', work);
        const example = await setup(reported, baseSource);
        expect(example.actions.filter(action => action.title.startsWith('Migrate'))).toEqual([]);
    });
});
