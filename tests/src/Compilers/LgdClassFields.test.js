const virtualMachine = require('vm');
const { Oloo } = require('@mavega/oloo');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');

/** @description Compiles the same field syntax through either JavaScript object model. */
function compile(source, objectModel = 'oloo')
{
    return LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
}

/** @description Executes generated code with the real OLOO runtime. */
function execute(source, objectModel = 'oloo')
{
    const result = compile(source, objectModel);
    expect(result.errors).toEqual([]);
    const context = { Oloo: Oloo, module: { exports: null } };
    virtualMachine.runInNewContext(result.code, context);
    return context.module.exports;
}

beforeEach(() => Oloo.objectMap.clear());

describe.each([ 'oloo', 'class' ])('LGD declared fields with %s output.', objectModel =>
{
    test('Supplies primitive zero and reference null defaults as own writable fields.', () =>
    {
        const Sample = execute([
            'class Sample {',
            '    Number count;',
            '    Boolean enabled;',
            '    BigInt total;',
            '    String label;',
            '    Object settings;',
            '    Array items;',
            '}',
            'module.exports = Sample;'
        ].join('\n'), objectModel);
        const first = Sample.create();
        const second = Sample.create();
        const expected = { count: 0, enabled: false, total: 0n, label: null, settings: null, items: null };
        for(const [ name, value ] of Object.entries(expected))
        {
            expect(first[name]).toBe(value);
            expect(Object.getOwnPropertyDescriptor(first, name)).toEqual({
                value: value, writable: true, enumerable: true, configurable: true
            });
        }

        first.count = 2;
        first.label = 'first';
        expect(second.count).toBe(0);
        expect(second.label).toBeNull();
        expect(Sample.count).toBeUndefined();
    });

    test('Allocates mutable initializers once per instance before the constructor body.', () =>
    {
        const exported = execute([
            'let allocations = 0;',
            'const events = [];',
            'class Sample {',
            '    Array items = [];',
            '    Object settings = { visited: [] };',
            '    Number order = (events.push("field"), ++allocations);',
            '    Sample() { events.push("body"); this.items.push(this.order); }',
            '}',
            'module.exports = { Sample, events, allocations: () => allocations };'
        ].join('\n'), objectModel);
        expect(exported.events).toEqual([]);
        const first = exported.Sample.create();
        const second = exported.Sample.create();
        first.settings.visited.push('first');
        expect(first.items).toEqual([1]);
        expect(second.items).toEqual([2]);
        expect(first.items).not.toBe(second.items);
        expect(first.settings).not.toBe(second.settings);
        expect(second.settings.visited).toEqual([]);
        expect(exported.allocations()).toBe(2);
        expect(exported.events).toEqual([ 'field', 'body', 'field', 'body' ]);
    });

    test('Defines own fields without invoking an inherited setter.', () =>
    {
        const Sample = execute('class Sample { Number value = 2; }\nmodule.exports = Sample;', objectModel);
        const prototype = objectModel === 'class' ? Sample.prototype : Sample;
        const setter = jest.fn();
        Object.defineProperty(prototype, 'value', { set: setter, configurable: true });
        const instance = Sample.create();
        expect(setter).not.toHaveBeenCalled();
        expect(Object.getOwnPropertyDescriptor(instance, 'value')).toEqual({
            value: 2, writable: true, enumerable: true, configurable: true
        });
        instance.value = 1;
        expect(setter).not.toHaveBeenCalled();
        expect(instance.value).toBe(1);
    });

    test('Runs static initializers once in textual order with shared mutable storage.', () =>
    {
        const exported = execute([
            'let runs = 0;',
            'class Sample {',
            '    static Number count;',
            '    static Boolean enabled;',
            '    static BigInt total;',
            '    static String label;',
            '    static Object settings;',
            '    static Number first = second + 1;',
            '    static Number second = first + 1;',
            '    static Array shared = (++runs, []);',
            '    Number initial = Sample.second;',
            '}',
            'module.exports = { Sample, runs: () => runs };'
        ].join('\n'), objectModel);
        expect(exported.runs()).toBe(1);
        expect(exported.Sample.count).toBe(0);
        expect(exported.Sample.enabled).toBe(false);
        const zeroTotal = 0n;
        expect(exported.Sample.total).toBe(zeroTotal);
        expect(exported.Sample.label).toBeNull();
        expect(exported.Sample.settings).toBeNull();
        expect(exported.Sample.first).toBe(1);
        expect(exported.Sample.second).toBe(2);
        const first = exported.Sample.create();
        const second = exported.Sample.create();
        exported.Sample.shared.push('shared');
        expect(exported.Sample.shared).toEqual(['shared']);
        expect(first.initial).toBe(2);
        expect(second.initial).toBe(2);
        expect(exported.runs()).toBe(1);
        expect(Object.prototype.hasOwnProperty.call(first, 'shared')).toBe(false);
    });

    test('Preserves inherited static storage and binds static methods to their declaring class.', () =>
    {
        const exported = execute([
            'class Base {',
            '    static Number count = 1;',
            '    static Array shared = [];',
            '    static Number increment() { count += 1; return count; }',
            '    static Number shadow(Number count = 2) { return count; }',
            '}',
            'class Derived : Base {}',
            'module.exports = { Base, Derived };'
        ].join('\n'), objectModel);
        exported.Derived.count = 2;
        expect(exported.Base.count).toBe(2);
        expect(Object.prototype.hasOwnProperty.call(exported.Derived, 'count')).toBe(false);
        exported.Derived.shared.push('inherited');
        expect(exported.Base.shared).toEqual(['inherited']);
        const increment = exported.Derived.increment;
        const expectedCount = 3;
        expect(increment()).toBe(expectedCount);
        expect(exported.Base.count).toBe(expectedCount);
        expect(exported.Derived.count).toBe(expectedCount);
        expect(exported.Derived.shadow()).toBe(2);
    });

    test('Allows explicit instance references in static methods and lexical member names in instance methods.', () =>
    {
        const Sample = execute([
            'class Sample {',
            '    Number value = 2;',
            '    static Number extra = 1;',
            '    static Number read(Sample instance) { return instance.value; }',
            '    Number increment() { value += extra; return value; }',
            '    Number shadow(Number value) { return value; }',
            '}',
            'module.exports = Sample;'
        ].join('\n'), objectModel);
        const instance = Sample.create();
        const expectedValue = 3;
        expect(instance.increment()).toBe(expectedValue);
        expect(Sample.read(instance)).toBe(expectedValue);
        expect(instance.shadow(1)).toBe(1);
        expect(instance.value).toBe(expectedValue);
    });

    test('Allows field initializers to read an explicitly referenced other instance.', () =>
    {
        const Sample = execute([
            'class Dependency { Number value = 2; }',
            'const dependency = Dependency.create();',
            'class Sample {',
            '    Number value = dependency.value;',
            '    static Number shared = dependency.value;',
            '}',
            'module.exports = Sample;'
        ].join('\n'), objectModel);
        expect(Sample.create().value).toBe(2);
        expect(Sample.shared).toBe(2);
    });

    test('Preserves defaults, rest, arguments and same-named var constructor parameters exactly once.', () =>
    {
        const exported = execute([
            'let defaults = 0;',
            'class Sample {',
            '    Number value = 2;',
            '    Array labels = [];',
            '    Sample(Number value = ++defaults, ...String labels) {',
            '        var value;',
            '        this.before = this.value;',
            '        this.value = value;',
            '        this.labels = labels;',
            '        this.argumentCount = arguments.length;',
            '        return { discarded: true };',
            '    }',
            '}',
            'module.exports = { Sample, defaults: () => defaults };'
        ].join('\n'), objectModel);
        const first = exported.Sample.create();
        const suppliedValue = 7;
        const second = exported.Sample.create(suppliedValue, 'a', 'b');
        const expectedArguments = 3;
        expect(first.before).toBe(2);
        expect(first.value).toBe(1);
        expect(first.labels).toEqual([]);
        expect(first.argumentCount).toBe(0);
        expect(second.before).toBe(2);
        expect(second.value).toBe(suppliedValue);
        expect(second.labels).toEqual([ 'a', 'b' ]);
        expect(second.argumentCount).toBe(expectedArguments);
        expect(first.discarded).toBeUndefined();
        expect(second.discarded).toBeUndefined();
        expect(exported.defaults()).toBe(1);
    });

    test('Parses nested initializer semicolons, regexes and comments while preserving CRLF source mappings.', () =>
    {
        const source = [
            'class Sample {',
            '    // Keep this field comment.',
            '    Object settings = (() => {',
            '        const String label = "left;right";',
            '        return { label, matches: /;/.test(label), nested: () => { return 2; } };',
            '    })();',
            '    static String name = "static;name";',
            '    Number value = /* initializer comment */ (1 + 1);',
            '}',
            'module.exports = Sample;'
        ].join('\r\n');
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('// Keep this field comment.');
        expect(result.code).toContain('/* initializer comment */');
        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
        const map = LgdSourceMap.create(result.mappings);
        for(const text of [ '"left;right"', '"static;name"', '1 + 1', '/;/.test(label)' ])
        {
            const start = source.indexOf(text);
            const end = start + text.length;
            expect(result.code.slice(map.toOutput(start), map.toOutput(end))).toBe(text);
            expect(map.toSource(map.toOutput(start))).toBe(start);
            expect(map.toSource(map.toOutput(end))).toBe(end);
        }

        const Sample = execute(source, objectModel);
        const instance = Sample.create();
        expect(instance.settings.label).toBe('left;right');
        expect(instance.settings.matches).toBe(true);
        expect(instance.settings.nested()).toBe(2);
        expect(instance.value).toBe(2);
        expect(Sample.name).toBe('static;name');
    });

    test.each([
        [ 'type reading instance field', 'Sample.value;', 'lgd.member.receiverKind' ],
        [ 'type calling instance method', 'Sample.read();', 'lgd.member.receiverKind' ],
        [ 'instance reading static field', 'const instance = Sample.create(); instance.count;', 'lgd.member.receiverKind' ],
        [ 'instance calling static method', 'const instance = Sample.create(); instance.next();', 'lgd.member.receiverKind' ],
        [ 'wrong instance assignment', 'const instance = Sample.create(); instance.value = "wrong";', 'lgd.assignment.typeMismatch' ],
        [ 'wrong static assignment', 'Sample.count = "wrong";', 'lgd.assignment.typeMismatch' ],
        [ 'wrong compound assignment', 'const instance = Sample.create(); instance.value += "wrong";', 'lgd.assignment.typeMismatch' ],
        [ 'wrong numeric update', 'const instance = Sample.create(); instance.label++;', 'lgd.assignment.typeMismatch' ],
        [ 'wrong alias assignment', 'const instance = Sample.create(); const alias = instance; alias.value = false;', 'lgd.assignment.typeMismatch' ]
    ])('Diagnoses %s against the correct typed member.', (label, statement, code) =>
    {
        const source = [
            'class Sample {',
            '    Number value = 1;',
            '    String label = "sample";',
            '    static Number count = 0;',
            '    Number read() { return value; }',
            '    static Number next() { return count; }',
            '}',
            statement
        ].join('\n');
        const result = compile(source, objectModel);
        expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: code })]));
        const error = result.errors.find(candidate => candidate.code === code);
        expect(error.offset).toBeGreaterThanOrEqual(source.indexOf(statement));
        expect(error.endOffset).toBeGreaterThan(error.offset);
        expect(error.endOffset).toBeLessThanOrEqual(source.length);
    });
});

