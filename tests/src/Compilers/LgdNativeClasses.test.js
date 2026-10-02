const virtualMachine = require('vm');
const typescript = require('typescript-test-5-9');
const { Oloo } = require('@mavega/oloo');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdOutputOptions = require('../../../src/Compilers/LgdOutputOptions');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');
const { maskCode } = require('../../../src/Compilers/LgdInfer');

function compile(source, options = { javascriptObjectModel: 'class' }, externals = new Map())
{
    return LgdCompiler.create().compileToJs(source, externals, options);
}

function execute(source)
{
    const result = compile(source);
    expect(result.errors).toEqual([]);
    const context = { module: { exports: null } };
    virtualMachine.runInNewContext(result.code, context);
    return context.module.exports;
}

/** @description Checks generated factory signatures against the real TypeScript standard library. */
function typeDiagnostics(code)
{
    const fileName = '/lgd-native-classes.js';
    const options = { allowJs: true, checkJs: true, target: typescript.ScriptTarget.ES2020, noEmit: true };
    const host = typescript.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile;
    host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
    {
        if(file === fileName)
        {
            return typescript.createSourceFile(file, code, languageVersion, true, typescript.ScriptKind.JS);
        }

        return originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
    };

    const program = typescript.createProgram([fileName], options, host);
    return program.getSemanticDiagnostics().filter(diagnostic => diagnostic.file?.fileName === fileName);
}

