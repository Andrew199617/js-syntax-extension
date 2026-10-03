const virtualMachine = require('vm');
const { Oloo } = require('@mavega/oloo');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

/** @description Compiles readonly field contracts through either JavaScript output model. */
function compile(source, objectModel)
{
    return LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
}

/** @description Runs checked field initialization using the existing class lifecycle. */
function execute(source, objectModel)
{
    const result = compile(source, objectModel);
    expect(result.errors).toEqual([]);
    const context = { Oloo: Oloo, module: { exports: null } };
    virtualMachine.runInNewContext(result.code, context);
    return context.module.exports;
}

beforeEach(() => Oloo.objectMap.clear());

describe.each([ 'oloo', 'class' ])('Readonly fields with %s output', objectModel =>
{
    test('Erases readonly without adding runtime checks or changing generated storage.', () =>
    {
        const source = 'class Sample { readonly Number value = 1; static readonly Array items = []; Sample() { this.value = 2; } }';
        const checked = compile(source, objectModel);
        const mutable = compile(source.replaceAll('readonly ', ''), objectModel);
        expect(checked.errors).toEqual([]);
        expect(checked.code).toBe(mutable.code);
    });

    test('Initializes defaults and fresh references, allowing repeated constructor writes and early returns.', () =>
    {
        const Sample = execute([
            'class Sample {',
            '    readonly Number value;',
            '    readonly Array items = [];',
            '    readonly String label;',
            '    readonly Number? optional;',
            '    Sample(Boolean early) {',
            '        this.value = 1; this.value += 2; ++this.value;',
            '        [this.value] = [5]; ({ next: this.value } = { next: 6 });',
            '        if(early) return this.items.push("early");',
            '        value = 7;',
            '    }',
            '    append() { this.items.push("later"); this.items[0] = "changed"; }',
            '}',
            'module.exports = Sample;'
        ].join('\n'), objectModel);
        const first = Sample.create(true);
        const second = Sample.create(false);
        expect({ first: first.value, second: second.value }).toEqual({ first: 6, second: 7 });
        expect(first.label).toBeNull();
        expect(first.optional).toBeNull();
        expect(first.items).toEqual(['early']);
        expect(second.items).toEqual([]);
        first.append();
        expect(first.items).toEqual([ 'changed', 'later' ]);
        expect(second.items).toEqual([]);
    });

    test('Keeps static readonly initializers eager and permits same-type static initializer writes.', () =>
    {
        const result = execute([
            'let allocations = 0;',
            'class Sample {',
            '    static readonly Number value = ++allocations;',
            '    readonly static Number next = (Sample.value += 2);',
            '    static Number last = ++value;',
            '    static readonly Array items = [];',
            '    readonly Number count = Sample.value;',
            '    Sample() { Sample.items.push(this.count); }',
            '}',
            'const first = Sample.create(); const second = Sample.create();',
            'module.exports = { Sample, first, second, allocations };'
        ].join('\n'), objectModel);
        expect(result.allocations).toBe(1);
        expect({ value: result.Sample.value, next: result.Sample.next, last: result.Sample.last }).toEqual({ value: 4, next: 3, last: 4 });
        expect(result.Sample.items).toEqual([ result.Sample.value, result.Sample.value ]);
    });

    test.each([
        [ 'ordinary method', 'change() { this.value = 2; }' ],
        [ 'unqualified method write', 'change() { value = 2; }' ],
        [ 'compound method write', 'change() { this.value += 2; }' ],
        [ 'increment', 'change() { ++this.value; }' ],
        [ 'fixed computed key', 'change() { this["value"] = 2; }' ],
        [ 'array destructuring', 'change() { [this.value] = [2]; }' ],
        [ 'object destructuring', 'change() { ({ next: this.value = 2 } = {}); }' ],
        [ 'for-of target', 'change() { for(this.value of [2]) {} }' ],
        [ 'unqualified for-of target', 'change() { for(value of [2]) {} }' ],
        [ 'for-in target', 'change() { for(this.value in {}) {} }' ],
        [ 'deletion even in constructor', 'Sample() { delete this.value; }' ],
        [ 'other instance in constructor', 'Sample(Sample other) { other.value = 2; }' ],
        [ 'this alias in constructor', 'Sample() { const self = this; self.value = 2; }' ],
        [ 'captured alias', 'Sample() { const self = this; function change() { self.value = 2; } }' ],
        [ 'constructor arrow', 'Sample() { const change = () => { this.value = 2; }; }' ],
        [ 'immediately invoked arrow', 'Sample() { (() => { this.value = 2; })(); }' ],
        [ 'constructor parameter default', 'Sample(Number value = (this.value = 2)) {}' ]
    ])('Rejects %s outside the direct declaring constructor context.', (label, body) =>
    {
        const source = `class Sample { readonly Number value = 1; ${body} }`;
        const errors = compile(source, objectModel).errors;
        expect(errors.filter(error => error.code === 'lgd.member.readonly')).toHaveLength(1);
    });

    test.each([
        'const item = Sample.create(); item.value = 2;',
        'let item = Sample.create(); const alias = item; alias.value++;',
        'let item; item = Sample.create(); item.value = 2;',
        'let item = Sample.create(); item = Sample.create(); item.value = 2;',
        'const key = "value"; const item = Sample.create(); item[key] = 2;',
        'function change(Sample) { const item = Sample; item.value = 2; }\nchange(Sample.create());'
    ])('Checks known external receivers without treating an unrelated parameter as a class.', suffix =>
    {
        const source = `class Sample { readonly Number value; }\n${suffix}`;
        const errors = compile(source, objectModel).errors;
        const expected = suffix.startsWith('function') ? 0 : 1;
        expect(errors.filter(error => error.code === 'lgd.member.readonly')).toHaveLength(expected);
    });

    test.each([
        'Sample() { Sample.value = 2; }',
        'static change() { Sample.value = 2; }',
        'Number other = (Sample.value = 2);',
        'static Function later = () => { Sample.value = 2; };',
        'static Number next = (() => { Sample.value = 2; return 1; })();'
    ])('Rejects static readonly writes from %s', body =>
    {
        const errors = compile(`class Sample { static readonly Number value; ${body} }`, objectModel).errors;
        expect(errors.filter(error => error.code === 'lgd.member.readonly')).toHaveLength(1);
    });

    test('Retains typed initializer and constructor-write diagnostics.', () =>
    {
        const result = compile('class Sample { readonly Number value = "wrong"; Sample() { this.value = "wrong"; } }', objectModel);
        expect(result.errors.filter(error => error.code === 'lgd.assignment.typeMismatch')).toHaveLength(2);
        expect(result.errors.some(error => error.code === 'lgd.member.readonly')).toBe(false);
    });

    test('Distinguishes same-named lexical class declarations and mutable shadowed locals.', () =>
    {
        const source = [
            'class Sample { readonly Number value; }',
            'const outer = Sample.create();',
            '{',
            '    class Sample { readonly Number value; Sample() { outer.value = 2; let value = 0; value++; this.value = value; } }',
            '}'
        ].join('\n');
        expect(compile(source, objectModel).errors.filter(error => error.code === 'lgd.member.readonly')).toHaveLength(1);
    });
});