describe('LGD declared field inheritance and constructor lifecycle.', () =>
{
    test('Initializes derived fields before base arguments and runs every constructor on the allocated receiver.', () =>
    {
        const exported = execute([
            'const events = [];',
            'const receivers = [];',
            'class Base {',
            '    Number baseValue = (events.push("base-field"), 1);',
            '    Base(Number value) {',
            '        events.push("base-body"); receivers.push(this);',
            '        this.argument = value; this.seen = this.inspect();',
            '    }',
            '    virtual Number inspect() { return 0; }',
            '}',
            'class Derived : Base {',
            '    Array items = (events.push("derived-items"), []);',
            '    Number derivedValue = (events.push("derived-field"), 2);',
            '    Derived() : base((events.push("base-arguments"), 7)) {',
            '        events.push("derived-body"); receivers.push(this);',
            '    }',
            '    override Number inspect() { return this.derivedValue; }',
            '}',
            'module.exports = { Base, Derived, events, receivers };'
        ].join('\n'));
        const instance = exported.Derived.create();
        const expectedArgument = 7;
        expect(exported.events).toEqual([ 'derived-items', 'derived-field', 'base-arguments', 'base-field', 'base-body', 'derived-body' ]);
        expect(exported.receivers).toEqual([ instance, instance ]);
        expect(instance.seen).toBe(2);
        expect(instance.argument).toBe(expectedArgument);
        expect(Object.getPrototypeOf(instance)).toBe(exported.Derived);
        expect(Object.getPrototypeOf(exported.Derived)).toBe(exported.Base);
        expect(Object.getOwnPropertyDescriptor(instance, 'baseValue').value).toBe(1);
        expect(Oloo.objectMap.size).toBe(0);
        instance.items.push('first');
        const second = exported.Derived.create();
        expect(second.items).toEqual([]);
        expect(exported.receivers.slice(2)).toEqual([ second, second ]);
    });

    test('Runs three-level implicit initializers exactly once and ignores arguments to implicit constructors.', () =>
    {
        const exported = execute([
            'const events = [];',
            'let defaults = 0;',
            'class Base {',
            '    Number baseValue = (events.push("base"), 1);',
            '    Base(Number argument = ++defaults) { this.argument = argument; this.seen = this.inspect(); }',
            '    virtual Number inspect() { return 0; }',
            '}',
            'class Middle : Base { Number middleValue = (events.push("middle"), 2); }',
            'class Leaf : Middle {',
            '    Number leafValue = (events.push("leaf"), 10);',
            '    override Number inspect() { return this.leafValue; }',
            '}',
            'module.exports = { Leaf, events, defaults: () => defaults };'
        ].join('\n'));
        const ignoredArgument = 100;
        const first = exported.Leaf.create(ignoredArgument);
        expect(exported.events).toEqual([ 'leaf', 'middle', 'base' ]);
        expect(first.argument).toBe(1);
        expect(first.seen).toBe(10);
        expect(exported.defaults()).toBe(1);
        const second = exported.Leaf.create();
        expect(second.argument).toBe(2);
        expect(exported.defaults()).toBe(2);
        expect(exported.events).toEqual([ 'leaf', 'middle', 'base', 'leaf', 'middle', 'base' ]);
        expect(Oloo.objectMap.size).toBe(0);
    });

    test('Keeps fields initialized across early returns and still runs the derived body after a base return.', () =>
    {
        const exported = execute([
            'const events = [];',
            'class Base {',
            '    Array items = [];',
            '    Base() { events.push("base"); return; }',
            '}',
            'class Derived : Base {',
            '    Number value = 2;',
            '    Derived() { events.push("derived"); return { discarded: true }; }',
            '}',
            'module.exports = { Derived, events };'
        ].join('\n'));
        const instance = exported.Derived.create();
        expect(instance.items).toEqual([]);
        expect(instance.value).toBe(2);
        expect(instance.discarded).toBeUndefined();
        expect(exported.events).toEqual([ 'base', 'derived' ]);
    });

    test.each([
        'class Base {}\nclass Derived : Base { Number value = 1; }',
        'class Base { Number value = 1; }\nclass Derived : Base {}',
        'class Base { Number value = 1; }\nclass Middle : Base {}\nclass Derived : Middle {}'
    ])('Explains native inheritance initialization-order limitations instead of silently changing behavior.', source =>
    {
        expect(compile(source).errors).toEqual([]);
        expect(compile(source, 'class').errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'lgd.output.fieldInitializationOrder' })
        ]));
    });
});

