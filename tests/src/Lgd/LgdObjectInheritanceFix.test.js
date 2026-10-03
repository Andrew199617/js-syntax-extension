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

    api.CodeAction = jest.fn((title, kind) => ({ title: title, kind: kind }));
    api.CodeActionKind = { QuickFix: { value: 'quickfix' } };
    api.Uri = { file: filename => require('./fakeVscode').makeTextDocument(`file://${filename}`, '').uri };
    return api;
});

describe('legacy object inheritance conversion', () =>
{
    test('routes transported editor diagnostics through the registered native Quick Fix', async () =>
    {
        const example = fixture();
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
        expect(actions[0].title).toBe("Convert 'Child' to LGD class : Base");
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
