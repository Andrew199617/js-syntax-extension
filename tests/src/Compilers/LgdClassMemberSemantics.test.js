const virtualMachine = require('vm');
const { Oloo } = require('@mavega/oloo');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

/** @description Compiles class member semantics for the requested JavaScript object model. */
function compile(source, objectModel)
{
    return LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
}

/** @description Runs emitted code against the actual OLOO runtime. */
function execute(source, objectModel)
{
    const result = compile(source, objectModel);
    expect(result.errors).toEqual([]);
    const context = { Oloo: Oloo, module: { exports: null } };
    virtualMachine.runInNewContext(result.code, context);
    return context.module.exports;
}

/** @description Supplies a bounded imported class descriptor for annotation-identity regressions. */
function importedClass(name, members)
{
    return { exportName: name, keyword: 'Object', kind: 'class', sourcePath: `/types/${name}.lgd`,
        constructorParams: [], methodsKnown: true, contractsKnown: true, methodSignatures: [], contractSignatures: [],
        members: [ { name: 'create', kind: 'method', static: true, returnTypeName: name, declaringType: name }, ...members ] };
}

/** @description Static initializer value used by scope regressions. */
const staticValue = 3;

/** @description Constructor and base initializer sum used by the runtime regression. */
const constructedValue = 6;

/** @description Own hidden static cell value after one update. */
const hiddenValue = 101;

/** @description Destructured array member value. */
const arrayValue = 5;

beforeEach(() => Oloo.objectMap.clear());

