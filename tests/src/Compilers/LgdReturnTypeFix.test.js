const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const ChangeParameterTypeFix = require('../../../src/Lgd/QuickFixes/ChangeParameterTypeFix');
const ChangeParameterAndReturnTypeFix = require('../../../src/Lgd/QuickFixes/ChangeParameterAndReturnTypeFix');
const ChangeReturnTypeFix = require('../../../src/Lgd/QuickFixes/ChangeReturnTypeFix');

/** @description Builds exact compiler provenance and live document snapshots for a signature strategy. */
function fixture(source, options = {})
{
    const document = { version: 1, uri: { fsPath: '/workspace/Counter.lgd' }, getText: () => source };
    const snapshot = { document: document, version: 1, text: source };
    const compiler = LgdCompiler.create();
    const result = compiler.compileToJs(source, new Map(), options);
    const languageService = { getOutputOptions: () => options, dependents: new Map(), states: new Map() };
    const context = { document: document, source: snapshot, snapshots: [snapshot], state: { externals: new Map() }, languageService: languageService };
    return { source: source, options: options, result: result, context: context };
}

/** @description Requests a strategy only through the matching fresh compiler diagnostic metadata. */
function proposalFor(current, Handler, kind)
{
    const fix = current.result.errors.find(error => error.quickFix?.kind === kind)?.quickFix;
    return fix ? new Handler().create(current.context, fix) : null;
}

/** @description Independently compiles exactly the proposed annotation edit. */
function preview(current, proposal)
{
    const source = `${current.source.slice(0, proposal.offset)}${proposal.newText}${current.source.slice(proposal.endOffset)}`;
    const result = LgdCompiler.create().compileToJs(source, new Map(), current.options);
    return { source: source, result: result };
}

/** @description Provides an explicit module boundary, without exporting the contract under review. */
function inModule(source)
{
    return `export {};\r\n${source}`;
}

