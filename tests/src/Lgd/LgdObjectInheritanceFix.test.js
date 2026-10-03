const fs = require('fs');
const path = require('path');
const virtualMachine = require('vm');
const { Oloo } = require('@mavega/oloo');
const vscode = require('vscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdCodeActionProvider = require('../../../src/Lgd/LgdCodeActionProvider');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const ConvertObjectInheritanceFix = require('../../../src/Lgd/QuickFixes/ConvertObjectInheritanceFix');
const DiagnosticQuickFix = require('../../../src/Lgd/QuickFixes/DiagnosticQuickFix');
const { makeTextDocument } = require('./fakeVscode');

/** @description Exercises conversion against an actual imported CommonJS legacy object. */
function fixture(overrides = {})
{
    const source = [
        'const { Oloo } = require("@mavega/oloo");',
        'readonly Object Base = require("./Base");',
        '/**',
        ' * @description Child documentation.',
        ' * @extends {BaseType}',
        ' */',
        'readonly Object Child = {',
        '    /** @description Creates the child. */',
        '    create() {',
        '        readonly Object child = Oloo.assign(Base.create("title"), Child);',
        '        return child;',
        '    },',
        '    /** @description Preserves the body. */',
        '    async run() {',
        '        readonly Number count = 2;',
        '        return count;',
        '    }',
        '};',
        'module.exports = Child;'
    ].join('\r\n');
    const document = makeTextDocument('file:///workspace/Child.lgd', overrides.source || source);
    document.version = 1;
    const baseSource = '/** @type {BaseType} */\r\nconst Base = { create(title) { return { title: title }; } };\r\nmodule.exports = Base;';
    const base = makeTextDocument('file:///workspace/Base.js', overrides.baseSource || baseSource);
    base.version = 1;
    vscode.workspace.openTextDocument.mockResolvedValue(base);
    const snapshot = DiagnosticQuickFix.snapshot(document);
    const compiler = LgdCompiler.create();
    const error = compiler.parse(document.getText()).errors.find(candidate => candidate.code === 'lgd.object.inheritance');
    const options = overrides.options || {};
    const context = { source: snapshot, snapshots: [snapshot], document: document, state: { externals: new Map() },
        languageService: { getOutputOptions: () => options } };

    return { context: context, fix: error.quickFix, base: base, options: options };
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

describe('legacy object inheritance conversion', () =>
{
    test.each([ false, true ])('routes transported editor diagnostics through the registered native Quick Fix (typed: %s)', async typed =>
    {
        const original = fixture();
        let source = original.context.source.text.replaceAll('Child', 'GoToLastMethod');
        if(typed)
        {
            source = source.replace('async run()', 'async Number run()');
        }

        const example = fixture({ source: source });
        const diagnostics = new Map();
        const collection = { set: (uri, entries) => diagnostics.set(uri.toString(), entries), delete: uri => diagnostics.delete(uri.toString()) };
        const service = LgdLanguageService.create(collection, error =>
        {
            throw error;
        });

        const document = example.context.document;
        await service.openDocument(document);
        const range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
        const provider = LgdCodeActionProvider.create(service);
        const editorDiagnostics = JSON.parse(JSON.stringify(diagnostics.get(document.uri.toString())));
        const actions = await provider.provideCodeActions(document, range, { diagnostics: editorDiagnostics }, {});
        expect(actions).toHaveLength(1);
        expect(actions[0].command.command).toBe('lgd.applyDiagnosticQuickFix');
        expect(actions[0].title).toBe("Convert 'GoToLastMethod' to LGD class : Base");
        expect(editorDiagnostics.find(diagnostic => diagnostic.message.includes('Object @extends')).message)
            .toBe('Object @extends inheritance is not supported in LGD. Use class GoToLastMethod : BaseClass { ... } with a compatible base class or object.');
    });

    test('preserves methods, documentation, exports, readonly locals and the OLOO allocation arguments', async () =>
    {
        const example = fixture();
        const proposal = await new ConvertObjectInheritanceFix().create(example.context, example.fix);
        expect(proposal).not.toBeNull();
        expect(proposal.newText).toContain('class Child : Base {');
        expect(proposal.newText).toContain('Child() : base("title") {}');
        expect(proposal.newText).toContain('readonly Number count = 2;');
        expect(proposal.newText).toContain('@description Child documentation.');
        expect(proposal.newText).toContain('@description Creates the child.');
        const source = example.context.source.text;
        const result = source.slice(0, proposal.offset) + proposal.newText + source.slice(proposal.endOffset);
        expect(result).toContain('module.exports = Child;');
        const compiled = LgdCompiler.create().compileToJs(result);
        expect(compiled.errors).toEqual([]);
        expect(compiled.code).toContain('Oloo.assign(Base.create("title"), Child)');
        example.base.setText(`${example.base.getText()}\r\n// changed`);
        expect(DiagnosticQuickFix.canApply(proposal)).toBe(false);
    });

    test('preserves the exported factory lifecycle and instance behavior at runtime', async () =>
    {
        const original = fixture();
        const source = original.context.source.text.replace(
            'readonly Number count = 2;',
            'this.history.push(this.title);\r\n        readonly Number count = this.history.length;'
        );
        const baseSource = [
            '/** @type {BaseType} */',
            'const Base = {',
            '    create(title) {',
            '        calls.push(title);',
            '        const instance = Object.create(Base);',
            '        instance.title = title;',
            '        instance.history = [];',
            '        return instance;',
            '    }',
            '};',
            'module.exports = Base;'
        ].join('\r\n');
        const example = fixture({ source: source, baseSource: baseSource });
        const proposal = await new ConvertObjectInheritanceFix().create(example.context, example.fix);
        expect(proposal).not.toBeNull();
        const converted = source.slice(0, proposal.offset) + proposal.newText + source.slice(proposal.endOffset);
        const outcomes = [];
        for(const program of [ source, converted ])
        {
            const calls = [];
            const baseModule = { exports: {} };
            virtualMachine.runInNewContext(baseSource, { module: baseModule, calls: calls });
            const childModule = { exports: {} };
            const modules = new Map([ [ '@mavega/oloo', { Oloo: Oloo } ], [ './Base', baseModule.exports ] ]);
            const runtimeContext = { module: childModule, require: specifier => modules.get(specifier) };

            const compiled = LgdCompiler.create().compileToJs(program);
            virtualMachine.runInNewContext(compiled.code, runtimeContext);
            const exported = childModule.exports;
            expect(typeof exported.create).toBe('function');
            const first = exported.create();
            const second = exported.create();
            expect(first).not.toBe(second);
            expect(first.history).not.toBe(second.history);
            const results = [ await first.run(), await second.run(), await first.run() ];
            const outcome = { calls: calls, results: results, firstHistory: Array.from(first.history), secondHistory: Array.from(second.history) };
            expect(outcome).toEqual({ calls: [ 'title', 'title' ], results: [ 1, 1, 2 ], firstHistory: [ 'title', 'title' ], secondHistory: ['title'] });
            outcomes.push(outcome);
        }

        expect(outcomes[1]).toEqual(outcomes[0]);
    });

    test.each([
        [ '', '"title"', [] ],
        [ 'String title = "default"', 'title', [] ],
        [ '...String titles', '...titles', ['rest'] ]
    ])('preserves direct-return factories and typed methods with parameters %s', async (parameters, argumentsText, callArguments) =>
    {
        const original = fixture();
        const source = original.context.source.text
            .replace('create()', `Object create(${parameters})`)
            .replace(
                'readonly Object child = Oloo.assign(Base.create("title"), Child);\r\n        return child;',
                `return Oloo.assign(Base.create(${argumentsText}), Child);`
            )
            .replace('async run()', 'async Number run(Number amount = 2)')
            .replace('readonly Number count = 2;', 'readonly Number count = amount;');
        const example = fixture({ source: source });
        const proposal = await new ConvertObjectInheritanceFix().create(example.context, example.fix);
        expect(proposal).not.toBeNull();
        expect(proposal.newText).toContain(`Child(${parameters}) : base(${argumentsText}) {}`);
        expect(proposal.newText).toContain('async Number run(Number amount = 2)');
        expect(proposal.newText).not.toContain('Object Child(');
        const converted = source.slice(0, proposal.offset) + proposal.newText + source.slice(proposal.endOffset);
        const outcomes = [];
        for(const program of [ source, converted ])
        {
            const baseModule = { exports: {} };
            virtualMachine.runInNewContext(example.base.getText(), { module: baseModule });
            const childModule = { exports: {} };
            const modules = new Map([ [ '@mavega/oloo', { Oloo: Oloo } ], [ './Base', baseModule.exports ] ]);
            const compiled = LgdCompiler.create().compileToJs(program);
            expect(compiled.errors.filter(error => error.code !== 'lgd.object.inheritance')).toEqual([]);
            virtualMachine.runInNewContext(compiled.code, { module: childModule, require: specifier => modules.get(specifier) });
            const instance = childModule.exports.create(...callArguments);
            outcomes.push({ title: instance.title, count: await instance.run(10) });
        }

        expect(outcomes[1]).toEqual(outcomes[0]);
        expect(outcomes[1].count).toBe(10);
        const parsed = LgdCompiler.create().parse(converted);
        const member = parsed.declarations.find(declaration => declaration.name === 'Child').classMembers.find(candidate => candidate.name === 'run');
        expect(member).toMatchObject({ returnTypeName: 'Number', params: [expect.objectContaining({ name: 'amount', typeName: 'Number', defaultText: '2' })] });
    });

    test.each([ [ false, false ], [ true, false ], [ false, true ] ])('checks the reported GoToLastMethod migration (virtual: %s, incompatible: %s)', async (alreadyVirtual, incompatible) =>
    {
        const source = await fs.promises.readFile(path.join(__dirname, '../../fixtures/object-inheritance-go-to-last-method.lgd'), 'utf8');
        const baseSource = [
            'readonly Object GoToNextMethod = {',
            '  create(String commandName = "next", String title = "Next") {',
            '    readonly Object instance = Object.create(GoToNextMethod);',
            '    instance.command = { command: commandName, title: title };',
            '    instance.visits = [];',
            '    instance.tabSize = this.getTabSize();',
            '    return instance;',
            '  },',
            '  getTabSize() { return 2; },',
            '  getMethod(String line, Number index) { this.visits.push(index); return line === "found"; },',
            '  /**',
            '   * @description Runs the next command.',
            ...alreadyVirtual ? ['   * @virtual'] : [],
            '   */',
            `  async executeCommand(${incompatible ? 'Number value' : ''}) {}`,
            '};',
            'module.exports = GoToNextMethod;'
        ].join('\r\n');
        const document = makeTextDocument('file:///workspace/GoToLastMethod.lgd', source);
        const base = makeTextDocument('file:///workspace/GoToNextMethod.lgd', baseSource);
        document.version = 1;
        base.version = 1;
        const mirrorApi = require('./fakeVscode').createFakeVscode(jest);

        vscode.workspace.openTextDocument.mockImplementation(uri =>
        {
            if(uri.fsPath === base.uri.fsPath)
            {
                return base;
            }

            return mirrorApi.workspace.openTextDocument(uri);
        });

        vscode.workspace.applyEdit.mockImplementation(mirrorApi.workspace.applyEdit);
        const diagnostics = new Map();
        const collection = { set: (uri, entries) => diagnostics.set(uri.toString(), entries), delete: uri => diagnostics.delete(uri.toString()) };
        const service = LgdLanguageService.create(collection, error =>
        {
            throw error;
        });

        await service.openDocument(base);
        const state = await service.openDocument(document);
        expect(state.externals.get('./GoToNextMethod')).toMatchObject({ sourcePath: base.uri.fsPath, exportName: 'GoToNextMethod' });
        const provider = LgdCodeActionProvider.create(service);
        const range = new vscode.Range(document.positionAt(0), document.positionAt(source.length));
        let actions = await provider.provideCodeActions(document, range, { diagnostics: JSON.parse(JSON.stringify(diagnostics.get(document.uri.toString()))) }, {});
        if(incompatible)
        {
            expect(actions).toEqual([]);
            return;
        }

        expect(actions).toHaveLength(1);
        if(!alreadyVirtual)
        {
            expect(actions[0].title).toBe('Make GoToNextMethod.executeCommand virtual to enable class conversion');
            const preparation = provider.proposals.get(actions[0].command.arguments[0]);
            expect(preparation.target.document).toBe(base);
            base.setText(`${baseSource}\r\n// unsaved change`);
            base.version++;
            vscode.workspace.applyEdit.mockClear();
            expect(await provider.applyFix(actions[0].command.arguments[0])).toBe(false);
            expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
            await service.updateDocument(base);
            await service.pendingDependencyUpdates;
            await service.updateDocument(document);
            actions = await provider.provideCodeActions(document, range, { diagnostics: JSON.parse(JSON.stringify(diagnostics.get(document.uri.toString()))) }, {});
            vscode.workspace.applyEdit.mockImplementation(edit =>
            {
                const replacement = edit.replacements[0];
                if(replacement.uri.fsPath !== base.uri.fsPath)
                {
                    return mirrorApi.workspace.applyEdit(edit);
                }

                expect(edit.replacements).toHaveLength(1);
                const text = base.getText();
                base.setText(text.slice(0, base.offsetAt(replacement.range.start)) + replacement.newText + text.slice(base.offsetAt(replacement.range.end)));
                base.version++;
                return true;
            });

            expect(await provider.applyFix(actions[0].command.arguments[0])).toBe(true);
            expect(base.getText()).toContain('@description Runs the next command.');
            expect(base.getText()).toContain('@virtual');
            expect(base.getText()).toContain('// unsaved change');
            expect(document.getText()).toBe(source);
            expect(diagnostics.get(document.uri.toString())).toHaveLength(1);
            actions = await provider.provideCodeActions(document, range, { diagnostics: JSON.parse(JSON.stringify(diagnostics.get(document.uri.toString()))) }, {});
        }

        expect(actions).toHaveLength(1);
        expect(actions[0].title).toBe("Convert 'GoToLastMethod' to LGD class : GoToNextMethod");
        const proposal = provider.proposals.get(actions[0].command.arguments[0]);
        const converted = source.slice(0, proposal.offset) + proposal.newText + source.slice(proposal.endOffset);
        expect(converted).toContain('GoToLastMethod() : base("lgd.goToLastMethod", "Go To Last Method") {}');
        expect(converted).toContain('@returns {GoToLastMethodType}');
        expect(converted).toContain('override async executeCommand()');
        const externals = service.getState(document.uri).externals;
        const compiled = LgdCompiler.create().compileToJs(converted, externals);
        expect(compiled.errors).toEqual([]);
        const results = [];
        for(const program of [ source, converted ])
        {
            const baseModule = { exports: {} };
            virtualMachine.runInNewContext(LgdCompiler.create().compileToJs(baseSource).code, { module: baseModule });
            const childModule = { exports: {} };
            const editor = { document: { getText: () => 'found\nmiss\ncurrent' }, selection: { active: { line: 2 } } };
            const modules = new Map([ [ '@mavega/oloo', { Oloo: Oloo } ], [ 'vscode', { window: { activeTextEditor: editor } } ], [ './GoToNextMethod', baseModule.exports ] ]);
            virtualMachine.runInNewContext(
                LgdCompiler.create().compileToJs(program, externals).code,
                { module: childModule, require: specifier => modules.get(specifier) }
            );
            const instance = childModule.exports.create();
            await instance.executeCommand();
            results.push({ command: { ...instance.command }, visits: Array.from(instance.visits), tabSize: instance.tabSize });
        }

        expect(results[1]).toEqual(results[0]);
        expect(results[1]).toEqual({ command: { command: 'lgd.goToLastMethod', title: 'Go To Last Method' }, visits: [ 1, 0 ], tabSize: 2 });
        base.setText(`${baseSource}\r\n// changed`);
        expect(DiagnosticQuickFix.canApply(proposal)).toBe(false);
    });

    test.each([
        { options: { javascriptObjectModel: 'class' } },
        { baseSource: 'const Base = { create() { return {}; } }; module.exports = Base;' },
        { baseSource: '/** @type {BaseType} */ const Base = {}; module.exports = Base;' }
    ])('does not guess unavailable or incompatible bases: %j', async overrides =>
    {
        const example = fixture(overrides);
        expect(await new ConvertObjectInheritanceFix().create(example.context, example.fix)).toBeNull();
    });

    test.each([ 'child.extra = true; return child;', '// Important factory comment\n        return child;' ])('preserves unsupported factory work: %s', async replacement =>
    {
        const original = fixture();
        const source = original.context.source.text.replace('return child;', replacement);
        const example = fixture({ source: source });
        expect(await new ConvertObjectInheritanceFix().create(example.context, example.fix)).toBeNull();
    });

    test.each([
        [ 'return child;', 'throw child;' ],
        [ 'readonly Object Child =', 'Object Child =' ],
        [ '* @extends {BaseType}', '* @extends {BaseType}\n * @augments {OtherType}' ]
    ])('rejects an unsafe lifecycle or declaration change: %s', async (before, after) =>
    {
        const original = fixture();
        const example = fixture({ source: original.context.source.text.replace(before, after) });
        expect(await new ConvertObjectInheritanceFix().create(example.context, example.fix)).toBeNull();
    });

    test('does not introduce an eager reference to a base declared after the object', async () =>
    {
        const original = fixture();
        const imported = 'readonly Object Base = require("./Base");';
        const source = `${original.context.source.text.replace(imported, '')}\r\n${imported}`;
        const example = fixture({ source: source });
        expect(await new ConvertObjectInheritanceFix().create(example.context, example.fix)).toBeNull();
    });

    test('rejects changed output settings at apply time', async () =>
    {
        const example = fixture();
        const proposal = await new ConvertObjectInheritanceFix().create(example.context, example.fix);
        expect(proposal).not.toBeNull();
        example.options.javascriptObjectModel = 'class';
        expect(DiagnosticQuickFix.canApply(proposal)).toBe(false);
    });
});
