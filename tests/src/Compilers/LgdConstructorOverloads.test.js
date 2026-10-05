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

describe.each([ 'oloo', 'class' ])('Generated factory layout with %s output.', objectModel =>
{
    test.each([
        '',
        'Example(Number value = 1) { this.value = value; }',
        'Example() {} Example(Number value, ...String labels) { this.value = value; this.labels = labels; }'
    ])('Puts create first without an empty header line for constructor set %s.', constructors =>
    {
        const source = [
            'class Example {',
            '    Number value = 1;',
            '    /** Reads the current value. */',
            '    Number read() { return this.value; }',
            `    ${constructors}`,
            '    /** Keeps the later member in place. */',
            '    Number later() { return this.value; }',
            '}'
        ].join('\r\n');
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        expect(result.code).toMatch(/^\S[^\n\r]*{\r\n {4}\/\*\*/);
        expect(result.code.indexOf('create(')).toBeLessThan(result.code.indexOf('Reads the current value.'));
        expect(result.code.indexOf('read()')).toBeLessThan(result.code.indexOf('later()'));
        expect(result.code).toContain('Keeps the later member in place.');
        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
        if(constructors && objectModel === 'class')
        {
            expect(result.code.indexOf('read()')).toBeLessThan(result.code.indexOf('constructor('));
            expect(result.code.indexOf('constructor(')).toBeLessThan(result.code.indexOf('later()'));
        }
    });

    test('Preserves comments and mappings on ordinary methods and the original constructor.', () =>
    {
        const source = [
            'class Example {',
            '    /** Reads the label. */',
            '    String read() { return this.label; }',
            '    // Initialize only when called.',
            '    Example(String label) { this.label = label; }',
            '    /** Reads the same label later. */',
            '    String later() { return this.label; }',
            '}'
        ].join('\n');
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        expect(result.code.indexOf('read()')).toBeLessThan(result.code.indexOf('// Initialize only when called.'));
        expect(result.code.indexOf('// Initialize only when called.')).toBeLessThan(result.code.indexOf('this.label = label;'));
        const map = LgdSourceMap.create(result.mappings);
        expect(result.code).toContain('Reads the label.');
        expect(result.code).toContain('Reads the same label later.');
        for(const marker of [ 'read()', 'Initialize only when called.', 'label)', 'this.label = label;', 'later()' ])
        {
            const offset = source.indexOf(marker);
            const output = map.toOutput(offset);
            expect(result.code.slice(output, output + marker.length)).toBe(marker);
            expect(map.toSource(output)).toBe(offset);
        }
    });
});

describe('Generated factory evaluation order.', () =>
{
    test('Keeps object-base construction, constructor comments, defaults and body effects together.', () =>
    {
        const source = [
            'let events = [];',
            'const Object Base = { create(String label) { events.push("base"); return { label }; } };',
            'class Child : Base {',
            '    String read() { return this.label; } // This stays with read.',
            '    /** Builds the child. */',
            '    // This stays with construction.',
            '    Child(String label = "ready", ...String labels) : base(label) { events.push("body"); this.labels = labels; this.count = arguments.length; }',
            '    String later() { return this.label; }',
            '}',
            'const initial = Child.create();',
            'const named = Child.create("named", "a", "b");',
            'module.exports = { initial, named, events };'
        ].join('\n');
        const result = compile(source);
        expect(result.errors).toEqual([]);
        const child = result.code.slice(result.code.indexOf('const Child'));
        expect(child.indexOf('Builds the child.')).toBeLessThan(child.indexOf('create('));
        expect(child.indexOf('This stays with construction.')).toBeLessThan(child.indexOf('create('));
        expect(child.indexOf('create(')).toBeLessThan(child.indexOf('read()'));
        expect(child).toContain('read() { return this.label; }, // This stays with read.');
        expect(child.indexOf('read()')).toBeLessThan(child.indexOf('later()'));
        const exported = execute(source, 'oloo');
        expect(exported.events).toEqual([ 'base', 'body', 'base', 'body' ]);
        expect(exported.initial.read()).toBe('ready');
        expect(exported.initial.count).toBe(0);
        expect(exported.named.labels).toEqual([ 'a', 'b' ]);
        const argumentCount = 3;
        expect(exported.named.count).toBe(argumentCount);
        const map = LgdSourceMap.create(result.mappings);
        for(const marker of [ 'Builds the child.', 'This stays with read.', 'This stays with construction.', 'label = "ready"', 'events.push("body")' ])
        {
            const offset = source.indexOf(marker);
            expect(result.code.slice(map.toOutput(offset), map.toOutput(offset) + marker.length)).toBe(marker);
        }
    });

    test('Retains symbol-key helper identities and their definition-time evaluation order.', () =>
    {
        const source = [
            'class Example {',
            '    Number value = 1;',
            '    Number read() { return this.value; }',
            '    Example() {}',
            '    Example(Number value) { this.value = value; }',
            '}',
            'module.exports = Example;'
        ].join('\n');
        const result = compile(source);
        expect(result.errors).toEqual([]);
        const keys = [];
        const context = {
            Symbol: {
                /** @description Records definition-time helper keys while keeping native symbol identity. */
                for: key =>
                {
                    keys.push(key);
                    return Symbol.for(key);
                }
            },
            module: { exports: null }
        };
        virtualMachine.runInNewContext(result.code, context);
        expect(keys).toEqual([ 'lgd.class.initialize', 'lgd.class.initialize:0', 'lgd.class.initialize:1', 'lgd.class.fields' ]);
        expect(Object.keys(context.module.exports)).toEqual([ 'create', 'read' ]);
        expect(Object.getOwnPropertySymbols(context.module.exports)).toEqual(keys.map(key => Symbol.for(key)));
        expect(context.module.exports.create(2).read()).toBe(2);
    });
});

describe.each([ 'oloo', 'class' ])('Constructor comment associations with %s output.', objectModel =>
{
    test('Keeps later overload comments with their selected branch or helper and leaves adjacent method docs intact.', () =>
    {
        const source = [
            'let events = [];',
            'class Example {',
            '    /** The first constructor remains documented. */',
            '    Example() { events.push("empty"); this.label = "empty"; }',
            '    /** Reads the label between overloads. */',
            '    String read() { return this.label; } // This belongs to read.',
            '',
            '    /** Uses the default count.',
            '     * Keeps this authored detail.',
            '     */',
            '    // Named overload marker.',
            '    Example(String label, Number count = events.push("default")) { events.push("named"); this.label = label; this.count = count; this.length = arguments.length; }',
            '    /** Documents the adjacent method. */',
            '    String adjacent() { return this.label; }',
            '',
            '    // Rest overload marker.',
            '',
            '    /* Keeps the separate rest comment. */',
            '    Example(String label, Number count, Boolean flag, ...String labels) { events.push("rest"); this.label = label; this.labels = labels; this.length = arguments.length; }',
            '    /** Documents the final method. */',
            '    String finalLabel() { return this.label; }',
            '}',
            'const empty = Example.create();',
            'const named = Example.create("named");',
            'const rest = Example.create("rest", 2, true, "a", "b");',
            'module.exports = { empty, named, rest, events };'
        ].join('\r\n');
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        for(const comment of [
            'The first constructor remains documented.',
            'Uses the default count.',
            'Keeps this authored detail.',
            'Named overload marker.',
            'Rest overload marker.',
            'Keeps the separate rest comment.',
            'This belongs to read.',
            'Reads the label between overloads.',
            'Documents the adjacent method.',
            'Documents the final method.'
        ])
        {
            expect(result.code.split(comment)).toHaveLength(2);
        }

        const namedComment = result.code.indexOf('// Named overload marker.');
        const restComment = result.code.indexOf('// Rest overload marker.');
        const firstDocumentation = result.code.indexOf('The first constructor remains documented.');
        const adjacentDocumentation = result.code.indexOf('Documents the adjacent method.');
        const finalDocumentation = result.code.indexOf('Documents the final method.');
        expect(adjacentDocumentation).toBeLessThan(result.code.indexOf('adjacent()'));
        expect(finalDocumentation).toBeLessThan(result.code.indexOf('finalLabel()'));
        if(objectModel === 'class')
        {
            expect(firstDocumentation).toBeLessThan(result.code.indexOf('constructor('));
            expect(namedComment).toBeLessThan(result.code.indexOf('if(_lgdArguments.length >= 1 && _lgdArguments.length <= 2)'));
            expect(restComment).toBeLessThan(result.code.indexOf('if(_lgdArguments.length >= 3)'));
            expect(restComment).toBeLessThan(result.code.indexOf('read()'));
            expect(result.code).toContain('        /** Uses the default count.\r\n         * Keeps this authored detail.\r\n         */');
            expect(result.code).toContain('        // Rest overload marker.\r\n\r\n        /* Keeps the separate rest comment. */');
        }
        else
        {
            expect(firstDocumentation).toBeLessThan(result.code.indexOf('[Symbol.for("lgd.class.initialize:0")]()'));
            expect(namedComment).toBeLessThan(result.code.indexOf('[Symbol.for("lgd.class.initialize:1")](label'));
            expect(restComment).toBeLessThan(result.code.indexOf('[Symbol.for("lgd.class.initialize:2")](label'));
            expect(result.code.indexOf('adjacent()')).toBeLessThan(restComment);
        }

        const map = LgdSourceMap.create(result.mappings);
        for(const marker of [ 'Uses the default count.', 'Keeps this authored detail.', 'Named overload marker.', 'Rest overload marker.', 'Keeps the separate rest comment.', 'This belongs to read.' ])
        {
            const offset = source.indexOf(marker);
            const output = map.toOutput(offset);
            expect(result.code.slice(output, output + marker.length)).toBe(marker);
            expect(map.toSource(output)).toBe(offset);
        }

        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
        const exported = execute(source, objectModel);
        expect(exported.events).toEqual([ 'empty', 'default', 'named', 'rest' ]);
        expect(exported.named.length).toBe(1);
        expect(exported.rest.labels).toEqual([ 'a', 'b' ]);
        const restArgumentCount = 5;
        expect(exported.rest.length).toBe(restArgumentCount);
        expect(exported.named.adjacent()).toBe('named');
        expect(exported.rest.finalLabel()).toBe('rest');
    });

    test('Moves a same-line leading JSDoc without consuming the following method documentation.', () =>
    {
        const source = [
            'class Example {',
            '    Example() {}',
            '    read() { return 1; } /** Later constructor docs. */ Example(Number value) { this.value = value; } /** Following method docs. */ later() { return 2; }',
            '}',
            'module.exports = Example;'
        ].join('\n');
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        const laterConstructor = objectModel === 'class' ? 'if(_lgdArguments.length === 1)' : '[Symbol.for("lgd.class.initialize:1")](value)';
        expect(result.code.indexOf('Later constructor docs.')).toBeLessThan(result.code.indexOf(laterConstructor));
        expect(result.code.indexOf('Following method docs.')).toBeLessThan(result.code.indexOf('later()'));
        expect(result.code.split('Later constructor docs.')).toHaveLength(2);
        expect(result.code.split('Following method docs.')).toHaveLength(2);
        expect(execute(source, objectModel).create(2).later()).toBe(2);
    });

    test('Retains a trailing line-comment boundary when a removed overload shares its line with the next method.', () =>
    {
        const source = [
            'class Example {',
            '    Example() {}',
            '    read() { return 1; } // Keep the line ending after this comment.',
            '    // This describes the named overload.',
            '    Example(Number value) { this.value = value; } later() { return 2; }',
            '}',
            'module.exports = Example;'
        ].join('\n');
        const Example = execute(source, objectModel);
        expect(Example.create(2).later()).toBe(2);
    });
});

test('Retains a trailing line-comment boundary when an object-base factory moves ahead of its methods.', () =>
{
    const source = [
        'const Object Base = { create() { return {}; } };',
        'class Child : Base {',
        '    read() { return 1; } // This remains a read comment.',
        '    /** Creates the child. */',
        '    Child() {} later() { return 2; }',
        '}',
        'module.exports = Child;'
    ].join('\n');
    const Child = execute(source, 'oloo');
    expect(Child.create().later()).toBe(2);
});
