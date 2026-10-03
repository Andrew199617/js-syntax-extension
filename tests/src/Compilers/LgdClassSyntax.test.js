const virtualMachine = require('vm');
const { Oloo } = require('@mavega/oloo');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');

function compile(source)
{
    return LgdCompiler.create().compileToJs(source);
}

function execute(source)
{
    const result = compile(source);
    expect(result.errors).toEqual([]);
    const context = { Oloo: Oloo, module: { exports: null } };
    virtualMachine.runInNewContext(result.code, context);
    return context.module.exports;
}

describe('LGD class syntax lowering.', () =>
{
    test('Class-name constructors initialize separate instances and keep the create API.', () =>
    {
        const Counter = execute([
            'class Counter {',
            '    Counter(Number value = 1) { this.value = value; this.items = []; }',
            '    increment() { this.value++; }',
            '    get valueLabel() { return String(this.value); }',
            '    set valueLabel(String label) { this.value = Number(label); }',
            '}',
            'module.exports = Counter;'
        ].join('\n'));
        const first = Counter.create();
        const initialSecondValue = 3;
        const expectedSecondValue = 4;
        const second = Counter.create(initialSecondValue);
        first.increment();
        first.items.push('first');
        second.valueLabel = '4';
        expect(first.valueLabel).toBe('2');
        expect(second.value).toBe(expectedSecondValue);
        expect(second.items).toEqual([]);
        expect(Counter.value).toBeUndefined();
        expect(Object.getPrototypeOf(first)).toBe(Counter);
        expect(Object.getOwnPropertyDescriptor(Counter, 'valueLabel').get).toEqual(expect.any(Function));
    });

    test('Runs the real Oloo.assign lifecycle with an existing base object and async override.', async () =>
    {
        const exported = execute([
            'const Object BaseCommand = {',
            '    create(String commandName, String title) {',
            '        const instance = Object.create(BaseCommand);',
            '        instance.command = { command: commandName, title: title };',
            '        return instance;',
            '    },',
            '    get commandName() { return this.command.command; },',
            '    /** @virtual */',
            '    executeCommand() { return this.commandName; }',
            '};',
            'class GoToAssignment : BaseCommand {',
            '    GoToAssignment() : base("lgd.goToAssignment", "Go To Assignment") {',
            '        this.ready = Boolean(this.commandName);',
            '    }',
            '    override async executeCommand() { return Oloo.base(this, "executeCommand") + "!"; }',
            '}',
            'module.exports = { BaseCommand, GoToAssignment };'
        ].join('\n'));
        const instance = exported.GoToAssignment.create();
        expect(instance.ready).toBe(true);
        expect(instance.command.title).toBe('Go To Assignment');
        expect(await instance.executeCommand()).toBe('lgd.goToAssignment!');
        expect(Object.getPrototypeOf(instance)).toBe(exported.GoToAssignment);
        expect(Object.getPrototypeOf(exported.GoToAssignment)).toBe(exported.BaseCommand);
        expect(Object.prototype.hasOwnProperty.call(instance, 'command')).toBe(true);
    });

    test('Preserves constructor parameters, defaults, rest, arguments, and safe temporary names.', () =>
    {
        const Example = execute([
            'class Example {',
            '    Example(Number _lgdInstance = 2, ...String labels) {',
            '        this.value = _lgdInstance;',
            '        this.labels = labels;',
            '        this.argumentCount = arguments.length;',
            '        this.read = () => this.value;',
            '        return;',
            '    }',
            '}',
            'module.exports = Example;'
        ].join('\n'));
        expect(Example.create().value).toBe(2);
        const initialValue = 4;
        const argumentCount = 3;
        const instance = Example.create(initialValue, 'a', 'b');
        expect(instance.labels).toEqual([ 'a', 'b' ]);
        expect(instance.argumentCount).toBe(argumentCount);
        expect(instance.read()).toBe(initialValue);
    });

    test('Supplies zero-argument constructors and links multilevel bases.', () =>
    {
        const exported = execute([
            'class Base { Base() { this.names = ["base"]; } }',
            'class Middle : Base { Middle() { this.names.push("middle"); } }',
            'class Leaf : Middle {}',
            'module.exports = { Base, Middle, Leaf };'
        ].join('\n'));
        const instance = exported.Leaf.create();
        expect(instance.names).toEqual([ 'base', 'middle' ]);
        expect(Object.getPrototypeOf(instance)).toBe(exported.Leaf);
        expect(Object.getPrototypeOf(exported.Leaf)).toBe(exported.Middle);
        expect(Object.getPrototypeOf(exported.Middle)).toBe(exported.Base);
    });

    test('Preserves multilevel Oloo.base dispatch and the original instance receiver.', () =>
    {
        const Leaf = execute([
            'class Base {',
            '    Base() { this.visited = []; }',
            '    virtual visit() { this.visited.push("base"); return this; }',
            '}',
            'class Middle : Base {',
            '    override visit() { this.visited.push("middle"); return Oloo.base(this, "visit"); }',
            '}',
            'class Leaf : Middle {',
            '    override visit() { this.visited.push("leaf"); return Oloo.base(this, Leaf.visit); }',
            '}',
            'module.exports = Leaf;'
        ].join('\n'));
        const first = Leaf.create();
        const second = Leaf.create();
        expect(first.visit()).toBe(first);
        expect(first.visited).toEqual([ 'leaf', 'middle', 'base' ]);
        expect(second.visited).toEqual([]);
        expect(second.visit()).toBe(second);
        expect(Oloo.objectMap.has(first)).toBe(false);
    });

    test('Preserves nested declarations, regex/template bodies, comments, and generator methods.', () =>
    {
        const Example = execute([
            'class Example {',
            '    /** Builds an instance. */',
            '    Example() { this.label = "ok"; }',
            '    *labels(Number count = /[})]/.test(")") ? 1 : 0) {',
            `        String label = \`\${this.label}:\${{ value: count }.value}\`;`,
            '        yield label;',
            '    }',
            '}',
            'module.exports = Example;'
        ].join('\n'));
        expect([...Example.create().labels()]).toEqual(['ok:1']);
    });

    test.each([ 'constructor', 'create' ])('Explains the required LGD constructor spelling for %s without implementation details.', spelling =>
    {
        const result = compile(`class Example { ${spelling}() {} }`);
        expect(result.errors.map(error => error.message)).toEqual(['Use Example(...) for the constructor.']);
    });

    test('Maps class/base/constructor names and untouched body symbols back to exact source ranges.', () =>
    {
        const source = [
            'class Base { Base(String title) { this.title = title; } }',
            'class Child : Base {',
            '    Child(String title) : base(title) { this.saved = title; }',
            '    async read(Number count) {',
            '        Number total = count + 1;',
            '        return this.saved + total;',
            '    }',
            '}'
        ].join('\r\n');
        const result = compile(source);
        expect(result.errors).toEqual([]);
        expect(result.code).not.toMatch(/\bclass\s+\w/);
        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
        const map = LgdSourceMap.create(result.mappings);
        for(const marker of [ 'Child :', 'Base {\r', 'title) :', 'title) { this.saved', 'this.saved', 'read(', 'count)', 'total;' ])
        {
            const offset = source.indexOf(marker);
            expect(offset).toBeGreaterThanOrEqual(0);
            const outputOffset = map.toOutput(offset);
            expect(map.toSource(outputOffset)).toBe(offset);
        }

        const constructorOffset = source.indexOf('Child(String');
        expect(result.code.slice(map.toOutput(constructorOffset), map.toOutput(constructorOffset) + 'create'.length)).toBe('create');
        expect(result.code.slice(map.toOutput(source.indexOf('Base {\r')), map.toOutput(source.indexOf('Base {\r')) + 'Base'.length)).toBe('Base');
        for(const declaration of result.allDeclarations.filter(item => item.kind === 'class'))
        {
            expect(result.code.slice(map.toOutput(declaration.nameStart), map.toOutput(declaration.nameEnd))).toBe(declaration.name);
            if(declaration.baseName)
            {
                expect(result.code.slice(map.toOutput(declaration.baseStart), map.toOutput(declaration.baseEnd))).toBe(declaration.baseName);
            }
        }
    });

    test('Reports unsupported or malformed class members instead of inventing JavaScript semantics.', () =>
    {
        const invalid = [
            'class Example { constructor() {} }',
            'class Example { create() {} }',
            'class Example { static virtual method() {} }',
            'class Example { Number value = ; }',
            'class Example { Example() {} Example() {} }',
            'class Example { async Example() {} }',
            'class Example { Example() : base() {} }',
            'class Example : Base { method() : base() {} }',
            'class Example extends Base {}',
            'class Example { Example() {'
        ];
        for(const source of invalid)
        {
            expect(compile(source).errors.length).toBeGreaterThan(0);
        }
    });

    test('Ignores class-looking strings and comments and preserves existing OLOO objects.', () =>
    {
        const source = [
            'const example = `class Fake { Fake() {} }`;',
            '/* class Comment { Comment() {} } */',
            'const Object Existing = { create() { return Object.create(Existing); } };'
        ].join('\n');
        const result = compile(source);
        expect(result.errors).toEqual([]);
        expect(result.allDeclarations.map(declaration => declaration.name)).toEqual(['Existing']);
        expect(result.code).toContain('create() { return Object.create(Existing); }');
    });

    test('Erases virtual and override modifiers while preserving typed signatures, comments and source maps.', async () =>
    {
        const source = [
            'class Base {',
            '    virtual async String describe(String label) { return label; }',
            '}',
            'class Derived : Base {',
            '    async override/* keep this comment */ String describe(String label) {',
            '        return label + " override";',
            '    }',
            '}',
            'module.exports = Derived;'
        ].join('\r\n');
        const result = compile(source);
        expect(result.errors).toEqual([]);
        expect(result.code).not.toContain('virtual async');
        expect(result.code).not.toContain('async override');
        expect(result.code).toContain('/* keep this comment */');
        expect(result.code).toContain('" override"');
        expect(result.code).toContain('@returns {Promise<string>}');
        const baseMethod = result.declarations[0].classMembers[0];
        const derivedMethod = result.declarations[1].classMembers[0];
        expect(baseMethod.virtual).toBe(true);
        expect(derivedMethod.override).toBe(true);
        expect(derivedMethod.async).toBe(true);
        expect(source.slice(baseMethod.virtualStart, baseMethod.virtualEnd)).toBe('virtual');
        expect(source.slice(derivedMethod.overrideStart, derivedMethod.overrideEnd)).toBe('override');
        const map = LgdSourceMap.create(result.mappings);
        for(const member of [ baseMethod, derivedMethod ])
        {
            expect(result.code.slice(map.toOutput(member.nameStart), map.toOutput(member.nameEnd))).toBe('describe');
            expect(map.toSource(map.toOutput(member.nameStart))).toBe(member.nameStart);
        }

        const Derived = execute(source);
        expect(await Derived.create().describe('value')).toBe('value override');
    });

    test('Rejects contradictory, duplicate and constructor/accessor method modifiers.', () =>
    {
        const invalid = [
            'virtual override run() {}',
            'override virtual run() {}',
            'virtual virtual run() {}',
            'override override run() {}',
            'async async run() {}',
            'virtual Example() {}',
            'override Example() {}',
            'virtual get label() { return "value"; }'
        ];
        for(const member of invalid)
        {
            expect(compile(`class Example { ${member} }`).errors.length).toBeGreaterThan(0);
        }
    });
});
