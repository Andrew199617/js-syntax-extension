const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const typescript = require('typescript');

const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const { parseTypedParams } = require('../../../src/Compilers/LgdTypedParams');
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
        const names = result.allDeclarations.map(declaration => `${declaration.name}:${declaration.typeName}`);
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

describe('LGD source mappings.', () =>
{
    const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');

    test('Declaration names map to the emitted JavaScript name span.', () =>
    {
        const source = '/** The total. */\nNumber total = 0;\n';
        const result = LgdCompiler.create().compileToJs(source);
        const map = LgdSourceMap.create(result.mappings);
        const nameOffset = source.indexOf('total =');
        const jsOffset = map.toOutput(nameOffset);
        expect(result.code.slice(jsOffset, jsOffset + 'total'.length)).toBe('total');
        expect(result.code.slice(jsOffset - 'let '.length, jsOffset)).toBe('let ');
    });

    test('Usages in verbatim gaps map 1:1 with exact roundtrips.', () =>
    {
        const source = 'Number total = 0;\ntotal += 5;\n';
        const result = LgdCompiler.create().compileToJs(source);
        const map = LgdSourceMap.create(result.mappings);
        const usageOffset = source.indexOf('total', source.indexOf('total =') + 'total'.length);
        const jsOffset = map.toOutput(usageOffset);
        expect(result.code.slice(jsOffset, jsOffset + 'total'.length)).toBe('total');
        expect(map.toSource(jsOffset)).toBe(usageOffset);
    });

    test('Positions on the type keyword resolve to the emitted variable name.', () =>
    {
        const source = 'Number total = 0;\n';
        const result = LgdCompiler.create().compileToJs(source);
        const map = LgdSourceMap.create(result.mappings);
        const jsOffset = map.toOutput(source.indexOf('Number'));
        expect(result.code.slice(jsOffset, jsOffset + 'total'.length)).toBe('total');
    });

    test('Mappings survive nested declarations and readonly heads.', () =>
    {
        const source = 'readonly Number outer = 1;\nFunction f = () => {\n  Number inner = 2;\n  return inner;\n};\n';
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        const map = LgdSourceMap.create(result.mappings);
        const innerOffset = source.indexOf('inner =');
        const jsOffset = map.toOutput(innerOffset);
        expect(result.code.slice(jsOffset, jsOffset + 'inner'.length)).toBe('inner');
        expect(result.code.slice(jsOffset - 'let '.length, jsOffset)).toBe('let ');
        expect(map.toSource(jsOffset)).toBe(innerOffset);
        const outerOffset = source.indexOf('outer =');
        const jsOuter = map.toOutput(outerOffset);
        expect(result.code.slice(jsOuter - 'const '.length, jsOuter)).toBe('const ');
        const returnOffset = source.indexOf('return inner;') + 'return '.length;
        expect(map.toSource(map.toOutput(returnOffset))).toBe(returnOffset);
    });
});

