const virtualMachine = require('vm');
const { Oloo } = require('@mavega/oloo');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');
const LgdConstructorSignatures = require('../../../src/Compilers/LgdConstructorSignatures');

function compile(source, objectModel = 'oloo', externals = new Map())
{
    return LgdCompiler.create().compileToJs(source, externals, { javascriptObjectModel: objectModel });
}

function execute(source, objectModel)
{
    const result = compile(source, objectModel);
    expect(result.errors.filter(error => error.severity !== 'warning')).toEqual([]);
    const context = { Oloo: Oloo, module: { exports: null } };
    virtualMachine.runInNewContext(result.code, context);
    return context.module.exports;
}

describe.each([ 'oloo', 'class' ])('LGD constructor overloads with %s output.', objectModel =>
{
    test('Preserves the screenshot parameterized and empty constructors with later accessors.', () =>
    {
        const Command = execute([
            'class BaseCommand {',
            '    BaseCommand(String commandName, String title) { this.command = { title: title, command: commandName }; }',
            '    BaseCommand() {}',
            '    get String commandName() { return this.command.command; }',
            '}',
            'module.exports = BaseCommand;'
        ].join('\n'), objectModel);
        const full = Command.create('lgd.run', 'Run');
        const empty = Command.create();
        expect(full.commandName).toBe('lgd.run');
        expect(full.command.title).toBe('Run');
        expect(empty.command).toBeUndefined();
        expect(() => Command.create('invalid')).toThrow('No matching BaseCommand constructor overload.');
    });

    test('Selects defaults and rest by disjoint ranges and evaluates only the chosen defaults.', () =>
    {
        const exported = execute([
            'let defaults = 0;',
            'class Example {',
            '    Example() { this.value = "empty"; }',
            '    Example(String name, Number count = ++defaults) { this.value = name; this.count = count; this.length = arguments.length; }',
            '    Example(String name, Number count, Boolean flag, ...String labels) { this.value = name; this.labels = labels; this.length = arguments.length; }',
            '}',
            'const empty = Example.create();',
            'const named = Example.create("named");',
            'const rest = Example.create("rest", 2, true, "a", "b");',
            'module.exports = { empty, named, rest, defaults };'
        ].join('\n'), objectModel);
        expect(exported.empty.value).toBe('empty');
        expect(exported.named.count).toBe(1);
        expect(exported.named.length).toBe(1);
        expect(exported.rest.labels).toEqual([ 'a', 'b' ]);
        const restArgumentCount = 5;
        expect(exported.rest.length).toBe(restArgumentCount);
        expect(exported.defaults).toBe(1);
    });

    test('Runs the selected base and derived body once, preserving callbacks and early exits.', () =>
    {
        const Child = execute([
            'class Base {',
            '    Base() { this.visits = ["base-empty"]; }',
            '    Base(String name) { this.visits = [name]; }',
            '}',
            'class Child : Base {',
            '    Child() { this.visits.push("child-empty"); return; this.visits.push("unreachable"); }',
            '    Child(String name, Function callback) : base(name) { this.visits.push(callback()); this.read = () => this.visits; }',
            '}',
            'module.exports = Child;'
        ].join('\n'), objectModel);
        expect(Child.create().visits).toEqual([ 'base-empty', 'child-empty' ]);
        const child = Child.create('base-named', () => 'callback');
        expect(child.visits).toEqual([ 'base-named', 'callback' ]);
        expect(child.read()).toBe(child.visits);
    });

    test('Allows readonly writes in either constructor but rejects nested callback writes.', () =>
    {
        const source = [
            'class Example {',
            '    readonly Number value;',
            '    Example() { this.value = 1; }',
            '    Example(Number amount) { this.value = amount; this.read = () => this.value; }',
            '}',
            'module.exports = Example;'
        ].join('\n');
        const Example = execute(source, objectModel);
        expect(Example.create().value).toBe(1);
        expect(Example.create(2).read()).toBe(2);
        const invalid = compile(source.replace('this.read = () => this.value', 'this.read = () => this.value = 3'), objectModel);
        expect(invalid.errors.some(error => error.code === 'lgd.member.readonly')).toBe(true);
    });

    test('Keeps ordinary local var redeclarations, nested returns, and the original arguments object.', () =>
    {
        const Example = execute([
            'class Example {',
            '    Example() { this.value = "empty"; }',
            '    Example(String name) { var name; this.value = name; this.length = arguments.length; this.callback = () => { return name; }; }',
            '}',
            'module.exports = Example;'
        ].join('\n'), objectModel);
        const instance = Example.create('named');
        expect(instance.value).toBe('named');
        expect(instance.length).toBe(1);
        expect(instance.callback()).toBe('named');
    });

    test('Checks invalid counts and types through direct calls and unchanged factory aliases.', () =>
    {
        const result = compile([
            'class Example { Example() {} Example(String name, Function callback) {} }',
            'Example.create("one");',
            'Example.create(2, () => true);',
            'const factory = Example.create;',
            'factory("name", 3);'
        ].join('\n'), objectModel);
        expect(result.errors.map(error => error.code)).toEqual([
            'lgd.constructor.argumentCount', 'lgd.constructor.argumentType', 'lgd.constructor.argumentType'
        ]);
    });

    test('Checks selected constructor accessibility instead of the first declaration.', () =>
    {
        const result = compile([
            'class Example { private Example() {} public Example(String name) {} }',
            'Example.create("allowed");',
            'Example.create();',
            'class Child : Example { Child() : base("allowed") {} }'
        ].join('\n'), objectModel);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].code).toBe('lgd.access.inaccessible');
    });

    test('Preserves private base access checks when its sole signature receives spread arguments.', () =>
    {
        const result = compile([
            'class Base { private Base(...String labels) {} }',
            'class Child : Base { Child(...String labels) : base(...labels) {} }'
        ].join('\n'), objectModel);
        expect(result.errors.map(error => error.code)).toContain('lgd.access.inaccessible');
    });

    test('Checks return values in later overloads without consuming nested callbacks.', () =>
    {
        const result = compile('class Example { Example() {} Example(Number value) { this.read = () => { return value; }; return this; } }', objectModel);
        expect(result.errors.map(error => error.code)).toEqual(['lgd.constructor.returnValue']);
    });

    test('Retains exact mappings for parameters and the bodies of every constructor.', () =>
    {
        const source = 'class Example { Example(String title) { this.title = title; } Example() { this.title = "empty"; } }';
        const result = compile(source, objectModel);
        const map = LgdSourceMap.create(result.mappings);
        for(const offset of [ source.indexOf('title)'), source.indexOf('this.title'), source.lastIndexOf('this.title') ])
        {
            const output = map.toOutput(offset);
            expect(result.code.slice(output, output + 'title'.length)).toBe(source.slice(offset, offset + 'title'.length));
            expect(map.toSource(output)).toBe(offset);
        }
    });
});

