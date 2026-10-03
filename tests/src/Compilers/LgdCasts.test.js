const virtualMachine = require('vm');
const { Oloo } = require('@mavega/oloo');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');

/** @description Executes a valid fixture in either supported JavaScript object model. */
function execute(source, objectModel = 'oloo', supplied = {})
{
    const compiled = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
    expect(compiled.errors).toEqual([]);
    const context = { module: { exports: null }, Oloo: Oloo, ...supplied };
    virtualMachine.runInNewContext(compiled.code, context);
    return { value: context.module.exports, compiled: compiled };
}

beforeEach(() => Oloo.objectMap.clear());

describe('C-style casts.', () =>
{
    const fractionalValue = 12.5;
    const integerValue = 12;
    test.each([
        [ 'numeric string', '"12.5"', fractionalValue ],
        [ 'empty string', '""', 0 ],
        [ 'whitespace', '"   "', 0 ],
        [ 'null', 'null', 0 ],
        [ 'undefined', 'undefined', Number.NaN ],
        [ 'invalid string', '"twelve"', Number.NaN ],
        [ 'boolean', 'true', 1 ],
        [ 'bigint', '12n', integerValue ]
    ])('uses standard Number conversion for %s', (description, expression, expected) =>
    {
        const { value } = execute(`const Number converted = (Number)${expression};\nmodule.exports = converted;`);
        expect(value).toBe(expected);
    });

    test('preserves nullable null and evaluates getters, calls, and object coercion once', () =>
    {
        const source = [
            'let reads = 0; let coercions = 0;',
            'const holder = { get text() { reads++; return "8"; } };',
            'function missing() { reads++; return null; }',
            'const custom = { valueOf() { coercions++; return 4; } };',
            'const Number first = (Number)holder.text;',
            'const Number? second = (Number?)missing();',
            'const Number third = (Number)custom;',
            'const Number? fourth = (Number?)holder.text;',
            'module.exports = [first, second, third, fourth, reads, coercions];'
        ].join('\n');
        const convertedText = 8;
        const coercedObject = 4;
        const readCount = 3;
        const expected = [ convertedText, null, coercedObject, convertedText, readCount, 1 ];
        expect(execute(source).value).toEqual(expected);
    });

    test('accepts array, regex, and template operands without treating literal contents as nested casts', () =>
    {
        const source = [
            'const values = (Array)[1, 2];',
            String.raw`const expression = (Object)/\(Number\)value/;`,
            'const text = (String)`(Number)value`;',
            'module.exports = [values, expression.source, text];'
        ].join('\n');
        const { value, compiled } = execute(source);
        const expectedCastCount = 3;
        expect(compiled.casts).toHaveLength(expectedCastCount);
        expect(value).toEqual([ [ 1, 2 ], String.raw`\(Number\)value`, '(Number)value' ]);
    });

    test('preserves native conversion errors rather than inventing validation or coercion rules', () =>
    {
        expect(() => execute('module.exports = (Number)Symbol("key");')).toThrow(/Symbol/);
    });

    test('respects unary precedence, nested casts, grouped operands, conditional branches, and exponentiation', () =>
    {
        const source = [
            'const first = (Number)"2" + 1;',
            'const second = (Number)("2" + "3");',
            'const third = (Number)(String)"4";',
            'const fourth = false ? (Number)"5" : (Number)"6";',
            'const fifth = (Number)"3" ** 2;',
            'function read() { return (Number)-"7"; }',
            'module.exports = [first, second, third, fourth, fifth, read()];'
        ].join('\n');
        const expectedValues = { addition: 3, grouped: 23, nested: 4, conditional: 6, power: 9, negative: -7 };
        const expected = Object.values(expectedValues);
        expect(execute(source).value).toEqual(expected);
    });

    test.each([ 'oloo', 'class' ])('retains object identity, inheritance, null, and typed member access in %s output', objectModel =>
    {
        const source = [
            'class Base { virtual Number read() { return 3; } }',
            'class Derived : Base { override Number read() { return 7; } }',
            'Derived original = Derived.create();',
            'Base parent = (Base)original;',
            'Derived child = (Derived)parent;',
            'Object uncertain = original;',
            'const other = (Derived)uncertain;',
            'const nothing = (Derived)null;',
            'Number result = ((Derived)uncertain).read();',
            'module.exports = { original, parent, child, other, nothing, result, prototype: Object.getPrototypeOf(original) };'
        ].join('\n');
        const { value, compiled } = execute(source, objectModel);
        expect(value.parent).toBe(value.original);
        expect(value.child).toBe(value.original);
        expect(value.other).toBe(value.original);
        expect(value.nothing).toBeNull();
        const overriddenResult = 7;
        expect(value.result).toBe(overriddenResult);
        expect(Object.getPrototypeOf(value.child)).toBe(value.prototype);
        expect(compiled.code).not.toContain('instanceof');
        expect(compiled.code).not.toContain('isPrototypeOf');
    });

    test('checks primitive and known unrelated nominal incompatibilities at the target token', () =>
    {
        const source = [
            'class First {}',
            'class Second {}',
            'First first = First.create();',
            'const second = (Second)first;',
            'const boolean = (Boolean)"false";',
            'const text = (String)1;',
            'const large = (BigInt)1;',
            'const missing = (Missing)first;'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source);
        const errors = result.errors.filter(error => error.code?.startsWith('lgd.cast.'));
        expect(errors.map(error => source.slice(error.offset, error.endOffset))).toEqual([ 'Missing', 'Second', 'Boolean', 'String', 'BigInt' ]);
        const incompatibleCount = 4;
        expect(errors.filter(error => error.code === 'lgd.cast.incompatibleType')).toHaveLength(incompatibleCount);
    });

    test('checks conditional and sequence class operands while respecting explicit widening assertions', () =>
    {
        const declarations = 'class First {}\nclass Second {}\nFirst original = First.create();\n';
        for(const operand of [ '(true ? original : original)', '(0, original)' ])
        {
            const result = LgdCompiler.create().compileToJs(`${declarations}const value = (Second)${operand};`);
            expect(result.errors.map(error => error.code)).toEqual(['lgd.cast.incompatibleType']);
        }

        const widened = LgdCompiler.create().compileToJs(`${declarations}const value = (Second)(Object)original;`);
        expect(widened.errors).toEqual([]);
    });

    test.each([ 'oloo', 'class' ])('preserves nominal Number shadows without numeric conversion in %s output', objectModel =>
    {
        const source = 'class Number {} const original = Number.create(); const value = (Number)original; module.exports = value === original;';
        const { value, compiled } = execute(source, objectModel);
        expect(value).toBe(true);
        expect(compiled.code).not.toContain('globalThis.Number(');
        expect(compiled.code).toContain('@type {Number}');
    });

    test.each([ 'oloo', 'class' ])('retains imported nullable class identity and member checking in %s output', objectModel =>
    {
        const descriptor = { exportName: 'Item', keyword: 'Object', kind: 'class', sourcePath: '/types/Item.lgd',
            constructorParams: [], methodsKnown: true, contractsKnown: true, methodSignatures: [], contractSignatures: [],
            members: [{ name: 'value', kind: 'field', static: false, typeName: 'Number', propertyTypeName: 'Number', declaringType: 'Item' }] };
        const externals = new Map([[ './Item.js', descriptor ]]);
        const source = 'const Imported = require("./Item.js"); Object raw = {}; const item = (Imported?)raw; item.value = "wrong";';
        const compiled = LgdCompiler.create().compileToJs(source, externals, { javascriptObjectModel: objectModel });
        expect(compiled.errors.map(error => error.code)).toEqual(['lgd.assignment.typeMismatch']);
        expect(compiled.code).toContain('@type {Imported | null}');
        expect(compiled.code).not.toContain('instanceof');
        expect(compiled.casts[0].target.kind).toBe('class');
    });

    test('retains interface and qualified type assertions without runtime values for the type', () =>
    {
        const source = [
            'interface Readable { Number read(); }',
            'const namespace = {};',
            'const original = { read() { return 2; } };',
            'const contract = (Readable)original;',
            'const external = (namespace.Widget?)original;',
            'module.exports = [contract === original, external === original];'
        ].join('\n');
        const { value, compiled } = execute(source);
        expect(value).toEqual([ true, true ]);
        expect(compiled.code).not.toContain('namespace.Widget(');
        expect(compiled.code).not.toContain('new Readable');
    });

    test('keeps grouping, grouped calls, ordinary call arguments, arrow parameters, and lexical shadows unchanged', () =>
    {
        const source = [
            'const Number = value => value + 1;',
            'const Capital = value => value * 2;',
            'const original = 3;',
            'const grouped = (original) + 1;',
            'const called = (Capital)(4);',
            'const shadowed = (Number)(4);',
            'const arrow = (Number) => Number;',
            'const ordinary = Capital(Number(1));',
            'if (original) Capital(original);',
            'module.exports = [grouped, called, shadowed, arrow(6), ordinary];'
        ].join('\n');
        const { value, compiled } = execute(source);
        const expectedValues = { grouped: 4, called: 8, shadowed: 5, arrow: 6, ordinary: 4 };
        const expected = Object.values(expectedValues);
        expect(value).toEqual(expected);
        expect(compiled.casts).toEqual([]);
    });

    test('ignores cast-looking strings, regexes, comments, and template text while handling interpolation', () =>
    {
        const source = [
            'const text = "(Number)value";',
            String.raw`const pattern = /\(Number\)value/;`,
            '// (Number)value',
            '/* (Number)value */',
            `const template = \`literal (Number)value \${(Number)"3"}\`;`,
            'module.exports = [text, pattern.source, template];'
        ].join('\n');
        const { value, compiled } = execute(source);
        expect(value).toEqual([ '(Number)value', String.raw`\(Number\)value`, 'literal (Number)value 3' ]);
        expect(compiled.casts).toHaveLength(1);
    });

    test('preserves source comments, CRLF, and exact operand mappings through member and call chains', () =>
    {
        const source = 'const holder = { read() { return { text: "3" }; } };\r\nconst Number value = ( /* target */ Number /* suffix */ )holder.read().text;\r\n';
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('/* target */');
        expect(result.code).toContain('/* suffix */');
        const sourceMap = LgdSourceMap.create(result.mappings);
        for(const text of [ 'holder.read()', '.text' ])
        {
            const start = source.lastIndexOf(text);
            expect(result.code.slice(sourceMap.toOutput(start), sourceMap.toOutput(start) + text.length)).toBe(text);
        }
    });

    test('keeps cast type evidence in returns and diagnoses member access through asserted classes', () =>
    {
        const source = [
            'class Item { private Number value = 1; }',
            'Object raw = {};',
            'class Reader { Number read(String input) { return (Number)input; } }',
            'const output = ((Item)raw).value;'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors.map(error => error.code)).toEqual(['lgd.access.inaccessible']);
        expect(result.errors[0].message).toContain("'value' is private");
    });

    test('does not blame a valid earlier cast for unrelated unfinished syntax', () =>
    {
        const source = 'const amount = (Number)"1";\nconst broken = ;';
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.code).toContain('globalThis.Number("1")');
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].offset).toBe(source.lastIndexOf(';'));
        expect(result.casts[0].typeName).toBe('Number');
    });

    test('keeps source casts intact in the experimental C# emitter and emits TypeScript assertions', () =>
    {
        const compiler = LgdCompiler.create();
        const source = 'String text = (String)"value";';
        expect(compiler.compileToCSharp(source).code).toContain('(String)"value"');
        expect(compiler.compileToTs(source).code).toContain('as unknown as string');
    });
});
