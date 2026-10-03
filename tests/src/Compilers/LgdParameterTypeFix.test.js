const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const ChangeParameterTypeFix = require('../../../src/Lgd/QuickFixes/ChangeParameterTypeFix');

/** @description Builds a compiler-backed isolated strategy context without editing a source document. */
function fixture(source, options = {})
{
    const document = { version: 1, uri: { fsPath: '/workspace/Counter.lgd' }, getText: () => source };
    const snapshot = { document: document, version: 1, text: source };
    const result = LgdCompiler.create().compileToJs(source, new Map(), options);
    const languageService = { getOutputOptions: () => options, dependents: new Map(), states: new Map() };
    const context = { document: document, source: snapshot, snapshots: [snapshot], state: { externals: new Map() }, languageService: languageService };
    const fix = result.errors.find(error => error.quickFix?.kind === 'changeParameterType')?.quickFix;
    return { source: source, result: result, context: context, fix: fix };
}

/** @description Asks the isolated strategy for an explicitly linked annotation edit. */
function proposalFor(current)
{
    return current.fix ? new ChangeParameterTypeFix().create(current.context, current.fix) : null;
}

/** @description Applies only the proposed source span to produce independently compilable preview text. */
function previewText(current, proposal)
{
    return current.source.slice(0, proposal.offset) + proposal.newText + current.source.slice(proposal.endOffset);
}

/** @description Makes a tested contract module-private without exporting it. */
function inModule(source)
{
    return `export {};\r\n${source}`;
}