describe.each([ 'oloo', 'class' ])('LGD shared member semantics with %s output', objectModel =>
{
    test.each([ '/* leading */ "wrong"', '("wrong")', '( /* inside */ "wrong" ) /* trailing */' ])('Checks wrapped and commented typed initializers: %s.', initializer =>
    {
        const result = compile(`class Sample { static Number value = ${initializer}; }`, objectModel);
        expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.assignment.typeMismatch' })]));
        const offset = result.errors.find(error => error.code === 'lgd.assignment.typeMismatch').offset;
        expect(result.allDeclarations[0].initializerText).toContain('"wrong"');
        expect(`class Sample { static Number value = ${initializer}; }`.slice(offset, offset + '"wrong"'.length)).toBe('"wrong"');
    });

    test('Preserves the annotation class identity when the parameter shadows its type name.', () =>
    {
        const result = compile('class Sample { static Number count; static Number read(Sample Sample) { return Sample.count; } }', objectModel);
        const error = result.errors.find(diagnostic => diagnostic.code === 'lgd.member.receiverKind');
        expect(error).toBeDefined();
        expect(error.quickFix).toBeUndefined();
    });

    test('Resolves field assignment contracts in the annotation scope despite method-local type-name shadows.', () =>
    {
        const source = [
            'class Base {}',
            'class Derived : Base {}',
            'class Holder { Base value; void store(Derived incoming) { const Base = 1; this.value = incoming; } }'
        ].join('\n');
        expect(compile(source, objectModel).errors).toEqual([]);
    });

    test('Keeps local and directly imported nominal field chains independent of access-site namesakes.', () =>
    {
        const member = { name: 'value', kind: 'field', static: false, typeName: 'Number', propertyTypeName: 'Number', declaringType: 'Child' };
        const externals = new Map([[ './Child.js', importedClass('Child', [member]) ]]);
        for(const head of [ 'class Child { Number value = 1; }', 'const Child = require("./Child.js");' ])
        {
            const source = [
                head,
                'class Parent { Child child = Child.create();',
                '    Number read() { const Child = 3; this.child.value = "wrong"; return this.child.value; }',
                '}'
            ].join('\n');
            const result = LgdCompiler.create().compileToJs(source, externals, { javascriptObjectModel: objectModel });
            expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.assignment.typeMismatch' })]));
        }
    });

    test('Keeps unproven imported nominal annotations conservative without borrowing consumer namesakes.', () =>
    {
        const field = { name: 'child', kind: 'field', static: false, typeName: 'Child', propertyTypeName: 'Child', declaringType: 'Owner' };
        const externals = new Map([[ './Owner.js', importedClass('Owner', [field]) ]]);
        const source = [
            'class LocalChild {}',
            'class Child { Number value = 1; }',
            'const RemoteOwner = require("./Owner.js");',
            'RemoteOwner owner = RemoteOwner.create();',
            'owner.child = LocalChild.create();',
            'owner.child.value = "unknown provider type";'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source, externals, { javascriptObjectModel: objectModel });
        expect(result.errors).toEqual([]);
        const invalid = LgdCompiler.create().compileToJs(`${source}\nowner.child = 1;`, externals, { javascriptObjectModel: objectModel });
        expect(invalid.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.assignment.typeMismatch' })]));
        externals.set('./Child.js', importedClass('Child', []));
        const aliased = [
            'const RemoteChild = require("./Child.js");',
            'const RemoteOwner = require("./Owner.js");',
            'RemoteChild child = RemoteChild.create(); RemoteOwner owner = RemoteOwner.create();',
            'owner.child = child;'
        ].join('\n');
        expect(LgdCompiler.create().compileToJs(aliased, externals, { javascriptObjectModel: objectModel }).errors).toEqual([]);
    });

    test('Withholds method-result certainty after static method replacement or instance alias mutation.', () =>
    {
        for(const source of [
            'class Sample { static Number read() { return 1; } }\nSample.read = () => "ready";\nString text = Sample.read();',
            'class Sample { Number read() { return 1; } }\nconst instance = Sample.create(); const alias = instance; alias.read = () => "ready";\nString text = instance.read();'
        ])
        {
            expect(compile(source, objectModel).errors).toEqual([]);
        }
    });

    test.each([ 'Object.assign(this, { value: "ready" });', 'initialize(this);' ])('Keeps default-null inference conservative for dynamic constructor effects: %s.', body =>
    {
        const source = [
            'function initialize(instance) { instance.value = "ready"; }',
            `class Sample { String value; Sample() { ${body} } String read() { return this.value; } }`,
            'module.exports = Sample.create().read();'
        ].join('\n');
        expect(execute(source, objectModel)).toBe('ready');
    });

    test.each([ 'instance', 'static' ])('Withholds default-null proof when a %s receiver escapes outside its class.', receiverKind =>
    {
        const source = receiverKind === 'instance'
            ? [
                'class Sample { String value; String read() { return this.value; } }',
                'const instance = Sample.create(); Object.assign(instance, {value: "ready"});',
                'module.exports = instance.read();'
            ]
            : [
                'class Sample { static String value; static String read() { return Sample.value; } }',
                'Object.assign(Sample, {value: "ready"});',
                'module.exports = Sample.read();'
            ];
        expect(execute(source.join('\n'), objectModel)).toBe('ready');
    });

    test('Withholds inherited method results when the declaring type method is replaced.', () =>
    {
        const source = [
            'class Base { static Number read() { return 1; } }',
            'class Derived : Base {}',
            'Base.read = () => "ready";',
            'String text = Derived.read(); module.exports = text;'
        ].join('\n');
        expect(execute(source, objectModel)).toBe('ready');
    });

    test('Keeps static references stable when method parameters or body locals shadow the class name.', () =>
    {
        const source = [
            'class Sample {',
            '    static Number count = 3;',
            '    Number parameter(Number Sample) { return count; }',
            '    Number local() { const Sample = 5; return count; }',
            '}',
            'const instance = Sample.create();',
            'module.exports = [instance.parameter(5), instance.local()];'
        ].join('\n');
        expect(execute(source, objectModel)).toEqual([ staticValue, staticValue ]);
    });

    test('Runs field initializers outside constructor parameter and local scopes.', () =>
    {
        const source = [
            'const seed = 2;',
            'class Sample {',
            '    static Number count = 3;',
            '    Number outer = seed;',
            '    Number copy = count;',
            '    Sample(Number count = 5) { const seed = 9; }',
            '}',
            'const instance = Sample.create();',
            'module.exports = [instance.outer, instance.copy];'
        ].join('\n');
        expect(execute(source, objectModel)).toEqual([ 2, staticValue ]);
    });

    test('Rewrites bare static members in parameter defaults and base argument expressions.', () =>
    {
        const source = [
            'class Base { Base(Number input) { this.input = input; } }',
            'class Sample : Base {',
            '    static Number count = 3;',
            '    Sample(Number input = count) : base(count) { this.input += input; }',
            '    static Number read(Number input = count) { return input; }',
            '}',
            'module.exports = [Sample.create().input, Sample.read()];'
        ].join('\n');
        expect(execute(source, objectModel)).toEqual([ constructedValue, staticValue ]);
    });

    test('Preserves inherited static method storage while supporting own static field hiding.', () =>
    {
        const source = [
            'class Base { static Number count = 0; static void increment() { count++; } }',
            'class Hidden : Base { static Number count = 100; }',
            'Hidden.increment(); Hidden.count++;',
            'module.exports = [Base.count, Hidden.count];'
        ].join('\n');
        expect(execute(source, objectModel)).toEqual([ 1, hiddenValue ]);
    });

    test('Rewrites destructuring member targets and preserves local binding shadows.', () =>
    {
        const source = [
            'class Sample {',
            '    Number count = 0;',
            '    void object(Object values) { ({count = 2} = values); }',
            '    void array(Array values) { [count] = values; }',
            '    Number local() { let count = 9; ({count} = {count: 10}); return count; }',
            '}',
            'const instance = Sample.create(); instance.object({}); const initial = instance.count;',
            'instance.array([5]); module.exports = [initial, instance.count, instance.local()];'
        ].join('\n');
        expect(execute(source, objectModel)).toEqual([ 2, arrayValue, 10 ]);
        const rejected = compile('class Sample { Number count; void update() { ({count} = {count: "wrong"}); } }', objectModel);
        expect(rejected.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.assignment.typeMismatch' })]));
    });

    test('Withholds receiver fixes for dynamic evaluation and dynamic scope.', () =>
    {
        const prefix = 'class Sample { static Number count; }\nconst instance = Sample.create();\n';
        const evaluated = compile(`${prefix}eval("Sample = unknown;"); instance.count;`, objectModel);
        const diagnostic = evaluated.errors.find(error => error.code === 'lgd.member.receiverKind');
        expect(diagnostic).toBeDefined();
        expect(diagnostic.quickFix).toBeUndefined();
        const dynamic = compile(`${prefix}with (unknown) { instance.count; }`, objectModel);
        expect(dynamic.errors.some(error => error.quickFix?.kind === 'useStaticTypeReceiver')).toBe(false);
    });

    test('Does not let a static method satisfy an instance interface method contract.', () =>
    {
        const source = 'interface Runnable { Number run(); }\nclass Sample : Runnable { static Number run() { return 1; } }';
        expect(compile(source, objectModel).errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.contract.missingMember' })]));
    });
});

describe('LGD inherited native prototype mutation inference', () =>
{
    test('Withholds inherited instance method results when its declaring prototype changes.', () =>
    {
        const source = [
            'class Base { Number read() { return 1; } }',
            'class Derived : Base {}',
            'Base.prototype.read = () => "ready";',
            'const instance = Derived.create();',
            'String text = instance.read(); module.exports = text;'
        ].join('\n');
        expect(execute(source, 'class')).toBe('ready');
    });
});
