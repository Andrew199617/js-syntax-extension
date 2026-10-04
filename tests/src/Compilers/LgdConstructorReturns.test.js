const virtualMachine = require('vm');
const { Oloo } = require('@mavega/oloo');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const ReplaceConstructorReturnThisFix = require('../../../src/Lgd/QuickFixes/ReplaceConstructorReturnThisFix');

/** @description Compiles constructor contracts through either supported JavaScript model. */
function compile(source, javascriptObjectModel = 'oloo')
{
    return LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
}

/** @description Creates a live source snapshot for an independently revalidated quick fix. */
function contextFor(source)
{
    const document = { version: 1, getText: () => source };
    const snapshot = { document: document, version: 1, text: source };
    return { source: snapshot, snapshots: [snapshot], state: { externals: new Map() } };
}

describe.each([ 'oloo', 'class' ])('LGD constructor return contracts with %s output', objectModel =>
{
    test.each([ 'this', 'null', 'undefined', '1', '"value"', '{}', 'createOther()', 'this.value', '(sideEffect(), this)', 'void sideEffect()' ])('rejects value return %s at its exact expression', expression =>
    {
        const source = `class Sample { Sample() { return ${expression}; } Number later() { return 2; } }`;
        const result = compile(source, objectModel);
        expect(result.errors).toHaveLength(1);
        const [error] = result.errors;
        expect(error).toMatchObject({ code: 'lgd.constructor.returnValue', category: 'syntax', severity: 'error' });
        expect(source.slice(error.offset, error.endOffset)).toBe(expression.replace(/^\((?<inner>.*)\)$/, '$<inner>'));
        expect(Boolean(error.quickFix)).toBe(expression === 'this');
        expect(result.declarations[0].classMembers.map(member => member.name)).toContain('later');
    });

    test('checks unreachable returns and branches without consuming nested functions or class expressions', () =>
    {
        const source = [ 'class Sample {',
            '    Sample() {',
            '        this.callback = () => { return { allowed: true }; };',
            '        this.helper = function() { return this; };',
            '        function local() { return 1; }',
            '        const Inner = class { constructor() { return {}; } read() { return 2; } };',
            '        const methods = { read() { return 2; }, get value() { return 3; } };',
            '        if(false) return null;',
            '        try { return; } finally { if(false) return undefined; }',
            '        return this;',
            '    }',
            '    Number later() { return 2; }',
            '}' ].join('\r\n');
        const result = compile(source, objectModel);
        expect(result.errors.map(error => source.slice(error.offset, error.endOffset))).toEqual([ 'null', 'undefined', 'this' ]);
        expect(result.errors.every(error => error.code === 'lgd.constructor.returnValue')).toBe(true);
    });

    test('recognizes automatic semicolon insertion and ignores textual lookalikes', () =>
    {
        const source = [ 'class Sample { Sample() {',
            '    const text = "return this";',
            '    const pattern = /return this/;',
            '    // return this;',
            '    /* return this; */',
            '    return',
            '    (sideEffect());',
            '} }' ].join('\n');
        expect(compile(source, objectModel).errors).toEqual([]);
    });

    test('retains field initialization, finally, and early exit behavior', () =>
    {
        const source = [ 'const events = [];',
            'class Sample {',
            '    Number value = (events.push("field"), 1);',
            '    Sample(Boolean stop) {',
            '        try { if(stop) return; this.value = 2; }',
            '        finally { events.push("finally"); }',
            '        events.push("after");',
            '    }',
            '}',
            'module.exports = { first: Sample.create(true), second: Sample.create(false), events };' ].join('\n');
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        const context = { Oloo: Oloo, module: { exports: null } };
        virtualMachine.runInNewContext(result.code, context);
        expect(context.module.exports.first.value).toBe(1);
        expect(context.module.exports.second.value).toBe(2);
        expect(context.module.exports.events).toEqual([ 'field', 'finally', 'field', 'finally', 'after' ]);
    });

    test.each([ '\n', '\r\n' ])('removes only the terminal constructor statement and preserves comments with %j', async newline =>
    {
        const source = [ 'class Command {',
            '    Command() {',
            '        this.callback = () => { return this; };',
            '        // Keep the leading comment.',
            '        return ((this)); // Keep the trailing comment.',
            '    }',
            '}' ].join(newline);
        const [error] = compile(source, objectModel).errors;
        const proposal = await new ReplaceConstructorReturnThisFix().create(contextFor(source), error.quickFix);
        expect(proposal.title).toBe('Remove redundant return this');
        expect(proposal.newText).toBe('');
        const updated = source.slice(0, proposal.offset) + proposal.newText + source.slice(proposal.endOffset);
        expect(updated).toBe(source.replace('return ((this));', ''));
        expect(compile(updated, objectModel).errors).toEqual([]);
    });

    test.each([ 'return this; this.value = 2;',
        'if(true) { return this; } this.value = 2;',
        'while(true) { return this; }',
        'try { return this; } finally { this.value = 2; }' ])('retains the exit for control flow: %s', async body =>
    {
        const source = `class Command { Command() { ${body} } }`;
        const [error] = compile(source, objectModel).errors;
        const proposal = await new ReplaceConstructorReturnThisFix().create(contextFor(source), error.quickFix);
        expect(proposal.newText).toBe('return;');
    });

    test('allows an existing terminal bare return without a new hard error', () =>
    {
        expect(compile('class Command { Command() { return; } }', objectModel).errors).toEqual([]);
    });

    test.each([ 'return this;', 'return ((this));', 'return (\n this\n)', 'return this' ])('replaces %s with an early exit and keeps conditional control flow', async statement =>
    {
        const source = `class Sample { Sample(Boolean stop) { this.value = 1; if(stop) ${statement}\n this.value = 2; } }\nmodule.exports = Sample;`;
        const [error] = compile(source, objectModel).errors;
        const proposal = await new ReplaceConstructorReturnThisFix().create(contextFor(source), error.quickFix);
        expect(proposal.isPreferred).toBe(true);
        expect(proposal.expectedText).toBe(statement);
        const updated = source.slice(0, proposal.offset) + proposal.newText + source.slice(proposal.endOffset);
        const result = compile(updated, objectModel);
        expect(result.errors).toEqual([]);
        const context = { Oloo: Oloo, module: { exports: null } };
        virtualMachine.runInNewContext(result.code, context);
        expect(context.module.exports.create(true).value).toBe(1);
        expect(context.module.exports.create(false).value).toBe(2);
    });
});

