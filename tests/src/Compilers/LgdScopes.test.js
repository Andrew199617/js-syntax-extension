const virtualMachine = require('vm');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

describe('LGD lexical binding resolution.', () =>
{
    test('Restores outer types and writability after a nested block closes.', () =>
    {
        const source = [
            'Number value = 0;',
            '{',
            '    const String value = "inner";',
            '}',
            'value = 3;',
            'Number next = value;'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        const expected = 3;
        expect(virtualMachine.runInNewContext(`${result.code}\nnext;`)).toBe(expected);
    });

    test('Excludes sibling function locals from later assignments and initializer inference.', () =>
    {
        const source = [
            'Number value = 0;',
            'Function inner = () => {',
            '    const String value = "inner";',
            '};',
            'value = 3;',
            'Number next = value;'
        ].join('\n');
        expect(LgdCompiler.create().compileToJs(source).errors).toEqual([]);
    });

    test('Infers assignment values using their own visible scope rather than later declarations.', () =>
    {
        const source = [
            'Number value = 0;',
            'Number next = 1;',
            'next = value;',
            'Function inner = () => {',
            '    String value = "inner";',
            '};'
        ].join('\n');
        expect(LgdCompiler.create().compileToJs(source).errors).toEqual([]);
    });

    test('Restores typed parameters after a nested local shadow closes.', () =>
    {
        const source = [
            'Function run = (Number value) => {',
            '    {',
            '        const String value = "inner";',
            '    }',
            '    value = 3;',
            '    Number next = value;',
            '};'
        ].join('\n');
        expect(LgdCompiler.create().compileToJs(source).errors).toEqual([]);
    });

    test('Still rejects writes and mismatches against the visible outer binding.', () =>
    {
        const source = [
            'const Number value = 0;',
            '{',
            '    String value = "inner";',
            '}',
            'value = 3;',
            'String invalid = value;'
        ].join('\n');
        const messages = LgdCompiler.create().compileToJs(source).errors.map(error => error.message);
        expect(messages).toContain("Cannot assign to const variable 'value'.");
        expect(messages).toContain('Cannot assign Number to String.');
    });

    test('Checks executable template expressions while ignoring raw template text.', () =>
    {
        const source = [
            'const Number value = 0;',
            'String template = `value = 2; ${(() => {',
            '    value = 3;',
            '    return value;',
            '})()}`;'
        ].join('\n');
        const errors = LgdCompiler.create().compileToJs(source).errors;
        expect(errors.length).toBe(1);
        expect(errors[0].message).toBe("Cannot assign to const variable 'value'.");
        expect(errors[0].offset).toBe(source.indexOf('value = 3'));
    });
});