describe('Readonly field inheritance and syntax', () =>
{
    test('Retains declaring constructor initialization and derived/base ordering in OLOO hierarchies.', () =>
    {
        const result = execute([
            'const events = [];',
            'class Root {',
            '    readonly Number first = (events.push("root field"), 1);',
            '    Root(Number first) { this.first = first; events.push("root body"); }',
            '}',
            'class Leaf : Root {',
            '    readonly Number second = (events.push("leaf field"), 2);',
            '    Leaf() : base((events.push("base argument"), 3)) { this.second = 4; events.push("leaf body"); return; }',
            '}',
            'module.exports = { item: Leaf.create(), events };'
        ].join('\n'), 'oloo');
        expect(result.item).toMatchObject({ first: 3, second: 4 });
        expect(result.events).toEqual([ 'leaf field', 'base argument', 'root field', 'root body', 'leaf body' ]);
    });

    test('Rejects derived constructor writes and inherited field hiding.', () =>
    {
        const source = 'class Root { readonly Number value; }\nclass Leaf : Root { Leaf() { this.value = 2; } }';
        expect(compile(source, 'oloo').errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.member.readonly' })]));
        const hiding = 'class Root { readonly Number value; }\nclass Leaf : Root { Number value; }';
        expect(compile(hiding, 'oloo').errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.member.collision' })]));
        expect(compile(source, 'class').errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.output.fieldInitializationOrder' })]));
    });

    test('Rejects foreign and derived static initializer writes but preserves static field hiding.', () =>
    {
        const source = [
            'class Root { static readonly Number value = 1; }',
            'class Leaf : Root { static Number other = (Leaf.value = 2); }',
            'class Foreign { static Number other = (Root.value = 2); }'
        ].join('\n');
        for(const model of [ 'oloo', 'class' ])
        {
            expect(compile(source, model).errors.filter(error => error.code === 'lgd.member.readonly')).toHaveLength(2);
            const result = execute('class Root { static readonly Number value = 1; }\nclass Leaf : Root { static Number value = 2; }\nLeaf.value++; module.exports = { root: Root.value, leaf: Leaf.value };', model);
            expect(result).toEqual({ root: 1, leaf: 3 });
        }
    });

    test.each([
        [ 'readonly method', 'class Sample { readonly change() {} }', 'lgd.syntax.readonlyMember' ],
        [ 'readonly property', 'abstract class Sample { readonly Number value { get; } }', 'lgd.syntax.readonlyMember' ],
        [ 'duplicate readonly', 'class Sample { readonly readonly Number value; }', null ],
        [ 'readonly override', 'class Sample { readonly override Number value; }', null ],
        [ 'interface field', 'interface Sample { readonly Number value; }', null ],
        [ 'static constructor', 'class Sample { static Sample() {} }', null ]
    ])('Diagnoses unsupported %s explicitly.', (label, source, code) =>
    {
        const errors = compile(source, 'oloo').errors;
        expect(errors.length).toBeGreaterThan(0);
        if(code)
        {
            expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: code })]));
        }
    });
});
