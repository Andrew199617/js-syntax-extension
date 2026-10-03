const LgdGeneratedJsValidator = require('../../../src/Compilers/LgdGeneratedJsValidator');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdReturnChecker = require('../../../src/Compilers/LgdReturnChecker');
const LgdNativeClassEmitter = require('../../../src/Compilers/LgdNativeClassEmitter');
const LgdBaseChecker = require('../../../src/Compilers/LgdBaseChecker');
const parser = require('@babel/parser');

/** @description Gives unchanged JavaScript an identity source map for isolated syntax tests. */
function validate(code)
{
    const segments = [{ srcStart: 0, srcEnd: code.length, outStart: 0, outEnd: code.length, verbatim: true }];
    return LgdGeneratedJsValidator.validate({ code: code, segments: segments }, code);
}

describe('final generated JavaScript validation', () =>
{
    afterEach(() => jest.restoreAllMocks());
    test.each([
        [ 'ES modules', 'import value from "./value.js"; export const count = value;' ],
        [ 'CommonJS and shebangs', '#!/usr/bin/env node\r\nconst value = require("./value.js"); module.exports = value;' ],
        [ 'CommonJS wrapper returns', 'module.exports = 1; if(module.loaded) { return; }' ],
        [ 'JSX', 'export const render = value => <section>{value?.label ?? "empty"}</section>;' ],
        [ 'module await', 'export const result = await Promise.resolve(1);' ],
        [ 'nested returns', 'function read() { if(true) { return 1; } return 2; }' ],
        [ 'labels and loop control', 'outer: for(const item of [1]) { if(item) { break outer; } continue; }' ],
        [ 'native class syntax', 'class Counter { #count = 0; static { this.ready = true; } read() { return this.#count; } }' ],
        [ 'regular expressions and templates', [ 'const pattern = /[{};]/; const label = `count: $', '{1 + 2}`;' ].join('') ],
        [ 'empty files', '' ]
    ])('accepts %s and returns a reusable full-file tree', (description, code) =>
    {
        const result = validate(code);
        expect(result.errors).toEqual([]);
        expect(result.tree.type).toBe('File');
        expect(result.tree.program.type).toBe('Program');
        expect(result.tree.program.end).toBe(code.length);
    });

    test.each([
        [ 'unclosed blocks', 'function read() { return 1;' ],
        [ 'unterminated strings', 'const label = "unfinished;' ],
        [ 'unterminated templates', 'const label = `unfinished;' ],
        [ 'invalid JSX', 'const render = () => <section>;' ],
        [ 'duplicate lexical declarations', 'let count = 1; let count = 2;' ],
        [ 'ES module top-level returns', 'export const count = 1; return 1;' ],
        [ 'class static-block returns', 'class Counter { static { return; } }' ],
        [ 'class static-block returns after a CommonJS return', 'module.exports = 1; return; class Counter { static { return; } }' ],
        [ 'top-level loop control', 'break;' ],
        [ 'unresolved exports', 'export { missing };' ],
        [ 'strict-mode failures', 'export function read() { with({}) {} }' ]
    ])('rejects %s without returning a partial tree', (description, code) =>
    {
        const result = validate(code);
        expect(result.tree).toBeNull();
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toEqual(expect.objectContaining({
            code: 'lgd.output.syntax',
            message: expect.stringContaining('Unable to compile this syntax:')
        }));
        expect(result.errors[0].offset).toBeGreaterThanOrEqual(0);
        expect(result.errors[0].endOffset).toBeLessThanOrEqual(code.length);
    });

    test.each([
        [ 'constant initializer', 'const broken = ;' ],
        [ 'mutable initializer', 'let broken = ;' ],
        [ 'assignment', 'broken = ;' ],
        [ 'member assignment', 'reader.broken = ;' ],
        [ 'block comments', 'const broken = /* ignored = ; */ ;' ],
        [ 'LF line comments', 'const broken = // ignored = ;\n;' ],
        [ 'CRLF line comments', 'const broken = // ignored = ;\r\n;' ],
        [ 'EOF', 'const broken =' ],
        [ 'EOF after whitespace', 'broken = \r\n' ],
        [ 'EOF after a comment', 'broken = /* ignored */' ]
    ])('explains a missing expression in %s at the exact source boundary', (description, source) =>
    {
        const result = validate(source);
        const position = source.endsWith(';') ? source.length - 1 : source.length;
        expect(result.errors).toEqual([expect.objectContaining({
            offset: position,
            endOffset: Math.min(position + 1, source.length),
            message: "Expected an expression after '='.",
            debug: {
                reasonCode: 'UnexpectedToken',
                generatedOffset: position,
                parserMessage: expect.stringContaining('Unexpected token')
            }
        })]);
    });

    test.each([
        [ 'comparison', 'broken == ;' ],
        [ 'strict comparison', 'broken === ;' ],
        [ 'inequality', 'broken != ;' ],
        [ 'less than or equal', 'broken <= ;' ],
        [ 'compound assignment', 'broken += ;' ],
        [ 'arrow function', 'broken => ;' ],
        [ 'string containing an assignment', 'const label = " = ;"; + ;' ],
        [ 'template containing an assignment', 'const label = ` = ;`; + ;' ],
        [ 'regular expression containing an assignment', 'const pattern = / = ;/; + ;' ],
        [ 'unclosed block with a misleading comment', 'function read() { // = ;' ],
        [ 'unterminated string', 'const label = " = ;' ],
        [ 'unterminated template', 'const label = ` = ;' ]
    ])('retains parser detail for %s without inventing a missing assignment expression', (description, source) =>
    {
        const result = validate(source);
        expect(result.errors[0].message).toContain('Unable to compile this syntax:');
        expect(result.errors[0].message).not.toContain('Generated JavaScript');
        const parserDetail = result.errors[0].debug.parserMessage.replace(/ \(\d+:\d+\)$/, '');
        expect(result.errors[0].message).toBe(`Unable to compile this syntax: ${parserDetail}`);
    });

    test('does not specialize a different parser failure with the same token context', () =>
    {
        const source = 'const broken = ;';
        const error = Object.assign(new SyntaxError('A different syntax failure (1:15)'), {
            reasonCode: 'DifferentFailure', pos: source.indexOf(';')
        });
        jest.spyOn(parser, 'parse').mockImplementation(() =>
        {
            throw error;
        });

        expect(validate(source).errors[0].message).toBe('Unable to compile this syntax: A different syntax failure');
    });

    test('does not infer source syntax when original source is unavailable', () =>
    {
        const code = 'const broken = ;';
        const segments = [{ srcStart: 0, srcEnd: code.length, outStart: 0, outEnd: code.length, verbatim: true }];
        const result = LgdGeneratedJsValidator.validate({ code: code, segments: segments });
        expect(result.errors[0].message).toBe('Unable to compile this syntax: Unexpected token');
    });

    test.each([ false, true ])('keeps an emitter defect separate from source syntax when the failing token is copied: %s', copiedToken =>
    {
        const source = 'let broken;';
        const code = 'let broken = ;';
        const sourceName = source.indexOf('broken');
        const outputName = code.indexOf('broken');
        const segments = [ {
            srcStart: 0, srcEnd: source.length - 1, outStart: 0, outEnd: code.length - 1, verbatim: false,
            nameSrcStart: sourceName, nameSrcEnd: sourceName + 'broken'.length,
            nameOutStart: outputName, nameOutEnd: outputName + 'broken'.length
        }, {
            srcStart: source.length - 1, srcEnd: source.length, outStart: code.length - 1, outEnd: code.length, verbatim: copiedToken,
            nameSrcStart: sourceName, nameSrcEnd: sourceName + 'broken'.length,
            nameOutStart: outputName, nameOutEnd: outputName + 'broken'.length
        } ];
        const result = LgdGeneratedJsValidator.validate({ code: code, segments: segments }, source);
        expect(result.errors[0].message).toBe('Unable to compile this syntax: Unexpected token');
        expect(result.errors[0].debug).toEqual({
            reasonCode: 'UnexpectedToken', generatedOffset: code.indexOf(';'), parserMessage: 'Unexpected token (1:13)'
        });
    });

    test('maps an invalid initializer through a generated typed declaration head', () =>
    {
        const source = 'Number count = ;\r\n';
        const code = '/** @type {number} */\r\nlet count = ;\r\n';
        const sourceTail = source.indexOf(' = ');
        const outputTail = code.indexOf(' = ');
        const segments = [
            { srcStart: 0, srcEnd: sourceTail, outStart: 0, outEnd: outputTail, verbatim: false,
                nameSrcStart: source.indexOf('count'), nameSrcEnd: sourceTail,
                nameOutStart: code.indexOf('count'), nameOutEnd: outputTail },
            { srcStart: sourceTail, srcEnd: source.length, outStart: outputTail, outEnd: code.length, verbatim: true }
        ];
        const result = LgdGeneratedJsValidator.validate({ code: code, segments: segments }, source);
        expect(result.errors[0].offset).toBe(source.indexOf(';'));
        expect(result.errors[0].endOffset).toBe(source.indexOf(';') + 1);
        expect(result.errors[0].message).toBe("Expected an expression after '='.");
    });

    test('maps syntax failures after interface erasure to the original CRLF source', () =>
    {
        const source = 'interface IReader {}\r\nconst broken = ;\r\n';
        const sourceStart = source.indexOf('const');
        const code = source.slice(sourceStart);
        const segments = [{ srcStart: sourceStart, srcEnd: source.length, outStart: 0, outEnd: code.length, verbatim: true }];
        const result = LgdGeneratedJsValidator.validate({ code: code, segments: segments }, source);
        expect(result.errors[0].offset).toBe(source.indexOf(';'));
        expect(result.errors[0].endOffset).toBe(source.indexOf(';') + 1);
        expect(result.errors[0].message).toBe("Expected an expression after '='.");
    });

    test('maps an unexpected end of file to the source end without inventing a character', () =>
    {
        const code = 'function read() {';
        const result = validate(code);
        expect(result.errors[0].offset).toBe(code.length);
        expect(result.errors[0].endOffset).toBe(code.length);
    });
});