describe('LGD type checking.', () =>
{
    function check(source)
    {
        return LgdCompiler.create().compileToJs(source);
    }

    function expectTypeError(source, message, offset)
    {
        const result = check(source);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe(message);
        expect(result.errors[0].offset).toBe(offset);
    }

    test('Accepts matching literal initializers for every type keyword.', () =>
    {
        const source = [
            'Number count = 42;',
            'String label = "ready";',
            'Boolean active = true;',
            'BigInt big = 10n;',
            'Symbol key = Symbol("key");',
            'Object options = {};',
            'Array items = [];',
            'Function run = () => {};'
        ].join('\n');
        expect(check(source).errors).toEqual([]);
    });

    test('Rejects a mismatched literal initializer with the value offset.', () =>
    {
        expectTypeError('Number myNum = "hello";', 'Cannot assign String to Number.', 'Number myNum = '.length);
    });

    test('Rejects mismatched literals for the other keywords.', () =>
    {
        expectTypeError('Boolean flag = 1;', 'Cannot assign Number to Boolean.', 'Boolean flag = '.length);
        expectTypeError('Array items = {};', 'Cannot assign Object to Array.', 'Array items = '.length);
        expectTypeError('String label = 7;', 'Cannot assign Number to String.', 'String label = '.length);
    });

    test('Infers operators: arithmetic, comparison, string concat, ternary.', () =>
    {
        expect(check('Number total = 1 + 2 * 3;').errors).toEqual([]);
        expect(check('Boolean done = count === 1;').errors).toEqual([]);
        expect(check('String label = "a" + "b";').errors).toEqual([]);
        expect(check('String state = ready ? "yes" : "no";').errors).toEqual([]);
        expectTypeError('Number total = "a" + "b";', 'Cannot assign String to Number.', 'Number total = '.length);
    });

    test('Treats calls, member access, and unknown names as Unknown.', () =>
    {
        expect(check('Number total = compute();').errors).toEqual([]);
        expect(check('Number total = state.count;').errors).toEqual([]);
        expect(check('Number total = missing;').errors).toEqual([]);
    });

    test('Resolves declared names and allows null and Object as a top type.', () =>
    {
        expect(check('Number a = 1;\nNumber b = a;').errors).toEqual([]);
        expect(check('Number total = null;').errors).toEqual([]);
        expect(check('Object anything = 42;').errors).toEqual([]);
        expectTypeError('Number a = 1;\nString label = a;', 'Cannot assign Number to String.', 'Number a = 1;\nString label = '.length);
    });

    test('Checks assignments after the declaration.', () =>
    {
        expect(check('Number total = 0;\ntotal = 1;').errors).toEqual([]);
        expectTypeError('Number total = 0;\ntotal = "many";', 'Cannot assign String to Number.', 'Number total = 0;\ntotal = '.length);
    });

    test('Rejects assignments to readonly variables.', () =>
    {
        const result = check('readonly Number total = 0;\ntotal = 1;');
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe('Cannot assign to readonly variable \'total\'.');
    });

    test('Ignores lookalikes: strings, member writes, comparisons, shadowing declarations.', () =>
    {
        const source = [
            'Number total = 0;',
            'log("total = oops");',
            'state.total = "oops";',
            'if(total == 1) {}',
            'Function read = () => { const total = "shadow"; return total; };'
        ].join('\n');
        expect(check(source).errors).toEqual([]);
    });

    test('Ignores assignments to shadowing function parameters.', () =>
    {
        const source = 'Number total = 1;\nFunction set = (total) => { total = "s"; return total; };';
        expect(check(source).errors).toEqual([]);
    });

    test('Ignores class field declarations with colliding names.', () =>
    {
        expect(check('String label = "a";\nclass Widget { label = 5; }').errors).toEqual([]);
    });
});

describe('JavaScript backend.', () =>
{
    function compile(source)
    {
        return LgdCompiler.create().compileToJs(source);
    }

    test('Emits the right @type tag for all eight keywords.', () =>
    {
        const cases = [
            [ 'Number n = 1;', 'number' ],
            [ 'String s = "a";', 'string' ],
            [ 'Boolean b = true;', 'boolean' ],
            [ 'BigInt i = 1n;', 'bigint' ],
            [ 'Symbol y = Symbol();', 'symbol' ],
            [ 'Object o = {};', 'Object' ],
            [ 'Array a = [];', 'any[]' ],
            [ 'Function f = () => {};', 'Function' ]
        ];
        for(const [ source, tsType ] of cases)
        {
            const result = compile(source);
            expect(result.errors).toEqual([]);
            expect(result.code.split('\n')[0]).toBe(`/** @type {${tsType}} */`);
        }
    });

    test('Mutable declarations become let, readonly become const.', () =>
    {
        expect(compile('Number n = 1;').code).toBe('/** @type {number} */\nlet n = 1;');
        expect(compile('readonly Number n = 1;').code).toBe('/** @type {number} */\nconst n = 1;');
    });

    test('Exported declarations keep their export keyword.', () =>
    {
        expect(compile('export Number n = 1;').code).toBe('/** @type {number} */\nexport let n = 1;');
        expect(compile('export readonly Number n = 1;').code).toBe('/** @type {number} */\nexport const n = 1;');
    });

    test('Merges a JSDoc block without an @type tag.', () =>
    {
        const result = compile('/** Adds one. */\nNumber n = 1;');
        expect(result.errors).toEqual([]);
        expect(result.code).toBe('/** Adds one.\n * @type {number}\n */\nlet n = 1;');
    });

    test('Preserves CRLF line endings in the emitted head.', () =>
    {
        const result = compile('Number n = 1;\r\nString s = "a";\r\n');
        expect(result.errors).toEqual([]);
        expect(result.code).toBe('/** @type {number} */\r\nlet n = 1;\r\n/** @type {string} */\r\nlet s = "a";\r\n');
    });
});