describe('LGD conservative parameter-and-return type suggestions', () =>
{
    test.each([ 'oloo', 'class' ])('offers one atomic unpreferred signature edit with zero errors in the %s model', async javascriptObjectModel =>
    {
        const source = inModule('class Counter { Number increment(Number value) { value = "wrong"; return value; } }');
        const current = fixture(source, { javascriptObjectModel: javascriptObjectModel });
        const proposal = await proposalFor(current, ChangeParameterAndReturnTypeFix, 'changeParameterType');
        expect(proposal.title).toBe("Change parameter 'value' and return type to String (changes signature)");
        expect(proposal.isPreferred).toBe(false);
        expect(proposal.expectedText).toBe('Number increment(Number');
        expect(proposal.newText).toBe('String increment(String');
        expect(preview(current, proposal).source).toBe(source.replace('Number increment(Number', 'String increment(String'));
        expect(preview(current, proposal).result.errors).toEqual([]);
    });

    test('preserves original CRLF, Unicode, intervening method and parameter comments, and all body text', async () =>
    {
        const source = inModule([
            'class Counter {',
            '    // café Number untouched',
            '    Number /* return note */ increment(Number /* parameter note */ value) {',
            '        value = "wrong"; return value;',
            '    }',
            '}'
        ].join('\r\n'));
        const current = fixture(source);
        const proposal = await proposalFor(current, ChangeParameterAndReturnTypeFix, 'changeParameterType');
        const expected = source.replace('Number /* return note */ increment(Number', 'String /* return note */ increment(String');
        expect(preview(current, proposal).source).toBe(expected);
        expect(preview(current, proposal).result.errors).toEqual([]);
    });

    test('supports a genuinely function-local unused owner without claiming that a global script is private', async () =>
    {
        const source = 'function build() {\r\nclass Counter { Number increment(Number value) { value = "wrong"; return value; } }\r\n}';
        const current = fixture(source);
        const proposal = await proposalFor(current, ChangeParameterAndReturnTypeFix, 'changeParameterType');
        expect(preview(current, proposal).result.errors).toEqual([]);
    });

    test('keeps a void method parameter-only and enables a separate return fix after a parameter-only edit', async () =>
    {
        const voidCurrent = fixture(inModule('class Counter { void increment(Number value) { value = "wrong"; } }'));
        expect(await proposalFor(voidCurrent, ChangeParameterAndReturnTypeFix, 'changeParameterType')).toBeNull();
        const parameterOnly = await proposalFor(voidCurrent, ChangeParameterTypeFix, 'changeParameterType');
        expect(preview(voidCurrent, parameterOnly).result.errors).toEqual([]);

        const original = fixture(inModule('class Counter { Number increment(Number value) { value = "wrong"; return value; } }'));
        expect(await proposalFor(original, ChangeReturnTypeFix, 'changeReturnType')).toBeNull();
        const parameter = await proposalFor(original, ChangeParameterTypeFix, 'changeParameterType');
        const afterParameter = fixture(preview(original, parameter).source);
        const returned = await proposalFor(afterParameter, ChangeReturnTypeFix, 'changeReturnType');
        expect(preview(afterParameter, returned).result.errors).toEqual([]);
    });

    test.each([
        'class Counter { Number increment(Number value) { value = "wrong"; if(ready) return value; return "other"; } }',
        'class Counter { Number increment(Number value) { if(ready) return value; value = "wrong"; return value; } }',
        'Object Counter = { Number increment(Number value) { value = "wrong"; return value; } };'
    ])('requires all complete speculative return paths to become String: %s', async source =>
    {
        const current = fixture(inModule(source));
        const proposal = await proposalFor(current, ChangeParameterAndReturnTypeFix, 'changeParameterType');
        expect(preview(current, proposal).result.errors).toEqual([]);
    });

    test.each([
        'class Counter { Number increment(Number value) { value = "wrong"; if(ready) return value; return 1; } }',
        'class Counter { Number increment(Number value) { value = "wrong"; return unknownCall(); } }',
        'class Counter { Number increment(Number value) { value = "wrong"; if(ready) return value; return null; } }',
        'class Counter { Number increment(Number value) { value = "wrong"; if(ready) return value; return undefined; } }',
        'class Counter { Number increment(Number value) { value = "wrong"; if(ready) return value; } }',
        'class Counter { Number increment(Number value) { value = "wrong"; return; } }',
        'class Counter { Number increment(Number value) { value = "wrong"; throw new Error("stop"); } }',
        'class Counter { async Number increment(Number value) { value = "wrong"; return value; } }',
        'class Counter { Number increment(Number value = 1) { value = "wrong"; return value; } }',
        'class Counter { Number increment(Number value) { value = "wrong";\r\nNumber other = value;\r\nreturn value; } }',
        'class Counter { Number increment(Number value) { value = "wrong"; value = null; return value; } }',
        'class Counter { Number increment(Number value) { value = "wrong"; const mutate = () => { value = "nested"; }; return value; } }',
        'class Counter { Number increment(Number value) { value = "wrong";\r\nObject Helper = { String label() { return unknownCall(); } };\r\nreturn Helper.label(); } }',
        'class Counter { Number increment(Number value) { value = "wrong";\r\nObject Helper = { String label() { return 1; } };\r\nconst label = Helper.label(); return label; } }'
    ])('withholds combined changes for uncertain, inconsistent, nullable, unsupported or newly invalid bodies: %s', async source =>
    {
        expect(await proposalFor(fixture(inModule(source)), ChangeParameterAndReturnTypeFix, 'changeParameterType')).toBeNull();
    });

    test.each([
        'class Counter { Number increment(Number value) { value = "wrong"; return value; } }',
        'class Counter { Number increment(Number value) { value = "wrong"; return value; } }\r\nmodule.exports = {};'
    ])('does not treat zero lexical references or CommonJS-looking text as proof for a global script: %s', async source =>
    {
        expect(await proposalFor(fixture(source), ChangeParameterAndReturnTypeFix, 'changeParameterType')).toBeNull();
    });

    test.each([
        'export class Counter { Number increment(Number value) { value = "wrong"; return value; } }',
        'class Counter { Number increment(Number value) { value = "wrong"; return value; } }\r\nCounter.increment(1);',
        'class Counter { Number increment(Number value) { value = "wrong"; return value; } }\r\nconst alias = Counter;',
        'class Counter { Number increment(Number value) { value = "wrong"; return value; } }\r\nglobalThis.Counter = Counter;',
        'class Counter { Number increment(Number value) { value = "wrong"; return value; } }\r\neval("Counter.increment(1)");',
        'class Counter { Number increment(Number value) { value = "wrong"; return value; } }\r\nclass Child : Counter {}',
        'class Counter { virtual Number increment(Number value) { value = "wrong"; return value; } }',
        'class Parent { virtual Number increment(Number value) { return value; } }\r\nclass Counter : Parent { override Number increment(Number value) { value = "wrong"; return value; } }',
        'interface ICounter { Number increment(Number value); }\r\nclass Counter : ICounter { Number increment(Number value) { value = "wrong"; return value; } }',
        '/** @type {{increment(value:number):number}} */\r\nclass Counter { Number increment(Number value) { value = "wrong"; return value; } }',
        'class Counter { /** @returns {number} */ Number increment(Number value) { value = "wrong"; return value; } }'
    ])('withholds a combined change for exposed, consumed, inherited or documented signatures: %s', async source =>
    {
        expect(await proposalFor(fixture(inModule(source)), ChangeParameterAndReturnTypeFix, 'changeParameterType')).toBeNull();
    });

    test('rejects new cross-file consumers, stale snapshots and forged combined metadata', async () =>
    {
        const current = fixture(inModule('class Counter { Number increment(Number value) { value = "wrong"; return value; } }'));
        const proposal = await proposalFor(current, ChangeParameterAndReturnTypeFix, 'changeParameterType');
        const fix = current.result.errors[0].quickFix;
        expect(await new ChangeParameterAndReturnTypeFix().create(current.context, { ...fix, assignmentEnd: fix.assignmentEnd + 1 })).toBeNull();
        expect(await new ChangeParameterAndReturnTypeFix().create(current.context, { ...fix, parameterOffset: fix.parameterOffset + 1 })).toBeNull();
        current.context.languageService.dependents.set(current.context.document.uri.fsPath, new Set(['/workspace/Consumer.lgd']));
        expect(proposal.validate()).toBe(false);
        expect(await proposalFor(current, ChangeParameterAndReturnTypeFix, 'changeParameterType')).toBeNull();
        current.context.languageService.dependents.clear();
        current.context.document.version++;
        expect(await proposalFor(current, ChangeParameterAndReturnTypeFix, 'changeParameterType')).toBeNull();
    });
});

