const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');
const LgdConstructionLowering = require('../../../src/Compilers/LgdConstructionLowering');
const LgdModuleBindings = require('../../../src/Compilers/LgdModuleBindings');

/** @description Runs the compiled program in a separate, real Node process. */
function execute(result, expression, prelude = '')
{
    expect(result.errors.filter(error => error.severity !== 'warning')).toEqual([]);
    const script = `${prelude}\n${result.code}\nconsole.log(JSON.stringify(${expression}));`;
    const child = spawnSync(process.execPath, [ '-e', script ], { encoding: 'utf8' });
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    return JSON.parse(child.stdout);
}

/** @description Supplies explicit class construction records from independently compiled LGD modules. */
function externalClass(name, model)
{
    const compiled = LgdCompiler.create().compileToJs(`class ${name} { ${name}(Number value = 1) { this.value = value; } }`, new Map(), { javascriptObjectModel: model });
    expect(compiled.errors).toEqual([]);
    return { kind: 'class', keyword: 'Object', exportName: name, name: name, constructionKind: compiled.allDeclarations[0].constructionKind,
        constructorParams: [{ name: 'value', typeName: 'Number', optional: true, defaultText: '1' }], members: [], methodsKnown: true };
}

describe('Per-class LGD construction lowering.', () =>
{
    test.each([ 'oloo', 'class' ])('Executes the exact original BaseCommand overload fixture with %s output.', async model =>
    {
        const source = await fs.promises.readFile(path.join(__dirname, '../../fixtures/construction/BaseCommand.lgd'), 'utf8');
        const compiled = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: model });
        expect(execute(compiled, `{ name: full.commandName, command: full.command.command, title: full.command.title, independent: full !== empty, emptyOwnCommand: Object.hasOwn(empty, "command"), prototype: Object.getPrototypeOf(full) === ${model === 'class' ? 'BaseCommand.prototype' : 'BaseCommand'} }`))
            .toEqual({ name: 'lgd.run', command: 'lgd.run', title: 'Run', independent: true, emptyOwnCommand: false, prototype: true });
        const construction = model === 'class' ? 'new BaseCommand("lgd.run", "Run")' : 'BaseCommand.create("lgd.run", "Run")';
        expect(compiled.code).toContain(construction);
        expect(compiled.code).toContain(model === 'class' ? 'new BaseCommand()' : 'BaseCommand.create()');
    });

    test.each([ 'oloo', 'class' ])('Executes the unchanged readonly Calculator fixture with %s output.', async model =>
    {
        const source = await fs.promises.readFile(path.join(__dirname, '../../fixtures/construction/Calculator.lgd'), 'utf8');
        const compiled = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: model });
        const expectedCalculation = 6;
        expect(execute(compiled, 'result')).toBe(expectedCalculation);
        expect(compiled.errors).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'warning', code: 'lgd.declaration.readonly' })]));
    });

    test.each([ 'oloo', 'class' ])('Preserves defaults, rest, source arguments, effects, errors and allocation with %s output.', model =>
    {
        const source = [
            'const trace = [];',
            'function argument(value) { trace.push(value); return value; }',
            'class Counter {',
            '    Counter(Number first = argument(1), ...Number rest) { trace.push("body"); this.first = first; this.rest = rest; this.count = arguments.length; this.items = []; }',
            '}',
            'const first = new /* before */ (Counter) /* after */ (argument(2), ...[argument(3), argument(4)]);',
            'const second = new Counter;',
            'const third = new (Counter);',
            'first.items.push("unique");',
            'function fail() { trace.push("throw"); throw new Error("argument failed"); }',
            'try { new Counter(fail(), argument(5)); } catch(error) { trace.push(error.message); }'
        ].join('\r\n');
        const compiled = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: model });
        const secondArgument = 3;
        const thirdArgument = 4;
        expect(execute(compiled, '{ trace, first: first.first, rest: first.rest, count: first.count, separate: first !== second && second !== third, items: second.items, third: third.first }'))
            .toEqual({ trace: [ 2, secondArgument, thirdArgument, 'body', 1, 'body', 1, 'body', 'throw', 'argument failed' ], first: 2, rest: [ secondArgument, thirdArgument ], count: secondArgument, separate: true, items: [], third: 1 });
        expect(compiled.code).toContain('/* before */');
        expect(compiled.code).toContain('/* after */');
        const map = LgdSourceMap.create(compiled.mappings);
        for(const text of [ 'Counter) /* after */', 'argument(2)', 'argument(3)', 'argument(4)', 'fail(), argument(5)' ])
        {
            const offset = source.indexOf(text);
            expect(map.toSource(map.toOutput(offset))).toBe(offset);
        }
    });

    test.each([ 'oloo', 'class' ])('Preserves subclass receiver and constructor evaluation order with %s output.', model =>
    {
        const source = [
            'const trace = [];',
            'function record(label, value) { trace.push(label); return value; }',
            'class Parent { Parent(Number value) { trace.push("parent"); this.value = value; this.parentReceiver = this; } }',
            'class Child : Parent { Child(Number value) : base(record("base argument", value)) { trace.push("child"); this.childReceiver = this; } }',
            'const child = new Child(record("source argument", 7));'
        ].join('\n');
        const compiled = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: model });
        const prelude = 'const Oloo = { assign(target, source) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); return target; } };';
        expect(execute(compiled, '{ trace, value: child.value, same: child.parentReceiver === child && child.childReceiver === child }', prelude))
            .toEqual({ trace: [ 'source argument', 'base argument', 'parent', 'child' ], value: 7, same: true });
    });

    test.each([ 'oloo', 'class' ])('Propagates a throwing base constructor without running the child body with %s output.', model =>
    {
        const source = [
            'const trace = []; let observed; let constructed = null;',
            'function record(label, value) { trace.push(label); return value; }',
            'class Parent { Parent(Number value) { observed = this; this.value = value; trace.push("parent"); throw new Error("parent failed"); } }',
            'class Child : Parent { Child(Number value) : base(record("base argument", value)) { trace.push("child"); } }',
            'try { constructed = new Child(record("source argument", 8)); } catch(error) { trace.push(error.message); }'
        ].join('\n');
        const compiled = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: model });
        const prelude = 'const Oloo = { assign(target, source) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); return target; } };';
        const expectedValue = 8;
        expect(execute(compiled, '{ trace, value: observed.value, constructed }', prelude))
            .toEqual({ trace: [ 'source argument', 'base argument', 'parent', 'parent failed' ], value: expectedValue, constructed: null });
    });

    test('Retains C# declared-field initialization order for factory construction.', () =>
    {
        const source = [
            'const trace = [];',
            'function record(label) { trace.push(label); return []; }',
            'class Parent { Number[] parent = record("parent field"); Parent() { trace.push("parent body"); } }',
            'class Child : Parent { Number[] child = record("child field"); Child() { trace.push("child body"); } }',
            'const first = new Child(); const second = new Child(); first.parent.push(1); first.child.push(2);'
        ].join('\n');
        const compiled = LgdCompiler.create().compileToJs(source);
        const prelude = 'const Oloo = { assign(target, source) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); return target; } };';
        expect(execute(compiled, '{ trace, parent: second.parent, child: second.child, separate: first !== second }', prelude))
            .toEqual({ trace: [ 'child field', 'parent field', 'parent body', 'child body', 'child field', 'parent field', 'parent body', 'child body' ], parent: [], child: [], separate: true });
    });

    test.each([ 'oloo', 'class' ])('Mixes known imported factories, native classes and foreign constructors in one %s consumer.', model =>
    {
        const externals = new Map([ [ './factory', externalClass('Factory', 'oloo') ],
            [ './native', externalClass('Native', 'class') ],
            [ './unknown', { kind: 'class', keyword: 'Object', exportName: 'Unknown', members: [] } ] ]);
        const source = [
            'const Factory = require("./factory"); const Native = require("./native"); const Unknown = require("./unknown");',
            'const FactoryAlias = Factory; let NativeAlias = Factory; NativeAlias = Native;',
            'const factory = new Factory(2); const alias = new FactoryAlias(3); const native = new Native(4); const changed = new NativeAlias(5);',
            'const foreign = new Unknown(6); const date = new Date(0); const map = new Map();',
            'function shadow(Factory) { return new Factory(7); }',
            'const shadowed = shadow(Native);'
        ].join('\n');
        const compiled = LgdCompiler.create().compileToJs(source, externals, { javascriptObjectModel: model });
        expect(compiled.code).toContain('Factory.create(2)');
        expect(compiled.code).toContain('FactoryAlias.create(3)');
        for(const text of [ 'new Native(4)', 'new NativeAlias(5)', 'new Unknown(6)', 'new Date(0)', 'new Map()', 'new Factory(7)' ])
        {
            expect(compiled.code).toContain(text);
        }

        const factory = LgdCompiler.create().compileToJs('class Factory { Factory(Number value) { this.value = value; } }').code;
        const native = 'class Foreign { constructor(value) { this.value = value; } static create() { throw new Error("must stay new"); } }';
        const prelude = `const fixtureFactory = (() => { ${factory}\nreturn Factory; })();\n${native}\nfunction require(spec) { return spec === "./factory" ? fixtureFactory : Foreign; }`;
        const third = 3;
        const fourth = 4;
        const fifth = 5;
        const sixth = 6;
        const seventh = 7;
        expect(execute(compiled, '{ values: [factory.value, alias.value, native.value, changed.value, foreign.value, shadowed.value], date: date.getTime(), map: map.size }', prelude))
            .toEqual({ values: [ 2, third, fourth, fifth, sixth, seventh ], date: 0, map: 0 });
    });

    test('Keeps unknown, mutated, escaped, shadowed-require and dynamic constructor expressions untouched.', () =>
    {
        const external = externalClass('Factory', 'oloo');
        const externals = new Map([[ './factory', external ]]);
        externals.moduleExports = new Map([[ './namespace', new Map([[ 'Factory', external ]]) ]]);
        const source = [
            'const namespace = require("./namespace"); namespace.Factory = Other;',
            'const escaped = require("./namespace"); mutate(escaped);',
            'new namespace.Factory(); new escaped.Factory(); new getConstructor()(); new globalThis.Factory();',
            'function wrapped(require) { const Factory = require("./factory"); return new Factory(); }'
        ].join('\n');
        const compiled = LgdCompiler.create().compileToJs(source, externals);
        expect(compiled.code).toBe(source);
        const dynamic = 'const Factory = require("./factory"); eval("Factory = Other"); new Factory();';
        expect(LgdCompiler.create().compileToJs(dynamic, externals).code).toBe(dynamic);
    });

    test('Preserves return, throw, yield and expression precedence across new-token line breaks.', () =>
    {
        const source = [
            'class Example { Example() { this.value = 1; } }',
            'function returned() { return new\nExample(); }',
            'function returnedComment() { return new\n/* comment */ Example(); }',
            'function *values() { yield new\nExample(); }',
            'let caught; try { throw new\n/* throw comment */ Example(); } catch(error) { caught = error.value; }',
            'const call = () => new Example().value + (new Example).value;'
        ].join('\n');
        const compiled = LgdCompiler.create().compileToJs(source);
        expect(execute(compiled, '{ returned: returned().value, comment: returnedComment().value, yielded: values().next().value.value, caught, precedence: call() }'))
            .toEqual({ returned: 1, comment: 1, yielded: 1, caught: 1, precedence: 2 });
    });

    test('Keeps private-constructor and overload diagnostics at original source ranges.', () =>
    {
        const source = 'class Restricted { private Restricted() {} public Restricted(Number value) {} }\nnew Restricted(); new Restricted("bad"); new Restricted(1, 2);';
        const compiled = LgdCompiler.create().compileToJs(source);
        expect(compiled.code).toContain('Restricted.create()');
        expect(compiled.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'lgd.access.inaccessible' }),
            expect.objectContaining({ code: 'lgd.constructor.argumentType', offset: source.indexOf('"bad"') }),
            expect.objectContaining({ code: 'lgd.constructor.argumentCount', offset: source.indexOf('new Restricted(1, 2)') })
        ]));
    });

    test('Does not guess CommonJS export identity from shadowed, nested, dynamic or escaped exports.', () =>
    {
        for(const source of [
            'function fake(module) { module.exports = Factory; }',
            'const module = holder; module.exports = Factory;',
            'if(ready) module.exports = Factory;',
            'module.exports = Factory; module.exports = getOther();',
            'module.exports = { Factory, ...others };',
            'module.exports = Factory; mutate(module.exports);'
        ])
        {
            expect([...LgdModuleBindings.exports(source, [])]).toEqual([]);
        }

        expect([...LgdModuleBindings.exports('module.exports = Factory; module.exports = Native;', [])])
            .toEqual([[ 'default', { name: 'Native' } ]]);

        expect([...LgdModuleBindings.exports('exports.Factory = Factory; module.exports.Native = Native;', [])])
            .toEqual([ [ 'Factory', { name: 'Factory', commonJsProperty: true } ], [ 'Native', { name: 'Native', commonJsProperty: true } ] ]);
    });

    test('Treats require of ESM or a CommonJS default property as a namespace, not its default class.', () =>
    {
        const esm = { ...externalClass('Factory', 'oloo'), moduleKind: 'esm' };
        const named = { ...externalClass('Factory', 'oloo'), moduleKind: 'commonjs', commonJsProperty: true };
        for(const entry of [ esm, named ])
        {
            const externals = new Map([[ './provider', entry ]]);
            externals.moduleExports = new Map([[ './provider', new Map([[ 'default', entry ]]) ]]);
            const source = 'const namespace = require("./provider"); new namespace(); new namespace.default();';
            const compiled = LgdCompiler.create().compileToJs(source, externals);
            expect(compiled.code).toContain('new namespace()');
            const projection = 'const namespace = require("./provider"); new namespace.default();';
            expect(LgdCompiler.create().compileToJs(projection, externals).code).toContain('namespace.default.create()');
        }

        const externals = new Map([[ './provider', named ]]);
        externals.moduleExports = new Map([[ './provider', new Map([[ 'default', named ]]) ]]);
        expect(LgdCompiler.create().compileToJs('import Default from "./provider"; new Default();', externals).code).toContain('new Default()');
    });

    test('Leaves dynamic namespace selectors unknown even beside a class exported as undefined.', () =>
    {
        const exported = { ...externalClass('Factory', 'oloo'), moduleKind: 'commonjs', commonJsProperty: true, constructorAccessibility: 'private' };
        const externals = new Map();
        externals.moduleExports = new Map([[ './provider', new Map([[ 'undefined', exported ]]) ]]);
        const source = 'const namespace = require("./provider"); function make(key) { return new namespace[key](); }';
        const compiled = LgdCompiler.create().compileToJs(source, externals);
        expect(compiled.code).toBe(source);
        expect(compiled.errors).toEqual([]);
    });

    test('Does not mutate input output maps or public factory calls.', () =>
    {
        const source = 'class Factory { Factory() {} }\nFactory.create(); new Factory();';
        const compiled = LgdCompiler.create().compileToJs(source);
        expect(compiled.code.match(/Factory\.create\(\)/g)).toHaveLength(2);
        const emitted = { code: 'new Unknown()', segments: [{ srcStart: 0, srcEnd: 13, outStart: 0, outEnd: 13, verbatim: true }] };
        expect(LgdConstructionLowering.apply({ content: emitted.code, declarations: [], externals: new Map() }, emitted, null)).toBe(emitted);
    });
});
