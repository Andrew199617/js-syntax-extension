const virtualMachine = require('vm');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

describe('LGD expression inference regressions.', () =>
{
    test.each([
        '(Number value) => value > 0',
        '() => "a" + "b"',
        '() => true ? "a" : "b"',
        'async value => value < 2'
    ])('Keeps a concise arrow initializer as Function: %s.', initializer =>
    {
        const result = LgdCompiler.create().compileToJs(`Function work = ${initializer};`);
        expect(result.errors).toEqual([]);
        expect(virtualMachine.runInNewContext(`${result.code}\ntypeof work;`)).toBe('function');
    });

    test.each([ '-1n', '~1n', '1n | 2n', '1n & 2n', '1n ^ 2n', '1n << 2n', '4n >> 1n', '1n + 2n', '3n * 2n' ])('Preserves BigInt operators: %s.', initializer =>
    {
        const result = LgdCompiler.create().compileToJs(`BigInt total = ${initializer};`);
        expect(result.errors).toEqual([]);
        expect(virtualMachine.runInNewContext(`${result.code}\ntypeof total;`)).toBe('bigint');
    });

    test('Preserves the operand type of prefix and postfix updates.', () =>
    {
        const source = 'BigInt value = 1n;\nBigInt previous = value++;\nBigInt next = ++value;';
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        const first = 1n;
        const next = 3n;
        expect(virtualMachine.runInNewContext(`${result.code}\n[previous, next];`)).toEqual([ first, next ]);
    });

    test('Retains errors for known mismatches and stays permissive for unknown numeric operands.', () =>
    {
        expect(LgdCompiler.create().compileToJs('Number total = 1n | 2n;').errors[0].message).toBe('Cannot assign BigInt to Number.');
        expect(LgdCompiler.create().compileToJs('String total = 1 << 2;').errors[0].message).toBe('Cannot assign Number to String.');
        expect(LgdCompiler.create().compileToJs('BigInt total = -unknown;').errors).toEqual([]);
        expect(LgdCompiler.create().compileToJs('Object mixed = (flag) ? "text" : () => 0;').errors).toEqual([]);
    });

    test('Treats constructor return types as unknown rather than rejecting Array and Function instances.', () =>
    {
        const source = 'Array values = new Array(3);\nFunction work = new Function("return 1");';
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        const expectedLength = 3;
        expect(virtualMachine.runInNewContext(`${result.code}\n[values.length, work()];`)).toEqual([ expectedLength, 1 ]);
    });
});