describe('LGD native JavaScript class output.', () =>
{
    test('Keeps OLOO as the default and rejects unimplemented language and object-model options.', () =>
    {
        expect(LgdOutputOptions.resolve()).toEqual({ options: { outputTarget: 'javascript', javascriptObjectModel: 'oloo' }, errors: [] });
        expect(LgdOutputOptions.resolve({ outputTarget: 'javascript', javascriptObjectModel: 'class' }).errors).toEqual([]);
        for(const outputTarget of [ 'csharp', 'cpp', 'typescript', 'JavaScript' ])
        {
            const result = compile('Number value = 1;', { outputTarget: outputTarget });
            expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.output.target' })]));
            expect(result.code).not.toContain('using System');
        }

        expect(compile('Number value = 1;', { javascriptObjectModel: 'prototype' }).errors)
            .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.output.objectModel' })]));
        expect(LgdOutputOptions.resolve(null).errors[0].code).toBe('lgd.output.options');
        const source = 'class Counter { Counter() { this.value = 1; } }';
        expect(compile(source, {}).code).toContain('const Counter = {');
        expect(compile(source).code).toContain('class Counter');
    });

    test('Creates native instances with independent fields, descriptors, defaults, rest and ignored constructor returns.', () =>
    {
        const Counter = execute([
            'class Counter {',
            '    Counter(Number value = 1, ...String labels) {',
            '        this.value = value; this.items = []; this.labels = labels;',
            '        this.argumentCount = arguments.length; this.read = () => this.value;',
            '        return { discarded: true };',
            '    }',
            '    increment() { this.value++; }',
            '    get label() { return String(this.value); }',
            '    set label(String value) { this.value = Number(value); }',
            '}',
            'module.exports = Counter;'
        ].join('\n'));
        const initialValue = 4;
        const expectedValue = 5;
        const expectedArgumentCount = 3;
        const first = Counter.create();
        const second = Counter.create(initialValue, 'a', 'b');
        first.items.push('first');
        second.increment();
        expect(first.items).toEqual(['first']);
        expect(second.items).toEqual([]);
        expect(second.labels).toEqual([ 'a', 'b' ]);
        expect(first.argumentCount).toBe(0);
        expect(second.argumentCount).toBe(expectedArgumentCount);
        expect(second.read()).toBe(expectedValue);
        expect(first).toBeInstanceOf(Counter);
        expect(Object.getPrototypeOf(first)).toBe(Counter.prototype);
        expect(first.discarded).toBeUndefined();
        expect(Counter.value).toBeUndefined();
        const descriptor = Object.getOwnPropertyDescriptor(Counter.prototype, 'label');
        expect(descriptor.get).toEqual(expect.any(Function));
        expect(descriptor.set).toEqual(expect.any(Function));
        first.label = '2';
        expect(first.label).toBe('2');
    });

    test('Discards parenthesized constructor returns with their side effects and leaves nested returns intact.', () =>
    {
        const source = [
            'class Example {',
            '    Example() {',
            '        this.trace = [];',
            '        this.nested = function() { return { retained: true }; };',
            '        try { return (this.trace.push("return"), { discarded: true }); }',
            '        finally { this.trace.push("finally"); }',
            '    }',
            '    *labels(String label) { yield label; }',
            '}',
            'class NoSemicolon {',
            '    NoSemicolon() {',
            '        this.value = 2;',
            '        return ({ discarded: true }) // Preserve the end-of-line comment.',
            '    }',
            '}',
            'module.exports = { Example, NoSemicolon };'
        ].join('\n');
        const exported = execute(source);
        const instance = exported.Example.create();
        expect(instance.trace).toEqual([ 'return', 'finally' ]);
        expect(instance.nested()).toEqual({ retained: true });
        expect([...instance.labels('ok')]).toEqual(['ok']);
        expect(instance.discarded).toBeUndefined();
        expect(exported.NoSemicolon.create().value).toBe(2);
        expect(exported.NoSemicolon.create().discarded).toBeUndefined();
        const result = compile(source);
        const map = LgdSourceMap.create(result.mappings);
        const expressionOffset = source.indexOf('this.trace.push("return")');
        expect(map.toSource(map.toOutput(expressionOffset))).toBe(expressionOffset);
        expect(result.code).toContain('// Preserve the end-of-line comment.');
    });

    test('Reports native-only strict-mode syntax failures at original source positions.', () =>
    {
        const source = 'class Example { Example() { with ({ value: 2 }) { this.value = value; } } }';
        expect(compile(source, {}).errors).toEqual([]);
        const result = compile(source);
        expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.output.nativeSyntax', offset: source.indexOf('with') })]));
    });

    test('Preserves typed factory call signatures as well as constructor and method documentation.', () =>
    {
        const source = [
            'class Counter {',
            '    Counter(Number value = 1, ...String labels) { this.value = value; this.labels = labels; }',
            '    Number read() { return this.value; }',
            '}',
            'const valid = Counter.create(2, "a");',
            'const defaulted = Counter.create();'
        ].join('\n');
        const result = compile(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('@param {number} value');
        expect(result.code).toContain('@param {ConstructorParameters<typeof Counter>} args');
        expect(result.code).toContain('@returns {Counter}');
        expect(typeDiagnostics(result.code)).toEqual([]);
        const invalid = typeDiagnostics(`${result.code}\nCounter.create("invalid");\nCounter.create(1, 2);`);
        expect(invalid).toHaveLength(2);
        expect(invalid.every(diagnostic => typescript.flattenDiagnosticMessageText(diagnostic.messageText, '\n').includes('not assignable'))).toBe(true);
    });

    test('Uses native superclass dispatch and preserves multilevel lexical base calls without OLOO helpers.', async () =>
    {
        const exported = execute([
            'class Base {',
            '    Base(Number value = 1) { this.value = value; this.visited = []; this.initial = this.describe(); }',
            '    virtual String describe() { return "base"; }',
            '    virtual async String visit(String label) { this.visited.push("base"); return label; }',
            '}',
            'class Middle : Base {',
            '    Middle(Number value = 2) : base(value) { this.middle = true; }',
            '    override String describe() { return "middle"; }',
            '    override async String visit(String label) {',
            '        this.visited.push("middle"); return await Promise.resolve().then(() => base.visit(label));',
            '    }',
            '}',
            'class Leaf : Middle {',
            '    override String describe() { return "leaf"; }',
            '    override async String visit(String label) { this.visited.push("leaf"); return await base.visit(label); }',
            '}',
            'module.exports = { Base, Middle, Leaf };'
        ].join('\n'));
        const instance = exported.Leaf.create();
        expect(instance.initial).toBe('leaf');
        expect(instance.value).toBe(2);
        expect(instance.middle).toBe(true);
        expect(instance).toBeInstanceOf(exported.Base);
        expect(instance).toBeInstanceOf(exported.Middle);
        expect(await instance.visit('ok')).toBe('ok');
        expect(instance.visited).toEqual([ 'leaf', 'middle', 'base' ]);
        expect(exported.Leaf.create().visited).toEqual([]);
    });

    test('Uses zero-argument base construction for an implicit derived constructor.', () =>
    {
        const Derived = execute([
            'class Base { Base(Number value = 2) { this.value = value; } }',
            'class Derived : Base {}',
            'module.exports = Derived;'
        ].join('\n'));
        const ignoredArgument = 8;
        expect(Derived.create(ignoredArgument).value).toBe(2);
    });

    test('Erases interfaces and abstract contracts while keeping concrete native members.', () =>
    {
        const result = compile([
            'interface ICounter { Number read(); String label { get; set; } }',
            'abstract class AbstractCounter : ICounter {',
            '    AbstractCounter() { this.value = 2; }',
            '    /** Contract documentation must be erased. */',
            '    abstract Number read();',
            '    abstract String label { get; set; }',
            '}',
            'class Counter : AbstractCounter {',
            '    override Number read() { return this.value; }',
            '    override get label() { return String(this.value); }',
            '    override set label(String value) { this.value = Number(value); }',
            '}',
            'module.exports = Counter;'
        ].join('\n'));
        expect(result.errors).toEqual([]);
        expect(maskCode(result.code, true)).not.toContain('ICounter');
        expect(result.code).not.toContain('extends ICounter');
        expect(result.code).not.toContain('abstract');
        expect(result.code).not.toContain('Contract documentation');
        const context = { module: { exports: null } };
        virtualMachine.runInNewContext(result.code, context);
        const instance = context.module.exports.create();
        expect(instance.read()).toBe(2);
        expect(instance.label).toBe('2');
    });

    test('Preserves nested typed locals, native nested classes and exact CRLF source-name mappings.', () =>
    {
        const source = [
            'class Base { Base(String title) { this.title = title; } }',
            'class Child : Base {',
            '    Child(String title) : base(title) { this.saved = title; }',
            '    Number read(Number count) {',
            '        Number total = count + 1;',
            '        class Nested { Nested() { this.value = total; } }',
            '        return Nested.create().value;',
            '    }',
            '}',
            'module.exports = Child;'
        ].join('\r\n');
        const result = compile(source);
        expect(result.errors).toEqual([]);
        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
        expect(result.code).toContain('class Nested');
        const map = LgdSourceMap.create(result.mappings);
        for(const marker of [ 'Child :', 'Base {\r', 'title) :', 'title) { this.saved', 'this.saved', 'read(', 'count)', 'total =', 'Nested.create' ])
        {
            const offset = source.indexOf(marker);
            expect(offset).toBeGreaterThanOrEqual(0);
            expect(map.toSource(map.toOutput(offset))).toBe(offset);
        }

        const constructorOffset = source.indexOf('Child(String');
        expect(result.code.slice(map.toOutput(constructorOffset), map.toOutput(constructorOffset) + 'constructor'.length)).toBe('constructor');
        const context = { module: { exports: null } };
        virtualMachine.runInNewContext(result.code, context);
        const expectedResult = 4;
        expect(context.module.exports.create('test').read(expectedResult - 1)).toBe(expectedResult);
    });

    test('Rejects known local and external OLOO bases and dispatch without changing default OLOO output.', () =>
    {
        const source = [
            'readonly Object Base = { create() { return Object.create(Base); }, /** @virtual */ read() { return 1; } };',
            'class Derived : Base { override read() { return Oloo.base(this, "read"); } }',
            'module.exports = Derived;'
        ].join('\n');
        const native = compile(source);
        expect(native.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'lgd.output.objectBase' }),
            expect.objectContaining({ code: 'lgd.output.olooDispatch' })
        ]));
        const defaultResult = compile(source, {});
        expect(defaultResult.errors).toEqual([]);
        const context = { Oloo: Oloo, module: { exports: null } };
        virtualMachine.runInNewContext(defaultResult.code, context);
        expect(context.module.exports.create().read()).toBe(1);
        const externals = new Map([[ 'base', { exportName: 'Base', keyword: 'Object', constructorParams: [] } ]]);
        const imported = compile('readonly Object Base = require("base");\nclass Derived : Base {}', undefined, externals);
        expect(imported.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.output.objectBase' })]));
        const literal = compile('class Example { read() { return "Oloo.base(this, read)"; } }');
        expect(literal.errors).toEqual([]);
        const computed = compile('class Example { read() { return Oloo["base"](this, "read"); } }');
        expect(computed.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.output.olooDispatch' })]));
    });
});