test('reports the screenshot factory return without dropping the base factory call', () =>
{
    const source = [ 'class GoToLastParagraph {',
        '    /** @returns {GoToLastParagraphType} */',
        '    GoToLastParagraph() {',
        '        const Object goToLastParagraph = Oloo.assign(BaseCommand.create("lgd.goToLastParagraph", "Go To Last Paragraph"), GoToLastParagraph);',
        '        return goToLastParagraph;',
        '    }',
        '}' ].join('\r\n');
    const result = compile(source);
    expect(result.errors.map(error => error.code)).toEqual([ 'lgd.jsdoc.returnType', 'lgd.constructor.returnValue' ]);
    expect(result.errors[1].quickFix).toMatchObject({ kind: 'convertObjectInheritance', name: 'GoToLastParagraph' });
    expect(source.slice(result.errors[1].offset, result.errors[1].endOffset)).toBe('goToLastParagraph');
});

test('checks the same constructor contract through parse and experimental output entry points', () =>
{
    const compiler = LgdCompiler.create();
    const source = 'class Sample { Sample() { return undefined; } }';
    for(const entryPoint of [ 'parse', 'compileToTs', 'compileToCSharp' ])
    {
        expect(compiler[entryPoint](source).errors.map(error => error.code)).toEqual(['lgd.constructor.returnValue']);
    }
});

test('withholds a this-return fix containing comments and rejects forged or stale provenance', async () =>
{
    const source = 'class Sample { Sample() { return this; } }';
    const fix = compile(source).errors[0].quickFix;
    const handler = new ReplaceConstructorReturnThisFix();
    expect(await handler.create(contextFor(source), { ...fix, offset: fix.offset + 1 })).toBeNull();
    expect(await handler.create(contextFor(source.replace('this;', 'sideEffect();')), fix)).toBeNull();
    const commented = compile(source.replace('return this;', 'return /* keep this */ (this);'));
    expect(commented.errors[0].code).toBe('lgd.constructor.returnValue');
    expect(commented.errors[0].quickFix).toBeUndefined();
});
