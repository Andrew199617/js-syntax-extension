const virtualMachine = require('vm');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

/** @description Executes cast syntax while asserting that compilation produced no diagnostics. */
function execute(source)
{
    const compiled = LgdCompiler.create().compileToJs(source);
    expect(compiled.errors).toEqual([]);
    const context = { module: { exports: null } };
    virtualMachine.runInNewContext(compiled.code, context);
    return { value: context.module.exports, compiled: compiled };
}

describe('Cast statement and ordinary-expression boundaries.', () =>
{
    test('recognizes casts in unbraced statement bodies and after completed blocks', () =>
    {
        const source = [
            'let reads = 0;',
            'function read() { reads++; return "1"; }',
            'if (true) (Number)read();',
            'while (reads < 2) (Number)read();',
            'for (; reads < 3;) (Number)read();',
            'if (false) {} else (Number)read();',
            'do (Number)read(); while (reads < 5);',
            'if (true) {}',
            '(Number)read();',
            'function invoke() { if (true) (Number)read(); }',
            'invoke();',
            'module.exports = reads;'
        ].join('\n');
        const expectedReads = 7;
        const { value, compiled } = execute(source);
        expect(value).toBe(expectedReads);
        expect(compiled.casts).toHaveLength(expectedReads);
    });

    test('preserves qualified grouped calls, arithmetic, element access, and keyword-named methods', () =>
    {
        const source = [
            'const helpers = { Double: value => value * 2, Value: 10, Values: [8, 9], return() { return 2; } };',
            'module.exports = [(helpers.Double)(4), (helpers.Value) + 4, (helpers.Values)[1], helpers . /* member */ return(Number) + 1];'
        ].join('\n');
        const expectedValues = { doubled: 8, sum: 14, element: 9, returned: 3 };
        const { value, compiled } = execute(source);
        expect(value).toEqual(Object.values(expectedValues));
        expect(compiled.casts).toEqual([]);
    });

    test('preserves call continuations after parentheses and function expressions across newlines', () =>
    {
        const source = [
            'function make() { return value => input => value(input) + 1; }',
            'const first = make()(Number)(4);',
            'const second = function(value) { return input => value(input) + 2; }',
            '(Number)(4);',
            'module.exports = [first, second];'
        ].join('\n');
        const expectedValues = { first: 5, second: 6 };
        const { value, compiled } = execute(source);
        expect(value).toEqual(Object.values(expectedValues));
        expect(compiled.casts).toEqual([]);
    });
});