describe('LGD parameter-type assignment suggestions', () =>
{
    test('preserves stable assignment diagnostic metadata with the exact parameter type and name spans', () =>
    {
        const source = 'Function record = (Number /* keep */ value) => { value = "wrong"; };';
        const current = fixture(source);
        const diagnostic = current.result.errors[0];
        expect(diagnostic.code).toBe('lgd.assignment.typeMismatch');
        expect(diagnostic.message).toBe('Cannot assign String to Number.');
        expect(current.fix.kind).toBe('changeParameterType');
        expect(source.slice(current.fix.offset, current.fix.endOffset)).toBe('Number');
        expect(source.slice(current.fix.parameterOffset, current.fix.parameterOffset + current.fix.parameterName.length)).toBe('value');
        expect(current.fix.assignmentStart).toBe(source.indexOf('"wrong"'));
        expect(current.fix.assignmentEnd).toBe(source.indexOf('"wrong"') + '"wrong"'.length);
    });

    test.each([
        'Function record = (Number value) => { value = "wrong"; };',
        'Function record = function(Number value) { value = "wrong"; };',
        'Object Counter = { void increment(Number value) { value = "wrong"; } };',
        'class Counter { void increment(Number value) { value = "wrong"; } }'
    ])('offers an annotation-only unpreferred edit and independently compiles the fixed source: %s', async source =>
    {
        const moduleSource = inModule(source);
        const current = fixture(moduleSource);
        const proposal = await proposalFor(current);
        expect(proposal.title).toBe("Change parameter 'value' to String (changes signature)");
        expect(proposal.isPreferred).toBe(false);
        expect(proposal.expectedText).toBe('Number');
        expect(previewText(current, proposal)).toBe(`${moduleSource.slice(0, current.fix.offset)}String${moduleSource.slice(current.fix.endOffset)}`);
        expect(LgdCompiler.create().compileToJs(previewText(current, proposal)).errors).toEqual([]);
    });

    test('retains the existing screenshot return mismatch and discloses the residual diagnostic', async () =>
    {
        const source = inModule('class Counter { Number increment(Number value) { value = "wrong"; return value; } }');
        const current = fixture(source);
        const proposal = await proposalFor(current);
        expect(proposal.title).toBe("Change parameter 'value' to String (changes signature); 1 existing diagnostic remains");
        const preview = LgdCompiler.create().compileToJs(previewText(current, proposal));
        expect(preview.errors).toEqual([current.result.errors[1]]);
        expect(previewText(current, proposal)).toContain('Number increment(String value) { value = "wrong"; return value; }');
    });

    test('supports both output models and preserves CRLF, Unicode, comments, and shadowing locals', async () =>
    {
        const source = inModule([
            'class Counter {',
            '    // café Number value',
            '    void increment(Number /* contract */ value) {',
            '        { const value = "shadow"; }',
            '        value = "wrong";',
            '    }',
            '}'
        ].join('\r\n'));
        for(const javascriptObjectModel of [ 'oloo', 'class' ])
        {
            const current = fixture(source, { javascriptObjectModel: javascriptObjectModel });
            const proposal = await proposalFor(current);
            expect(previewText(current, proposal)).toBe(source.replace('Number /* contract */ value', 'String /* contract */ value'));
            expect(LgdCompiler.create().compileToJs(previewText(current, proposal), new Map(), { javascriptObjectModel: javascriptObjectModel }).errors).toEqual([]);
        }
    });

    test.each([
        'Function action = function recurse(Number value) { if(ready) recurse(1); value = "wrong"; };',
        'Function record = function record(Number value) { record(1); value = "wrong"; };',
        'Function action = function recurse(Number value) { const alias = recurse; value = "wrong"; };',
        'Function record = (Number value = "wrong") => {};',
        'Function record = (...Number value) => { value = "wrong"; };',
        'Function record = (Number value, Number other) => { value = "wrong"; };',
        'Function record = (Number value) => { const nested = () => { value = "wrong"; }; };',
        'Function record = (Number value) => { [value] = ["wrong"]; };',
        'Function record = (Number value) => { value += "wrong"; };',
        'Function record = (Number value) => { value = unknown ? "wrong" : 1; };',
        'Function record = (Number value) => { value = "wrong"; value = unknownCall(); };',
        'Function record = (Number value) => { value = "wrong"; const nested = () => { value = unknownCall(); }; };',
        'Function record = (Number value) => { value = "wrong"; const nested = () => { value = "captured"; }; };',
        'Number value = "wrong";',
        'Function record = (Number value) => { const value = "shadow"; value = "wrong"; };'
    ])('withholds metadata for unsupported, ambiguous, or nonparameter targets: %s', source =>
    {
        expect(fixture(source).fix).toBeUndefined();
    });

    test.each([
        'export Function record = (Number value) => { value = "wrong"; };',
        'Function record = (Number value) => { value = "wrong"; }; module.exports = record;',
        'Function record = (Number value) => { value = "wrong"; }; record(1);',
        'Function record = (Number value) => { value = "wrong"; }; record("caller");',
        'Function record = (Number value) => { value = "wrong"; }; use(record);',
        '/** @param {number} value */\nFunction record = (Number value) => { value = "wrong"; };',
        '/** @type {(value: number) => void} */\nFunction record = (Number value) => { value = "wrong"; };',
        'Function record = (Number value) => { value = "wrong"; }; const alias = record;',
        'Function record = (Number value) => { value = "wrong"; }; eval("record(1)");',
        'Function record = (Number value) => { value = "wrong"; }; const indirect = eval; indirect("record(1)");',
        'Function record = (Number value) => { value = "wrong"; }; new Function("record(1)")();',
        'Function record = (Number value) => { value = "wrong"; }; globalThis.eval("record(1)");',
        'Function record = function(Number value) { value = "wrong"; arguments.callee(1); };',
        'Function record = function(Number value) { value = "wrong"; const alias = arguments.callee; };',
        'Function record = function(Number value) { value = "wrong"; const alias = new.target; };',
        'class Counter { void increment(Number value) { value = "wrong"; } }\nmodule.exports = Counter;',
        'class Counter { void increment(Number value) { value = "wrong"; } }\nCounter.increment(1);',
        'class Counter { void increment(Number value) { value = "wrong"; } void run() { this.increment(1); } }',
        'Object Counter = { void increment(Number value) { value = "wrong"; arguments.callee(1); } };',
        'class Counter { void increment(Number value) { value = "wrong"; } void take(Counter item) { item.increment(1); } }',
        'class Counter { virtual void increment(Number value) { value = "wrong"; } }',
        'class Parent { virtual void increment(Number value) {} }\nclass Counter : Parent { override void increment(Number value) { value = "wrong"; } }',
        'interface ICounter { void increment(Number value); }\nclass Counter : ICounter { void increment(Number value) { value = "wrong"; } }',
        'class Counter { void increment(Number value) { value = "wrong"; } }\nclass Child : Counter {}',
        'class Counter { void increment(Number value) { value = "wrong"; } }\nObject Receiver = { void take(Counter item) { item.increment(1); } };',
        'class Counter { void increment(Number value) { value = "wrong"; } }\nObject Receiver = { Counter take() { return unknownCall(); } };',
        'class Counter { void increment(Number value) { value = "wrong"; } }\n/** @type {Counter} */ const instance = getInstance(); instance.increment(1);',
        'Function record = (Number value) => { value = 1; value = "wrong"; };',
        'class Counter { Number increment(Number value) { if(ready) return value; value = "wrong"; return 1; } }'
    ])('withholds an automatic edit for exposed contracts, callers, inheritance, or a newly invalid preview: %s', async source =>
    {
        expect(await proposalFor(fixture(inModule(source)))).toBeNull();
    });

    test.each([
        'Function record = (Number value) => { value = "wrong"; };',
        'Object Counter = { void increment(Number value) { value = "wrong"; } };',
        'class Counter { void increment(Number value) { value = "wrong"; } }',
        'class Counter { void increment(Number value) { value = "wrong"; } }\r\nmodule.exports = {};'
    ])('preserves compiler diagnostics while withholding a signature edit for global script owners: %s', async source =>
    {
        const current = fixture(source);
        expect(current.fix.kind).toBe('changeParameterType');
        expect(current.result.errors.some(error => error.code === 'lgd.assignment.typeMismatch')).toBe(true);
        expect(await proposalFor(current)).toBeNull();
    });

    test('supports an unused genuinely nested-local parameter contract without a module marker', async () =>
    {
        const source = 'function build() {\r\nclass Counter { void increment(Number value) { value = "wrong"; } }\r\n}';
        const current = fixture(source);
        const proposal = await proposalFor(current);
        expect(LgdCompiler.create().compileToJs(previewText(current, proposal)).errors).toEqual([]);
    });

    test('rejects known external consumers and forged parameter metadata', async () =>
    {
        const current = fixture(inModule('Function record = (Number value) => { value = "wrong"; };'));
        const offered = await proposalFor(current);
        expect(offered.validate()).toBe(true);
        current.context.languageService.dependents.set(current.context.document.uri.fsPath, new Set(['/workspace/Consumer.lgd']));
        expect(offered.validate()).toBe(false);
        expect(await proposalFor(current)).toBeNull();
        current.context.languageService.dependents.clear();
        current.context.languageService.states.set('consumer', { document: {}, externals: new Map([[ './Counter.js', { sourcePath: current.context.document.uri.fsPath } ]]) });
        expect(await proposalFor(current)).toBeNull();
        current.context.languageService.states.clear();
        expect(await new ChangeParameterTypeFix().create(current.context, { ...current.fix, parameterOffset: current.fix.parameterOffset + 1 })).toBeNull();
    });
});
