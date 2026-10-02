const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdStandaloneReturnChecker = require('../../../src/Compilers/LgdStandaloneReturnChecker');

function standaloneErrors(source)
{
    return LgdCompiler.create().compileToJs(source).errors.filter(error => error.message.startsWith('Standalone return-first'));
}

describe('Unsupported standalone return-first functions.', () =>
{
    test.each([
        'void log() {}',
        'Number log() { return 1; }',
        'async void log(Number count = 1, ...String labels) {}',
        'vscode.Uri locate() { return current; }',
        'export void log() {}',
        'export default async Number read() { return 1; }',
        'function outer() { void log() {} }',
        'const callback = () => { void log() {} };',
        'class Commands { run() { void log() {} } }',
        'Object Commands = { run() { void log() {} } };',
        'void /* type comment */ log(/* arguments */) /* body comment */ {}'
    ])('Reports a blocking diagnostic for %s.', source =>
    {
        const errors = standaloneErrors(source);
        expect(errors).toHaveLength(1);
        expect(errors[0].severity).not.toBe('warning');
        expect(errors[0].message).toContain('JavaScript function declaration with JSDoc');
    });

    test('Keeps exact original header ranges after class lowering and CRLF lines.', () =>
    {
        const source = 'class Commands {\r\n    run() {\r\n        async void log() {}\r\n    }\r\n}';
        const error = standaloneErrors(source)[0];
        const expectedLine = 3;
        expect(error.line).toBe(expectedLine);
        expect(source.slice(error.offset, error.endOffset)).toBe('void log');
    });

    test('Reports each complete standalone declaration without interpreting its body as another declaration.', () =>
    {
        const source = 'void first() { void nested() {} } void second() {}';
        expect(standaloneErrors(source).map(error => source.slice(error.offset, error.endOffset))).toEqual([ 'void first', 'void second' ]);
    });

    test.each([
        'const message = "void log() {}"; const template = `Number read() {}`;',
        '// void log() {}\n/* Number read() {} */',
        'const expression = /void log\\(\\) {}/;',
        'void log(); {}',
        'void log()\n{}',
        'function log() {} async function read() {}',
        'const commands = { log() {}, async read() {}, void() {}, Number() {} };',
        'Object Commands = { void log() {}, Number read() { return 1; } };',
        'class Commands { void log() {} Number read() { return 1; } }'
    ])('Preserves supported methods, literals and ordinary JavaScript: %s.', source =>
    {
        expect(LgdCompiler.create().compileToJs(source).errors).toEqual([]);
    });

    test('Does not misreport object property syntax as a standalone declaration.', () =>
    {
        const code = 'const commands = { void log() {} };';
        expect(LgdStandaloneReturnChecker.check({ code: code, segments: [] })).toEqual([]);
    });

    test('Provides the same blocking rejection for the TypeScript target.', () =>
    {
        const result = LgdCompiler.create().compileToTs('void log() {}');
        expect(result.errors[0].message).toContain('Standalone return-first');
    });
});
