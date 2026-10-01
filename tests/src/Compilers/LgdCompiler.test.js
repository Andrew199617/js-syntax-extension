const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const typescript = require('typescript');

const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdTransform = require('../../../src/Parsers/LgdTransform');

/** @description Directory holding the real-world LGD examples that vet the compiler. */
const exampleDir = path.join(__dirname, '..', '..', '..', 'examples');

/** @description Reads an example file as UTF-8 text. */
function readExample(fileName)
{
    return fs.readFile(path.join(exampleDir, fileName), 'utf8');
}

async function checkExample(targetName, compile)
{
    const source = await readExample('Calculator.lgd');
    const result = compile(LgdCompiler.create(), source);
    expect(result.errors).toEqual([]);
    const expectedLines = (await readExample(`Calculator.${targetName}`)).split(/\r?\n/);
    const actualLines = result.code.split(/\r?\n/);
    expect(actualLines.length).toBe(expectedLines.length);
    for(let index = 0; index < actualLines.length; index++)
    {
        expect(actualLines[index]).toBe(expectedLines[index]);
    }

    return result;
}

async function loadCalculator()
{
    const jsCode = (await readExample('Calculator.js')).replace(/^export /gm, '');
    const tempFile = path.join(os.tmpdir(), `Calculator.lgd-test-${Date.now()}.js`);
    await fs.writeFile(tempFile, `${jsCode}\nmodule.exports = { add, multiply, reset, describe };\n`);
    try
    {
        return require(tempFile);
    }
    finally
    {
        await fs.unlink(tempFile);
    }
}

