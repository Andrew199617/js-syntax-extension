const inferExpressionType = require('../../../src/Parsers/ExpressionType');
const FileParser = require('../../../src/Parsers/FileParser');

let previousLgd;
let parser;

beforeEach(() =>
{
    previousLgd = globalThis.lgd;
    globalThis.lgd = { configuration: { tabSize: 2 } };
    parser = FileParser.create();
});

afterEach(() =>
{
    globalThis.lgd = previousLgd;
});

test.each([
    [ '2 + 3', 'number' ],
    [ '2 + 3 * 4', 'number' ],
    [ '2 < 3', 'boolean' ],
    [ '2 === 3', 'boolean' ],
    [ "'value' + 2", 'string' ],
    [ 'true && false', 'boolean' ],
    [ 'null + 1', 'number' ],
    [ 'true + 1', 'number' ],
    [ 'false && 5', 'boolean' ],
    [ '(2 > 1) ? 1 : "x"', 'number' ],
    [ 'Math.PI * 2', 'number' ],
    [ '1n + 2n', 'bigint' ],
    [ '2 + 3;', 'number' ],
    [ 'unknown > 0', 'boolean' ],
    [ 'flag ? 1 : 2', 'number' ],
    [ 'flag ? 1 : false', 'any' ],
    [ 'price + tax', 'any' ],
    [ 'unknown + 1', 'any' ],
    [ 'null + unknown', 'any' ],
    [ 'invalid(', 'any' ]
])('infers the discussed example %s as %s through both entry points', async (expression, expected) =>
{
    expect(inferExpressionType(expression)).toBe(expected);
    expect(await parser.parseValue(expression)).toBe(expected);
});

test.each([
    [ 'true ? 1 : "x"', 'number' ],
    [ 'false ? 1 : "x"', 'string' ],
    [ '(null + 1 === 1) ? 1 : "x"', 'number' ],
    [ '(1n + 2n === 3n) ? "yes" : 0', 'string' ],
    [ '(Math.PI > 3) ? 1 : false', 'number' ],
    [ 'true && "value"', 'string' ],
    [ 'false || "value"', 'string' ],
    [ '0 && unknown', 'number' ],
    [ 'true || unknown', 'boolean' ],
    [ 'null ?? 5', 'number' ],
    [ 'undefined ?? "value"', 'string' ],
    [ 'false ?? "value"', 'boolean' ],
    [ '0n || "fallback"', 'string' ],
    [ '1n && true', 'boolean' ],
    [ '"" || 2', 'number' ],
    [ '"12" - 2', 'number' ],
    [ '"12" - "2"', 'number' ],
    [ '"" + null', 'string' ],
    [ 'undefined + 1', 'number' ],
    [ '1n', 'bigint' ],
    [ '-1n', 'bigint' ],
    [ '~1n', 'bigint' ],
    [ '+1n', 'any' ],
    [ '1n + 1', 'any' ],
    [ '1n / 0n', 'any' ],
    [ '(2 ** 3 === 8) ? true : 0', 'boolean' ],
    [ '(5 % 2 === 1) ? true : 0', 'boolean' ],
    [ '(1 << 2 === 4) ? true : 0', 'boolean' ],
    [ '(1n << 2n === 4n) ? true : 0', 'boolean' ],
    [ '(2n ** 3n === 8n) ? true : 0', 'boolean' ],
    [ '2n ** -1n', 'any' ],
    [ '1n << 999999999999n', 'bigint' ],
    [ '2n ** 999999999999n', 'bigint' ],
    [ '1 / 0', 'number' ],
    [ '1e3', 'number' ],
    [ '123invalid', 'any' ],
    [ '!unknown', 'boolean' ],
    [ 'typeof unknown', 'string' ],
    [ '-typeof unknown', 'number' ],
    [ `\`value: \${1 + 2}\``, 'string' ],
    [ `\`\${null + 1}\` === "1" ? true : 0`, 'boolean' ],
    [ 'true ? 1 : new Example()', 'number' ],
    [ 'false && [1, 2]', 'boolean' ],
    [ '"[literal]"', 'string' ],
    [ 'Math.E', 'number' ],
    [ 'Math.random()', 'any' ],
    [ 'Math.constructor', 'any' ],
    [ 'null', 'any' ],
    [ 'undefined', 'any' ],
    [ '"hello;"', 'string' ],
    [ '"hello";', 'string' ]
])('preserves primitive semantics for %s', async (expression, expected) =>
{
    expect(inferExpressionType(expression)).toBe(expected);
    expect(await parser.parseValue(expression)).toBe(expected);
});