describe('Constructor overload boundaries and recovery.', () =>
{
    test.each([
        [ 'Example() {} Example() {}', 'lgd.constructor.duplicateOverload' ],
        [ 'Example(String title) {} Example(Number value) {}', 'lgd.constructor.typeOnlyOverload' ],
        [ 'Example() {} Example(String title = "ready") {}', 'lgd.constructor.overlappingOverloads' ],
        [ 'Example(...String titles) {} Example(Number value) {}', 'lgd.constructor.overlappingOverloads' ]
    ])('Rejects unsupported signature set %s without losing later members.', (constructors, code) =>
    {
        const result = compile(`class Example { ${constructors} get String title() { return "ready"; } }`);
        expect(result.errors.map(error => error.code)).toContain(code);
        expect(result.declarations[0].constructorMembers).toHaveLength(2);
        expect(result.declarations[0].classMembers.at(-1).name).toBe('title');
    });

    test('Recovers after an invalid constructor modifier to retain later overloads and methods.', () =>
    {
        const result = compile('class Example { static Example(String name) {} Example() {} get String title() { return "ready"; } }');
        expect(result.errors.some(error => error.message.includes('constructor cannot'))).toBe(true);
        expect(result.declarations[0].constructorMembers).toHaveLength(1);
        expect(result.declarations[0].classMembers.at(-1).name).toBe('title');
    });

    test('Validates each base initializer and imported constructor overloads.', () =>
    {
        const base = compile('class Base { Base() {} Base(String name, Number value) {} }').declarations[0];
        const externals = new Map([[ './base', { kind: 'class', keyword: 'Object', exportName: 'Base', constructorSignatures: LgdConstructorSignatures.describeAll(base) } ]]);
        const result = compile([
            'const Object Base = require("./base");',
            'class Child : Base { Child() {} Child(String name) : base(name) {} Child(String name, Number value) : base(name, "bad") {} }'
        ].join('\n'), 'oloo', externals);
        expect(result.errors.some(error => error.code === 'lgd.base.argumentCount')).toBe(true);
        expect(result.errors.some(error => error.message.includes('argument 2 must be Number'))).toBe(true);
    });

    test('Initializes inherited OLOO fields exactly once on the final receiver in the established order.', () =>
    {
        const exported = execute([
            'let events = [];',
            'class Base { Number value = events.push("base-field"); Base() { events.push("base-empty"); } Base(String name) { events.push(name); } }',
            'class Child : Base { Number count = events.push("child-field"); Child() { events.push("child-empty"); } Child(String name) : base(name) { events.push("child-named"); } }',
            'const instance = Child.create("base-named");',
            'module.exports = { events, instance };'
        ].join('\n'), 'oloo');
        expect(exported.events).toEqual([ 'child-field', 'base-field', 'base-named', 'child-named' ]);
        expect(exported.instance.count).toBe(1);
        expect(exported.instance.value).toBe(2);
    });

    test('Selects overloads above an existing OLOO object factory without double allocation.', () =>
    {
        const exported = execute([
            'let allocations = 0;',
            'const Object Base = { create(String label) { allocations++; return { label }; } };',
            'class Child : Base { Child() : base("empty") {} Child(String label) : base(label) { this.ready = true; } }',
            'const empty = Child.create();',
            'const named = Child.create("named");',
            'module.exports = { empty, named, allocations };'
        ].join('\n'), 'oloo');
        expect(exported.empty.label).toBe('empty');
        expect(exported.named.label).toBe('named');
        expect(exported.named.ready).toBe(true);
        expect(exported.allocations).toBe(2);
    });

    test('Validates and executes native new expressions for either overload.', () =>
    {
        const Example = execute('class Example { Example() { this.value = 0; } Example(Number value) { this.value = value; } }\nmodule.exports = Example;', 'class');
        expect(new Example().value).toBe(0);
        expect(new Example(2).value).toBe(2);
        const result = compile('class Example { Example() {} Example(Number value) {} }\nnew Example("bad");', 'class');
        expect(result.errors.map(error => error.code)).toContain('lgd.constructor.argumentType');
    });
});