describe('LGD field syntax and member diagnostics.', () =>
{
    test.each([
        [ 'const field', 'class Sample { const Number value = 1; }', 'not supported' ],
        [ 'new field', 'class Sample { new Number value = 1; }', 'not supported' ],
        [ 'virtual field', 'class Sample { virtual Number value = 1; }', 'cannot' ],
        [ 'override field', 'class Sample { override Number value = 1; }', 'cannot' ],
        [ 'abstract field', 'abstract class Sample { abstract Number value; }', 'cannot' ],
        [ 'interface field', 'interface Sample { Number value; }', 'cannot' ],
        [ 'void field', 'class Sample { void value; }', 'value type' ],
        [ 'lowercase type', 'class Sample { number value = 1; }', 'capitalized' ],
        [ 'missing initializer', 'class Sample { Number value = ; }', 'initializer expression' ],
        [ 'missing semicolon', 'class Sample { Number value = 1 }', 'Unbalanced brackets' ],
        [ 'duplicate static modifier', 'class Sample { static static Number value = 1; }', 'Duplicate' ],
        [ 'static constructor', 'class Sample { static Sample() {} }', 'constructor' ],
        [ 'static accessor', 'class Sample { static get label() { return "value"; } }', 'cannot' ],
        [ 'static class', 'static class Sample { static Number value = 1; }', 'not supported' ]
    ])('Rejects unsupported %s with a direct source diagnostic.', (label, source, message) =>
    {
        const result = compile(source);
        expect(result.errors.some(error => error.message.includes(message))).toBe(true);
        const error = result.errors.find(candidate => candidate.message.includes(message));
        expect(error.offset).toBeGreaterThanOrEqual(0);
        expect(error.offset).toBeLessThan(source.length);
    });

    test.each([
        'class Sample { Number first = 1, second = 2; }',
        'class Sample { static Number first = 1, second = 2; }'
    ])('Requires one declared field per semicolon instead of silently treating declarators as an expression.', source =>
    {
        const result = compile(source);
        expect(result.errors.some(error => error.message.includes('one typed field'))).toBe(true);
    });

    test.each([
        'class Sample { Number value; Number value; }',
        'class Sample { Number value; Number value() { return 1; } }',
        'class Sample { Number value; get value() { return 1; } }',
        'class Sample { Number value; static Number value; }',
        'class Base { Number value; }\nclass Derived : Base { Number value; }',
        'class Base { get value() { return 1; } }\nclass Derived : Base { Number value; }'
    ])('Diagnoses same-class and inherited field collisions.', source =>
    {
        expect(compile(source).errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'lgd.member.collision' })
        ]));
    });

    test.each([ 'create', 'constructor', '__proto__', 'Sample' ])('Reserves runtime field name %s.', name =>
    {
        expect(compile(`class Sample { Number ${name}; }`).errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'lgd.member.reservedName' })
        ]));
    });

    test.each([
        [ 'instance initializer', 'Number value = "wrong";' ],
        [ 'static initializer', 'static Number value = "wrong";' ]
    ])('Checks the type of a declared %s at its expression.', (label, field) =>
    {
        const source = `class Sample { ${field} }`;
        const result = compile(source);
        const error = result.errors.find(candidate => candidate.code === 'lgd.assignment.typeMismatch');
        expect(error).toBeDefined();
        expect(source.slice(error.offset, error.endOffset)).toBe('"wrong"');
    });

    test.each([
        [ 'this in static method', 'Number value = 1; static Number read() { return this.value; }', 'lgd.member.staticThis' ],
        [ 'implicit instance field in static method', 'Number value = 1; static Number read() { return value; }', 'lgd.member.staticInstance' ],
        [ 'implicit instance method in static method', 'Number read() { return 1; } static Number next() { return read(); }', 'lgd.member.staticInstance' ]
    ])('Rejects %s.', (label, members, code) =>
    {
        expect(compile(`class Sample { ${members} }`).errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: code })
        ]));
    });

    test.each([
        [ 'this in instance field', 'Number other = 1; Number value = this.other;', 'lgd.member.fieldInitializerThis' ],
        [ 'this in static field', 'Number other = 1; static Number value = this.other;', 'lgd.member.fieldInitializerThis' ],
        [ 'this in nested initializer arrow', 'Object value = () => this;', 'lgd.member.fieldInitializerThis' ],
        [ 'instance field in instance initializer', 'Number other = 1; Number value = other;', 'lgd.member.fieldInitializerInstance' ],
        [ 'instance method in instance initializer', 'Number read() { return 1; } Number value = read();', 'lgd.member.fieldInitializerInstance' ],
        [ 'instance field in static initializer', 'Number other = 1; static Number value = other;', 'lgd.member.fieldInitializerInstance' ],
        [ 'instance method in static initializer', 'Number read() { return 1; } static Number value = read();', 'lgd.member.fieldInitializerInstance' ]
    ])('Rejects %s under C#-style initializer restrictions.', (label, members, code) =>
    {
        const source = `class Sample { ${members} }`;
        for(const objectModel of [ 'oloo', 'class' ])
        {
            expect(compile(source, objectModel).errors).toEqual(expect.arrayContaining([
                expect.objectContaining({ code: code })
            ]));
        }
    });

    test('Rejects unknown field types while retaining declared class reference types.', () =>
    {
        expect(compile('class Sample { MissingType value; }').errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'lgd.member.unknownType' })
        ]));
        const Sample = execute('class Dependency {}\nclass Sample { Dependency value; }\nmodule.exports = Sample;');
        expect(Sample.create().value).toBeNull();
    });

    test('Infers declared fields for method returns without weakening the return contract.', () =>
    {
        const source = 'class Sample { Number value = 1; String label() { return value; } }';
        for(const objectModel of [ 'oloo', 'class' ])
        {
            expect(compile(source, objectModel).errors).toEqual(expect.arrayContaining([
                expect.objectContaining({ code: 'lgd.return.typeMismatch' })
            ]));
        }
    });

    test('Rejects declared instance fields on foreign OLOO factory bases.', () =>
    {
        const source = [
            'const Object Foreign = { create() { return Object.create(Foreign); } };',
            'class Sample : Foreign { Number value = 1; }'
        ].join('\n');
        expect(compile(source).errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'lgd.member.foreignBaseFields' })
        ]));
    });
});

describe('Declared field lowering boundaries and mappings.', () =>
{
    test.each([ 'oloo', 'class' ])('Maps initialized and default-only field declaration symbols in %s output.', objectModel =>
    {
        const source = 'class Sample { Number count = 1; String label; static Number total = 2; static Object owner; }';
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        const map = LgdSourceMap.create(result.mappings);
        for(const field of result.declarations[0].classMembers)
        {
            expect(result.code.slice(map.toOutput(field.nameStart), map.toOutput(field.nameEnd))).toBe(field.name);
            expect(map.toSource(map.toOutput(field.nameStart))).toBe(field.nameStart);
        }
    });

    test('Diagnoses the reserved native static prototype field before saving executable output.', () =>
    {
        const source = 'class Sample { static Object prototype; }';
        expect(compile(source, 'class').errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'lgd.output.staticPrototype', offset: source.indexOf('prototype') })
        ]));
        expect(compile(source, 'oloo').errors).toEqual([]);
    });
});
