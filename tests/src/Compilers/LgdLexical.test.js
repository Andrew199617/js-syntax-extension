const virtualMachine = require('vm');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');
const { maskCode } = require('../../../src/Compilers/LgdInfer');

describe('LGD lexical boundaries.', () =>
{
    test('Preserves declarations mentioned in multiline comments and template text.', () =>
    {
        const source = [
            '/*',
            'Number sample = 1;',
            'Numer broken = 2;',
            '*/',
            'String template = `',
            'Number sample = 1;',
            '`;',
            'Number live = 2;'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(result.allDeclarations.map(declaration => declaration.name)).toEqual([ 'template', 'live' ]);
        expect(virtualMachine.runInNewContext(`${result.code}\n[template, live];`)).toEqual([ '\nNumber sample = 1;\n', 2 ]);
    });

    test('Compiles executable declarations inside template interpolations.', () =>
    {
        const source = [
            'String template = `total ${(() => {',
            '    Number count = 2;',
            '    return count;',
            '})()}`;'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(virtualMachine.runInNewContext(`${result.code}\ntemplate;`)).toBe('total 2');
    });

    test('Skips regex delimiters and assignment lookalikes while preserving division.', () =>
    {
        const source = [
            'const Number value = 2;',
            'Object pattern = /value = 3[};]/;',
            'Number quotient = value / 2;',
            'Object matcher = { match(String input) { return /[})]/.test(input); } };'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(virtualMachine.runInNewContext(`${result.code}\n[quotient, matcher.match("}")];`)).toEqual([ 1, true ]);
    });

    test('Preserves UTF-16 offsets and CRLF while masking escaped strings and regexes.', () =>
    {
        const source = '"😀"; /label = 1/;\r\nconst label = "\\"";';
        const masked = maskCode(source);
        expect(masked.length).toBe(source.length);
        expect(masked.indexOf('const label')).toBe(source.indexOf('const label'));
        expect(masked).toContain('\r\n');
        expect(masked).not.toContain('label = 1');
    });

    test.each([
        [ 'Function match = (Object pattern = /[(]/, String text = "(") => pattern.test(text);', 'match()' ],
        [ 'Object matcher = { match(Object pattern = /[(]/, String text = "(") { return pattern.test(text); } };', 'matcher.match()' ]
    ])('Preserves regex defaults while stripping every following parameter: %s.', (source, expression) =>
    {
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(result.code).not.toContain('String text');
        expect(virtualMachine.runInNewContext(`${result.code}\n${expression};`)).toBe(true);
    });

    test.each([
        [ 'Function run = (Number count /*, ignored */, String label = "a") => count + label;', 'run(2)' ],
        [ 'Object runner = { run(Number count /*, ignored */, String label = "a") { return count + label; } };', 'runner.run(2)' ],
        [ 'Function run = (/* Number */ Number/* ) , = */count // ) , [ "\n , String label /* = , */ = "a") => count + label;', 'run(2)' ],
        [ 'Object runner = { run(/* Number */ Number/* ) , = */count // ) , [ "\n , String label /* = , */ = "a") { return count + label; } };', 'runner.run(2)' ]
    ])('Preserves parameter comments and mappings while stripping types: %s.', (source, expression) =>
    {
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(virtualMachine.runInNewContext(`${result.code}\n${expression};`)).toBe('2a');
        const map = LgdSourceMap.create(result.mappings);
        for(const match of source.matchAll(/\/\*[\S\s]*?\*\/|\/\/[^\n]*|count|label/g))
        {
            const outputOffset = map.toOutput(match.index);
            expect(result.code.slice(outputOffset, outputOffset + match[0].length)).toBe(match[0]);
            expect(map.toSource(outputOffset)).toBe(match.index);
        }
    });
});