describe('LGD typed function parameters.', () =>
{
    function compileJs(source)
    {
        return LgdCompiler.create().compileToJs(source);
    }

    function paramsOf(source)
    {
        const result = compileJs(source);
        expect(result.errors).toEqual([]);
        return result.allDeclarations[0].typedParams;
    }

    test('Parses typed arrow parameters with names, types, defaults, and rest.', () =>
    {
        const typed = paramsOf('Function f = (Number value, String label = "x", ...rest) => {};');
        expect(typed.hasTypes).toBe(true);
        expect(typed.params.map(parameter => [ parameter.name, parameter.typeName, parameter.rest, parameter.defaultText ])).toEqual([
            [ 'value', 'Number', false, null ],
            [ 'label', 'String', false, '"x"' ],
            [ 'rest', null, true, null ]
        ]);
    });

    test('Parses dotted and nominal parameter types.', () =>
    {
        const result = compileJs('Function f = (vscode.Command command, GoToNextParagraph goNext) => {};');
        const typed = result.allDeclarations[0].typedParams;
        expect(typed.hasTypes).toBe(true);
        expect(typed.params.map(parameter => parameter.typeName)).toEqual([ 'vscode.Command', 'GoToNextParagraph' ]);
    });

    test('Leaves untyped parameters alone and reports hasTypes false.', () =>
    {
        const typed = paramsOf('Function f = (value, other = 1) => {};');
        expect(typed.hasTypes).toBe(false);
        expect(typed.params.map(parameter => parameter.name)).toEqual([ 'value', 'other' ]);
    });

    test('Returns null for non-function initializers and bare arrows.', () =>
    {
        expect(parseTypedParams('makeAdder(5);')).not.toBeNull();
        expect(parseTypedParams('makeAdder(5);').hasTypes).toBe(false);
        expect(parseTypedParams('42')).toBeNull();
        expect(parseTypedParams('value => value')).toBeNull();
    });

    test('Parses async arrows and function expressions.', () =>
    {
        expect(paramsOf('Function f = async (Number value) => {};').params[0].typeName).toBe('Number');
        expect(paramsOf('Function f = function run(Number value) {};').params[0].typeName).toBe('Number');
    });

    test('Accepts parameter uses that match the declared type.', () =>
    {
        const source = [
            'Number total = 0;',
            'Function add = (Number value) => {',
            '    Number next = total + value;',
            '    total = next;',
            '    return next;',
            '};'
        ].join('\n');
        expect(compileJs(source).errors).toEqual([]);
    });

    test('Rejects a body assignment that mismatches the parameter type.', () =>
    {
        const source = [
            'Function record = (Number value) => {',
            '    String label = value;',
            '};'
        ].join('\n');
        const result = compileJs(source);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe('Cannot assign Number to String.');
    });

    test('Checks assignments to the parameter itself.', () =>
    {
        expect(compileJs('Function f = (Number value) => {\n    value = 5;\n};').errors).toEqual([]);
        const bad = compileJs('Function f = (Number value) => {\n    value = "x";\n};');
        expect(bad.errors.length).toBe(1);
        expect(bad.errors[0].message).toBe('Cannot assign String to Number.');
    });

    test('Checks parameter default values against the parameter type.', () =>
    {
        expect(compileJs('Function f = (Number value = 5) => {};').errors).toEqual([]);
        const bad = compileJs('Function f = (Number value = "x") => {};');
        expect(bad.errors.length).toBe(1);
        expect(bad.errors[0].message).toBe('Cannot assign String to Number.');
    });

    test('Lets a typed parameter shadow an outer variable.', () =>
    {
        const source = [
            'Number value = 1;',
            'Function f = (String value) => {',
            '    Number n = value;',
            '};'
        ].join('\n');
        const result = compileJs(source);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe('Cannot assign String to Number.');
    });

    test('Scopes nested function parameters to the innermost function.', () =>
    {
        const source = [
            'Function outer = (Number a) => {',
            '    Function inner = (String a) => {',
            '        Number n = a;',
            '    };',
            '};'
        ].join('\n');
        const result = compileJs(source);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe('Cannot assign String to Number.');
    });

    test('Sees outer parameters from nested function bodies.', () =>
    {
        const source = [
            'Function outer = (Number a) => {',
            '    Function inner = () => {',
            '        Number n = a;',
            '    };',
            '};'
        ].join('\n');
        expect(compileJs(source).errors).toEqual([]);
    });

    test('Rejects unknown parameter type names.', () =>
    {
        const result = compileJs('Function f = (Numer value) => {};');
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe("Unknown type 'Numer'.");
    });

    test('Accepts dotted parameter types rooted at a required module.', () =>
    {
        const source = [
            'const vscode = require(\'vscode\');',
            'Function f = (vscode.TextDocument document) => {}; '
        ].join('\n');
        expect(compileJs(source).errors).toEqual([]);
    });

    test('Accepts dotted parameter types rooted at a destructured require.', () =>
    {
        const source = [
            'const { Oloo } = require(\'@mavega/oloo\');',
            'Function f = (Oloo.Factory factory) => {}; '
        ].join('\n');
        expect(compileJs(source).errors).toEqual([]);
    });

    test('Rejects dotted parameter types with an unrequired head.', () =>
    {
        const result = compileJs('Function f = (vscode.TextDocument document) => {};');
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe("Unknown type 'vscode.TextDocument'.");
    });

    test('Rejects unknown types in object literal method parameters.', () =>
    {
        const result = compileJs('Object o = { create(Numer name) {} };');
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe("Unknown type 'Numer'.");
    });

    test('Accepts dotted method parameter types rooted at a required module.', () =>
    {
        const source = [
            'const vscode = require(\'vscode\');',
            'Object o = { find(vscode.TextDocument document, vscode.Position position) {} };'
        ].join('\n');
        expect(compileJs(source).errors).toEqual([]);
    });

    test('Checks assignments to method parameters against their declared type.', () =>
    {
        const source = [
            'Number count = 0;',
            'Object o = { f(String count) { count = 1; } };'
        ].join('\n');
        const result = compileJs(source);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe('Cannot assign Number to String.');
    });

    test('Leaves untyped object methods and getters alone.', () =>
    {
        const source = 'Object o = { f(x) { return x; }, get name() { return \'x\'; } };';
        expect(compileJs(source).errors).toEqual([]);
    });

    test('Checks method parameter defaults against their declared type.', () =>
    {
        expect(compileJs('Object o = { m(Number offset = 0) { return offset; } };').errors).toEqual([]);

        const result = compileJs('Object o = { m(Number offset = \'x\') { return offset; } };');
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe('Cannot assign String to Number.');
    });

    test('Ignores assignments to parameter names outside their scope.', () =>
    {
        const source = [
            'Function f = (Number offset) => { return offset; };',
            'offset = 5;'
        ].join('\n');
        expect(compileJs(source).errors).toEqual([]);
    });

    test('Accepts nominal parameter types for declared names.', () =>
    {
        const source = [
            'readonly GoToNextParagraph GoToNextParagraph = { create() {} };',
            'Function run = (GoToNextParagraph target) => {',
            '    GoToNextParagraph same = target;',
            '};'
        ].join('\n');
        expect(compileJs(source).errors).toEqual([]);
    });

    test('JavaScript backend strips parameter types and adds @param tags.', () =>
    {
        const result = compileJs('/** Records a total. */\nFunction record = (Number value) => {\n};');
        expect(result.errors).toEqual([]);
        expect(result.code).toBe('/** Records a total.\n * @param {number} value\n * @type {Function}\n */\nlet record = (value) => {\n};');
    });

    test('TypeScript backend annotates parameters.', () =>
    {
        const result = LgdCompiler.create().compileToTs('Function record = (Number value, String label = "x") => {};');
        expect(result.errors).toEqual([]);
        expect(result.code).toBe('let record: Function = (value: number, label: string = "x") => {};');
    });

    test('C# backend types the lambda parameters and the delegate.', () =>
    {
        const result = LgdCompiler.create().compileToCSharp('Function record = (Number value) => {\n};');
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('Action<double> record = (double value) => {');
    });
});