describe('LGD independent return-type followup suggestions', () =>
{
    test('records a stable diagnostic ID and exact original return annotation and expression spans', () =>
    {
        const source = inModule('class Counter { Number increment(String value) { return value; } }');
        const current = fixture(source);
        const diagnostic = current.result.errors[0];
        expect(diagnostic.code).toBe('lgd.return.typeMismatch');
        expect(diagnostic.quickFix.kind).toBe('changeReturnType');
        const fix = diagnostic.quickFix;
        expect(source.slice(fix.offset, fix.endOffset)).toBe('Number');
        expect(source.slice(fix.returnStart, fix.returnEnd)).toBe('value');
        expect(fix.methodName).toBe('increment');
    });

    test.each([
        'class Counter { Number increment(String value) { return value; } }',
        'class Counter { Number label() { return "wrong"; } }',
        'class Counter { Number label() { if(ready) return "first"; return "second"; } }',
        'class Counter { Number label() { if(ready) throw new Error("stop"); return "second"; } }'
    ])('offers an explicit unpreferred Number-to-String return-only correction: %s', async source =>
    {
        const current = fixture(inModule(source));
        const proposal = await proposalFor(current, ChangeReturnTypeFix, 'changeReturnType');
        expect(proposal.newText).toBe('String');
        expect(proposal.expectedText).toBe('Number');
        expect(proposal.isPreferred).toBe(false);
        expect(preview(current, proposal).result.errors).toEqual([]);
    });

    test.each([
        'class Counter { Number label() { if(ready) return "first"; return 1; } }',
        'class Counter { Number label() { if(ready) return "first"; return unknownCall(); } }',
        'class Counter { Number label() { if(ready) return "first"; return null; } }',
        'class Counter { Number label() { if(ready) return "first"; return; } }',
        'class Counter { Number label() { if(ready) return "first"; } }',
        'class Counter { async Number label() { return "first"; } }',
        'class Counter { Number label(String value = "first") { return value; } }',
        'export class Counter { Number label() { return "first"; } }',
        'class Counter { virtual Number label() { return "first"; } }',
        'class Counter { Number label() { return "first"; } }\r\nCounter.label();',
        'class Counter { Number label() { return "first"; } }\r\nglobalThis.eval("Counter.label()");'
    ])('withholds standalone changes without complete closed String-return proof: %s', async source =>
    {
        expect(await proposalFor(fixture(inModule(source)), ChangeReturnTypeFix, 'changeReturnType')).toBeNull();
    });

    test('rejects forged return metadata and invalidates an offered edit when external consumers appear', async () =>
    {
        const current = fixture(inModule('class Counter { Number label() { return "first"; } }'));
        const fix = current.result.errors[0].quickFix;
        expect(await new ChangeReturnTypeFix().create(current.context, { ...fix, methodName: 'another' })).toBeNull();
        expect(await new ChangeReturnTypeFix().create(current.context, { ...fix, returnStart: fix.returnStart + 1 })).toBeNull();
        const proposal = await proposalFor(current, ChangeReturnTypeFix, 'changeReturnType');
        current.context.languageService.states.set('consumer', { document: {}, externals: new Map([[ './Counter.js', { sourcePath: current.context.document.uri.fsPath } ]]) });
        expect(proposal.validate()).toBe(false);
        expect(await proposalFor(current, ChangeReturnTypeFix, 'changeReturnType')).toBeNull();
    });
});