test('bounds expression length and recursive inference', () =>
{
    const excessiveLength = 20000;
    const excessiveDepth = 200;
    expect(inferExpressionType(`${'1+'.repeat(excessiveLength)}1`)).toBe('any');
    expect(inferExpressionType(`${'1+'.repeat(excessiveDepth)}1`)).toBe('any');
});

test.each([
    'const A = A;',
    'const A = A ;',
    'const A = B; const B = A;',
    'const A = B; const B = C; const C = A;'
])('cyclic constants resolve to any: %s', async source =>
{
    parser.content = source;
    expect(await parser.parseValue('A')).toBe('any');
});

test('constant resolution keeps independent and repeated aliases usable', async () =>
{
    parser.content = 'const A = B; const B = C; const C = Math.PI * 2;';
    expect(await Promise.all([ parser.parseValue('A'), parser.parseValue('B'), parser.parseValue('A') ])).toEqual([ 'number', 'number', 'number' ]);
});

test.each([
    [ '// const A = "text";\nconst A = 1;', 'number' ],
    [ '/* const A = "text"; */\nconst A = 1;', 'number' ],
    [ 'const text = "const A = false;"; const A = 1;', 'number' ],
    [ 'const text = `const A = false;`; const A = 1;', 'number' ],
    [ 'const text = /const A = false;/; const A = 1;', 'number' ],
    [ 'const A = "text; with semicolon";', 'string' ],
    [ 'const A =\n  Math.PI * 2;', 'number' ],
    [ 'export const A = B, B = 1;', 'number' ],
    [ 'const markup = <span>const A = false;</span>; const A = 1;', 'number' ],
    [ 'function inner() { const A = "text"; } const A = 1;', 'number' ],
    [ '/* const A = 1; */', 'any' ],
    [ 'const text = "const A = 1;";', 'any' ],
    [ 'const A = 1; function unfinished(', 'any' ]
])('constant lookup uses source declarations rather than text: %s', async (source, expected) =>
{
    parser.content = source;
    expect(await parser.parseValue('A')).toBe(expected);
});

test('constant declarations refresh when the parser receives different source', async () =>
{
    const currentParser = parser;
    currentParser.content = 'const A = 1;';
    expect(await currentParser.parseValue('A')).toBe('number');
    currentParser.content = 'const A = "text";';
    expect(await currentParser.parseValue('A')).toBe('string');
});

test('propagates inferred values to array elements and function return declarations', async () =>
{
    expect(await parser.parseArray('null + 1, true + 1')).toBe('number[]');
    expect(await parser.parseArray('1n, 2n')).toBe('bigint[]');
    expect(await parser.functionParser.parseFunctionReturn('return (2 > 1) ? 1 : "x";')).toBe('number');
    expect(await parser.functionParser.parseFunctionReturn('return Math.PI * 2;')).toBe('number');
    expect(await parser.functionParser.parseFunctionReturn('return 1n + 2n;')).toBe('bigint');
});

test('parsing never executes assignments, calls, getters or coercion hooks', async () =>
{
    const callback = jest.fn(() => 1);
    const getter = jest.fn(() => 1);
    const coercion = jest.fn(() => 1);
    const probe = { callback: callback, valueOf: coercion, changed: false };
    Object.defineProperty(probe, 'property', { get: getter });
    globalThis.inferenceProbe = probe;
    try
    {
        const expressions = [
            'globalThis.inferenceProbe.changed = true',
            'globalThis.inferenceProbe.callback() + 1',
            'globalThis.inferenceProbe.property + 1',
            'globalThis.inferenceProbe + 1',
            '1; globalThis.inferenceProbe.changed = true',
            'Math.constructor.constructor("globalThis.inferenceProbe.changed = true")()'
        ];
        for(const expression of expressions)
        {
            expect(inferExpressionType(expression)).toBe('any');
            expect(await parser.parseValue(expression)).toBe('any');
        }

        expect(await parser.parseValue('false && globalThis.inferenceProbe.callback()')).toBe('boolean');
        expect(await parser.parseValue('true ? 1 : globalThis.inferenceProbe.callback()')).toBe('number');
        expect(probe.changed).toBe(false);
        expect(callback).not.toHaveBeenCalled();
        expect(getter).not.toHaveBeenCalled();
        expect(coercion).not.toHaveBeenCalled();
    }
    finally
    {
        delete globalThis.inferenceProbe;
    }
});
