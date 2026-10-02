const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');

/** @description Checks only the generated JavaScript using the selected TypeScript version. */
function diagnostics(moduleName, source)
{
    const typescript = require(moduleName);

    const filename = '/tmp/lgd-interface-types.js';
    const options = { allowJs: true, checkJs: true, noEmit: true, strict: true, skipLibCheck: true, types: [] };
    const host = typescript.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion) =>
    {
        if(name === filename)
        {
            return typescript.createSourceFile(name, source, languageVersion, true, typescript.ScriptKind.JS);
        }

        return getSourceFile(name, languageVersion);
    };

    const program = typescript.createProgram([filename], options, host);
    return program.getSemanticDiagnostics().map(diagnostic => typescript.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
}

describe('editor-only interface type evidence', () =>
{
    test.each([ 'typescript-test-5-0', 'typescript-test-5-9', 'typescript-test-6-0' ])('preserves local method and property contracts for %s', moduleName =>
    {
        const source = [
            'interface ILabel { String label(Number count); String name { get; set; } }',
            'class Reader { String read(ILabel item) { return item.label(1) + item.name; } }',
            'Reader.read({ label(count) { return String(count); }, name: "ready" });'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('@typedef');
        expect(diagnostics(moduleName, result.code)).toEqual([]);
        const wrong = result.code.replace('item.label(1)', 'item.label("wrong")');
        expect(diagnostics(moduleName, wrong)).toEqual([expect.stringContaining("not assignable to parameter of type 'number'")]);
    });

    test('flattens imported interface aliases without leaving runtime imports or module markers', () =>
    {
        const externals = new Map([[ './IRun.js', { kind: 'interface', contractKind: 'interface', keyword: 'Object',
            contractsKnown: true, methodsKnown: true, methodSignatures: [], contractSignatures: [
                { name: 'run', kind: 'method', params: [{ name: 'count', typeName: 'Number' }], returnTypeName: 'String' }
            ] } ]]);
        const source = 'const Contract = require("./IRun.js");\nclass Reader { String read(Contract item) { return item.run(1); } }';
        const result = LgdCompiler.create().compileToJs(source, externals);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('@typedef {{run: (count: number) => string}} Contract');
        expect(result.code).not.toContain('require(');
        expect(diagnostics('typescript-test-5-9', result.code)).toEqual([]);
    });

    test('retains inherited, optional and rest method contracts and source mappings', () =>
    {
        const source = [
            'interface IBase { String label(Number count = 1); }',
            'interface ILabels : IBase { Number count(...String labels); }',
            'class Reader { String read(ILabels item) { item.count("one", "two"); return item.label(); } }'
        ].join('\r\n');
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(diagnostics('typescript-test-5-9', result.code)).toEqual([]);
        expect(result.code).toContain('label: (count?: number) => string');
        expect(result.code).toContain('count: (...labels: string[]) => number');
        const map = LgdSourceMap.create(result.mappings);
        const offset = source.indexOf('item.count');
        expect(result.code.slice(map.toOutput(offset), map.toOutput(offset) + 'item.count'.length)).toBe('item.count');
        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
    });

    test('preserves getter-only readonly shapes and unions complementary inherited accessors', () =>
    {
        const source = [
            'interface IRead { String name { get; } }',
            'interface IWrite { String name { set; } }',
            'interface IBoth : IWrite, IRead {}',
            'class Reader { void write(IBoth item) { item.name = "ready"; } }'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('@typedef {{readonly name: string}} IRead');
        expect(result.code).toContain('@typedef {{name: string}} IBoth');
        expect(diagnostics('typescript-test-5-9', result.code)).toEqual([]);
        expect(diagnostics('typescript-test-5-9', result.code.replace('@param {IBoth}', '@param {IRead}'))).toEqual([expect.stringContaining('read-only property')]);
    });

    test('keeps equal interface names in their own lexical scopes', () =>
    {
        const source = [
            'function one() {',
            '    interface IValue { Number value(); }',
            '    class Reader { Number read(IValue item) { return item.value(); } }',
            '    return Reader;',
            '}',
            'function two() {',
            '    interface IValue { String value(); }',
            '    class Reader { String read(IValue item) { return item.value(); } }',
            '    return Reader;',
            '}'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(diagnostics('typescript-test-5-9', result.code)).toEqual([]);
    });
});