describe('generated JavaScript compiler integration', () =>
{
    afterEach(() => jest.restoreAllMocks());

    test.each([ 'oloo', 'class' ])('blocks invalid passthrough syntax in %s output at the original source offset', javascriptObjectModel =>
    {
        const source = 'const valid = 1;\r\nconst broken = ;';
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({
            offset: source.lastIndexOf(';'),
            endOffset: source.lastIndexOf(';') + 1,
            line: 2,
            message: "Expected an expression after '='."
        });
    });

    test.each([ 'oloo', 'class' ])('explains a missing typed initializer after interface erasure in %s output', javascriptObjectModel =>
    {
        const source = 'interface IUnused {}\r\nNumber broken = /* explain */ ;';
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors).toEqual([expect.objectContaining({
            offset: source.lastIndexOf(';'), endOffset: source.length, line: 2,
            message: "Expected an expression after '='.",
            debug: expect.objectContaining({ reasonCode: 'UnexpectedToken' })
        })]);
    });

    test('still blocks malformed plain JavaScript in native mode without creating class or type-analysis scopes', () =>
    {
        const source = 'const broken = ;';
        const parse = jest.spyOn(parser, 'parse');
        const context = jest.spyOn(LgdReturnChecker, 'createContext');
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: 'class' });
        expect(result.allDeclarations).toEqual([]);
        expect(result.errors).toEqual([expect.objectContaining({ code: 'lgd.output.nativeSyntax', offset: source.indexOf(';') })]);
        expect(parse).toHaveBeenCalledTimes(1);
        expect(context).not.toHaveBeenCalled();
    });

    test('skips native heritage and dispatch analysis when there are no LGD classes', () =>
    {
        const code = 'const count = 1;';
        const parse = jest.spyOn(parser, 'parse');
        const validation = validate(code);
        const scopes = jest.spyOn(LgdBaseChecker, 'collectScopes');
        const bindings = jest.spyOn(LgdBaseChecker, 'collectBindings');
        const emitted = { code: code, segments: [] };
        const errors = LgdNativeClassEmitter.check(code, [], new Map(), { emitted: emitted, tree: validation.tree });
        expect(errors).toEqual([]);
        expect(scopes).not.toHaveBeenCalled();
        expect(bindings).not.toHaveBeenCalled();
        expect(parse).toHaveBeenCalledTimes(1);
    });

    test.each([ 'oloo', 'class' ])('reuses one final-output parse for typed class assignment and return analysis in %s output', javascriptObjectModel =>
    {
        const source = 'class Counter { Number count(Number value) { value = "wrong"; return "wrong"; } }';
        const parse = jest.spyOn(parser, 'parse');
        const context = jest.spyOn(LgdReturnChecker, 'createContext');
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(parse).toHaveBeenCalledTimes(1);
        expect(parse.mock.calls[0][0]).toBe(result.code);
        expect(context).toHaveBeenCalledTimes(1);
        const contextOptions = context.mock.calls[0].at(-1);
        expect(contextOptions.tree).toBe(parse.mock.results[0].value);
        expect(result.errors.map(error => error.message)).toEqual([
            'Cannot assign String to Number.',
            'Cannot return String from a Number method.'
        ]);
    });

    test.each([ 'oloo', 'class' ])('validates after interface erasure and maps malformed bodies back in %s output', javascriptObjectModel =>
    {
        const source = 'interface IReader { Number read(); }\r\nclass Reader : IReader { Number read() { return ; + ; } }';
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors).toEqual([expect.objectContaining({
            offset: source.lastIndexOf(';'),
            message: expect.stringContaining('Unable to compile this syntax:')
        })]);
        expect(result.code).not.toContain('interface IReader');
    });

    test('does not hide invalid syntax behind warning-only return documentation', () =>
    {
        const source = 'Object Reader = { /** @returns {number} */ Number read() { return ; + ; } };';
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors.filter(error => error.severity === 'warning')).toHaveLength(1);
        expect(result.errors.filter(error => error.severity !== 'warning')).toEqual([expect.objectContaining({
            message: expect.stringContaining('Unable to compile this syntax:')
        })]);
    });

    test('keeps parse-only, TypeScript and C# lexical checking independent of the final JavaScript stage', () =>
    {
        const source = 'Function read = (Number value) => { value = "wrong"; };';
        const validateOutput = jest.spyOn(LgdGeneratedJsValidator, 'validate');
        const compiler = LgdCompiler.create();
        for(const method of [ 'parse', 'compileToTs', 'compileToCSharp' ])
        {
            expect(compiler[method](source).errors).toEqual([expect.objectContaining({ message: 'Cannot assign String to Number.' })]);
        }

        expect(validateOutput).not.toHaveBeenCalled();
    });

    test('keeps source-map diagnostics current when identical output comes from different original sources', () =>
    {
        const compiler = LgdCompiler.create();
        const source = 'const broken = ;';
        const first = compiler.compileToJs(`interface IUnused {}\r\n${source}`);
        const second = compiler.compileToJs(`interface IUnused {\r\n\r\n}\r\n${source}`);
        expect(first.code).toBe(second.code);
        expect(first.errors[0].line).toBe(2);
        const secondSourceLine = 4;
        expect(second.errors[0].line).toBe(secondSourceLine);
        expect(second.errors[0].offset).toBeGreaterThan(first.errors[0].offset);
    });
});