describe('LGD compiler.', () =>
{
    test('Calculator.lgd compiles to the verified JavaScript output.', async () =>
    {
        const result = await checkExample('js', (compiler, source) => compiler.compileToJs(source));
        const names = result.allDeclarations.map(declaration => `${declaration.name}:${declaration.typeKeyword}`);
        expect(names).toEqual([
            'calculatorName:String',
            'total:Number',
            'hasRun:Boolean',
            'history:Array',
            'record:Function',
            'add:Function',
            'next:Number',
            'multiply:Function',
            'next:Number',
            'reset:Function',
            'describe:Function',
            'state:String'
        ]);
    });

    test('Calculator.lgd compiles to the verified TypeScript output.', async () =>
    {
        await checkExample('ts', (compiler, source) => compiler.compileToTs(source));
    });

    test('Calculator.lgd compiles to the verified C# output.', async () =>
    {
        await checkExample('cs', (compiler, source) => compiler.compileToCSharp(source));
    });

    test('The compiled JavaScript actually runs.', async () =>
    {
        const firstAddend = 2;
        const secondAddend = 3;
        const expectedAfterAdds = 5;
        const factor = 10;
        const expectedAfterMultiply = 50;
        const calculator = await loadCalculator();
        expect(calculator.describe()).toBe('LGD Calculator is fresh with total 0');
        expect(calculator.add(firstAddend)).toBe(firstAddend);
        expect(calculator.add(secondAddend)).toBe(expectedAfterAdds);
        expect(calculator.multiply(factor)).toBe(expectedAfterMultiply);
        expect(calculator.describe()).toBe('LGD Calculator is used with total 50');
        expect(calculator.reset()).toBe(0);
        expect(calculator.describe()).toBe('LGD Calculator is fresh with total 0');
    });

    test('The compiled TypeScript parses without syntax errors.', async () =>
    {
        const tsCode = await readExample('Calculator.ts');
        const transpiled = typescript.transpileModule(tsCode, {
            compilerOptions: { target: typescript.ScriptTarget.ES2020, module: typescript.ModuleKind.ESNext },
            reportDiagnostics: true
        });
        const errors = (transpiled.diagnostics || []).filter(diagnostic => diagnostic.category === typescript.DiagnosticCategory.Error);
        expect(errors).toEqual([]);
    });

    test('Rejects a comparison operator in a declaration.', () =>
    {
        const result = LgdCompiler.create().compileToJs('Number x == 5;');
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toMatch(/Unexpected "=" in typed declaration/);
        expect(result.code).toBe('Number x == 5;');
    });

    test('Reports a missing semicolon but still compiles the next declaration.', () =>
    {
        const result = LgdCompiler.create().compileToJs('Number x = 5\nNumber y = 6;');
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toMatch(/Missing semicolon/);
        expect(result.code).toContain('let y = 6;');
    });

    test('Leaves type constructor calls alone.', () =>
    {
        const compiler = LgdCompiler.create();
        expect(compiler.compileToJs('const n = Number("5");').errors).toEqual([]);
        expect(compiler.compileToJs('const n = Number("5");').code).toBe('const n = Number("5");');
        expect(compiler.compileToJs('Number("5");').code).toBe('Number("5");');
    });

    test('Flags a malformed declaration.', () =>
    {
        const result = LgdCompiler.create().compileToJs('Number 123 = 5;');
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toMatch(/Invalid typed declaration/);
        expect(result.code).toBe('Number 123 = 5;');
    });

    test('Handles semicolons inside strings and template literals.', () =>
    {
        const compiler = LgdCompiler.create();
        const stringResult = compiler.compileToJs('String s = "a;b";');
        expect(stringResult.errors).toEqual([]);
        expect(stringResult.code).toContain('let s = "a;b";');

        // The '${' sequence is assembled from parts so the lint rule against
        // accidental template expressions in plain strings ignores this intentional test data.
        const interpolationStart = [ '$', '{' ].join('');
        const templateSource = `String t = \`a${interpolationStart}x};b\`;`;
        const templateResult = compiler.compileToJs(templateSource);
        expect(templateResult.errors).toEqual([]);
        expect(templateResult.code).toContain(`let t = \`a${interpolationStart}x};b\`;`);
    });

    test('Does not duplicate an existing @type tag.', () =>
    {
        const result = LgdCompiler.create().compileToJs('/** @type {number} */\nNumber x = 1;');
        expect(result.errors).toEqual([]);
        expect(result.code.match(/@type/g).length).toBe(1);
    });

    test('Translates C# edge cases.', () =>
    {
        const compiler = LgdCompiler.create();

        function stripHeader(code)
        {
            return code.split('using System.Collections.Generic;\n')[1];
        }

        expect(stripHeader(compiler.compileToCSharp('BigInt n = 123n;').code).trim()).toBe('long n = 123L;');
        expect(stripHeader(compiler.compileToCSharp('Array x = y[0];').code).trim()).toBe('List<dynamic> x = y[0];');
        expect(stripHeader(compiler.compileToCSharp('readonly Number x = compute();').code).trim()).toBe('double x = compute();');
        expect(stripHeader(compiler.compileToCSharp('Boolean b = x === 1;').code).trim()).toBe('bool b = x == 1;');
        expect(stripHeader(compiler.compileToCSharp('String s = "a === b";').code).trim()).toBe('string s = "a === b";');
        expect(stripHeader(compiler.compileToCSharp('Function f = (a) => { do(a); };').code).trim()).toBe('Action<dynamic> f = (a) => { do(a); };');
        expect(stripHeader(compiler.compileToCSharp('Function f = (a) => a * 2;').code).trim()).toBe('Func<dynamic, dynamic> f = (a) => a * 2;');
    });
});

describe('LgdTransform facade.', () =>
{
    test('Recognizes LGD files and supported sources.', () =>
    {
        expect(LgdTransform.isLgdFile('Calculator.lgd')).toBe(true);
        expect(LgdTransform.isLgdFile('Calculator.js')).toBe(false);
        expect(LgdTransform.isSupportedSourceFile('Calculator.lgd')).toBe(true);
        expect(LgdTransform.isSupportedSourceFile('Calculator.js')).toBe(true);
        expect(LgdTransform.isSupportedSourceFile('Calculator.ts')).toBe(false);
    });

    test('Transforms typed declarations to JavaScript.', () =>
    {
        const code = LgdTransform.transformLgdContent('/** Count. */\nNumber x = 1;');
        expect(code).toContain('let x = 1;');
        expect(code).toContain('@type {number}');
    });
});
