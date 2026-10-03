const virtualMachine = require('vm');
const typescript = require('typescript');
const { Oloo } = require('@mavega/oloo');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');

function compile(source, externals)
{
    return LgdCompiler.create().compileToJs(source, externals);
}

function execute(source)
{
    const result = compile(source);
    expect(result.errors).toEqual([]);
    const context = { module: { exports: null }, Oloo: Oloo };
    virtualMachine.runInNewContext(result.code, context);
    return context.module.exports;
}

beforeEach(() => Oloo.objectMap.clear());

describe('Lexical LGD base method calls.', () =>
{
    test('Preserves three-level async dispatch, arguments, state and repeated calls after await.', async () =>
    {
        const Leaf = execute([
            'class Base {',
            '    Base() { this.events = []; }',
            '    virtual async Number run(Number amount) {',
            '        await Promise.resolve(); this.events.push("base:" + amount); return amount + 1;',
            '    }',
            '}',
            'class Middle : Base {',
            '    override async Number run(Number amount) {',
            '        await Promise.resolve(); this.events.push("middle:" + amount);',
            '        return await base.run(amount) + await base.run(amount + 1);',
            '    }',
            '}',
            'class Leaf : Middle {',
            '    override async Number run(Number amount) {',
            '        await Promise.resolve(); this.events.push("leaf:" + amount); return await base.run(amount + 1);',
            '    }',
            '}',
            'module.exports = Leaf;'
        ].join('\n'));
        const first = Leaf.create();
        const second = Leaf.create();
        const expectedResult = 7;
        expect(await first.run(1)).toBe(expectedResult);
        expect(first.events).toEqual([ 'leaf:1', 'middle:2', 'base:2', 'base:3' ]);
        expect(second.events).toEqual([]);
        expect(await second.run(1)).toBe(expectedResult);
        expect(Oloo.objectMap.size).toBe(0);
    });

    test('Uses the defining method owner for an inherited override despite local name shadowing.', () =>
    {
        const Leaf = execute([
            'class Base { virtual describe() { return this; } }',
            'class Middle : Base {',
            '    override describe() {',
            '        const Middle = null;',
            '        const Object = null;',
            '        return base.describe();',
            '    }',
            '}',
            'class Leaf : Middle {}',
            'module.exports = Leaf;'
        ].join('\n'));
        const instance = Leaf.create();
        expect(instance.describe()).toBe(instance);
        expect(Oloo.objectMap.size).toBe(0);
    });

    test('Does not retain stale dispatch state after synchronous exceptions or rejected promises.', async () =>
    {
        const Derived = execute([
            'class Base {',
            '    Base() { this.fail = true; }',
            '    recover() { this.fail = false; }',
            '    virtual run() { if(this.fail) throw new Error("base failure"); return this; }',
            '    virtual async runAsync() { await Promise.resolve(); if(this.fail) throw new Error("async failure"); return this; }',
            '}',
            'class Derived : Base {',
            '    override run() { return base.run(); }',
            '    override async runAsync() { return await base.runAsync(); }',
            '}',
            'module.exports = Derived;'
        ].join('\n'));
        const instance = Derived.create();
        expect(() => instance.run()).toThrow('base failure');
        await expect(instance.runAsync()).rejects.toThrow('async failure');
        instance.recover();
        expect(instance.run()).toBe(instance);
        expect(await instance.runAsync()).toBe(instance);
        expect(Oloo.objectMap.size).toBe(0);
    });

    test('Preserves lexical this in nested arrow callbacks, default arguments, spreads and nested base calls.', async () =>
    {
        const Derived = execute([
            'class Base {',
            '    virtual collect(String prefix = "default", ...Number items) { return { receiver: this, prefix, items }; }',
            '    value() { return 2; }',
            '}',
            'class Derived : Base {',
            '    override collect(String prefix = "default", ...Number items) {',
            '        const callback = async () => { await Promise.resolve(); return base.collect(prefix, base.value(), ...items); };',
            '        return callback();',
            '    }',
            '}',
            'module.exports = Derived;'
        ].join('\n'));
        const instance = Derived.create();
        const result = await instance.collect();
        expect(result.receiver).toBe(instance);
        expect(result.prefix).toBe('default');
        expect(result.items).toEqual([2]);
        expect((await instance.collect('label', 1)).items).toEqual([ 2, 1 ]);
    });

    test('Keeps one allocated receiver across LGD base construction and instance-bound constructor method calls.', () =>
    {
        const source = [
            'class Base {',
            '    Base(String name) { this.name = name; this.calls = []; }',
            '    record() { this.calls.push(this.name); }',
            '}',
            'class Derived : Base {',
            '    Derived(String name) : base(name) { base.record(); }',
            '}',
            'module.exports = Derived;'
        ].join('\n');
        expect(compile(source).code).toContain('Oloo.assign(Object.create(Base), Derived)');
        const instance = execute(source).create('name');
        expect(instance.calls).toEqual(['name']);
    });

    test('Keeps method/argument mappings exact with CRLF, comments and typed local callbacks.', () =>
    {
        const source = [
            'class Base { virtual String describe(String label) { return label; } }',
            'class Derived : Base {',
            '    override String describe(String label) {',
            '        const Function callback = () => base /* receiver */ . describe /* method */ (label);',
            '        return callback();',
            '    }',
            '}',
            'module.exports = Derived;'
        ].join('\r\n');
        const result = compile(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('/* receiver */');
        expect(result.code).toContain('/* method */');
        expect(result.code).toContain('const callback =');
        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
        const map = LgdSourceMap.create(result.mappings);
        const methodStart = source.indexOf('describe /* method */');
        const argumentStart = source.indexOf('label);');
        for(const [ start, name ] of [ [ methodStart, 'describe' ], [ argumentStart, 'label' ] ])
        {
            expect(result.code.slice(map.toOutput(start), map.toOutput(start + name.length))).toBe(name);
            expect(map.toSource(map.toOutput(start))).toBe(start);
            expect(map.toSource(map.toOutput(start + name.length))).toBe(start + name.length);
        }

        expect(execute(source).create().describe('value')).toBe('value');
        const typed = LgdCompiler.create().compileToTs(source);
        expect(typed.errors).toEqual([]);
        expect(typed.code).not.toContain('base /* receiver */');
        expect(typescript.createSourceFile('example.ts', typed.code, typescript.ScriptTarget.Latest).parseDiagnostics).toEqual([]);
    });

    test.each([
        [ 'computed', 'return base["run"]();', 'computed' ],
        [ 'optional receiver', 'return base?.run();', 'optional' ],
        [ 'optional call', 'return base.run?.();', 'direct' ],
        [ 'detached method', 'return base.run;', 'direct' ],
        [ 'getter call', 'return base.label();', 'property or accessor' ],
        [ 'getter read', 'return base.label;', 'getters' ],
        [ 'missing method', 'return base.missing();', 'No inherited method' ],
        [ 'dynamic callback', 'return function() { return base.run(); };', 'arrow function' ],
        [ 'shadowed base', 'const base = {}; return base.run();', 'shadows base' ]
    ])('Diagnoses unsupported %s without guessing dispatch semantics.', (label, body, message) =>
    {
        const source = `class Base { virtual run() {} get label() { return "value"; } }\nclass Derived : Base { override run() { ${body} } }`;
        const result = compile(source);
        expect(result.errors.some(error => error.message.includes(message))).toBe(true);
        const error = result.errors.find(candidate => candidate.message.includes(message));
        expect(source.slice(error.offset, error.endOffset)).toContain('base');
    });

    test('Rejects base calls without a base and in accessors or parameter defaults.', () =>
    {
        const sources = [
            'class Example { run() { return base.run(); } }',
            'class Base { run() {} }\nclass Derived : Base { get value() { return base.run(); } }',
            'class Base { run() {} }\nclass Derived : Base { other(value = base.run()) {} }'
        ];
        for(const source of sources)
        {
            expect(compile(source).errors.length).toBeGreaterThan(0);
        }
    });

    test('Keeps TypeScript lowering aligned after nested typed arrow parameters change length.', () =>
    {
        const source = [
            'class Base { virtual Number run(Number amount) { return amount; } }',
            'class Derived : Base {',
            '    override Number run(Number amount) {',
            '        const Function callback = (Number count) => base.run(count);',
            '        return callback(amount);',
            '    }',
            '}',
            'module.exports = Derived;'
        ].join('\n');
        const result = LgdCompiler.create().compileToTs(source);
        expect(result.errors).toEqual([]);
        expect(typescript.createSourceFile('example.ts', result.code, typescript.ScriptTarget.Latest).parseDiagnostics).toEqual([]);
        expect(result.code).toContain('(count: number) => _lgdBaseOwner');
        expect(result.code).toContain('.run.call(this, count)');
        expect(execute(source).create().run(2)).toBe(2);
    });

    test('Retains the inherited method signature in the JavaScript mirror for editor hovers.', () =>
    {
        const source = [
            'class Base {',
            '    virtual Number run(Number amount) { return amount; }',
            '}',
            'class Derived : Base {',
            '    override Number run(Number amount) { return base.run(amount); }',
            '}'
        ].join('\n');
        const result = compile(source);
        expect(result.errors).toEqual([]);
        const fileName = '/lgd-base-hover.js';
        const options = { allowJs: true, noLib: true, noEmit: true };
        const host = typescript.createCompilerHost(options);
        const readSource = host.getSourceFile;
        host.getSourceFile = (name, ...args) =>
        {
            if(name === fileName)
            {
                return typescript.createSourceFile(fileName, result.code, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS);
            }

            return readSource(name, ...args);
        };

        const program = typescript.createProgram([fileName], options, host);
        const checker = program.getTypeChecker();
        let signature = null;
        function visit(node)
        {
            if(typescript.isPropertyAccessExpression(node) && node.name.text === 'run' && typescript.isCallExpression(node.expression))
            {
                signature = checker.typeToString(checker.getTypeAtLocation(node));
            }

            typescript.forEachChild(node, visit);
        }

        visit(program.getSourceFile(fileName));
        expect(signature).toBe('(amount: number) => number');
    });

    test('Checks imported known accessor contracts and leaves unrelated JavaScript base values unchanged.', () =>
    {
        const source = 'const Object Parent = require("./parent");\nclass Derived : Parent { read() { return base.label(); } }';
        const externals = new Map([[ './parent', { exportName: 'Parent', keyword: 'Object', methodsKnown: true,
            methodSignatures: [{ name: 'label', kind: 'property' }] } ]]);
        expect(compile(source, externals).errors.some(error => error.message.includes('property or accessor'))).toBe(true);
        const ordinary = 'const base = { run() { return 1; } };\nbase.run();\nclass Example { run() { return "base.run()"; } }';
        const result = compile(ordinary);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('base.run();');
        expect(result.code).not.toContain('_lgdBaseOwner');
    });
});
