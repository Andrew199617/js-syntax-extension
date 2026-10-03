const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdContractChecker = require('../../../src/Compilers/LgdContractChecker');
const LgdOverrideChecker = require('../../../src/Compilers/LgdOverrideChecker');

/** @description Builds imported contract metadata through the same compiler path used for sibling files. */
function exportedContract(source, name)
{
    const parsed = LgdCompiler.create().parse(source);
    expect(parsed.errors).toEqual([]);
    const declaration = parsed.allDeclarations.find(candidate => candidate.name === name);
    return { exportName: name, keyword: 'Object', kind: declaration.kind,
        ...LgdOverrideChecker.describeMethods(source, parsed.allDeclarations, declaration),
        ...LgdContractChecker.describeContracts(source, parsed.allDeclarations, declaration) };
}

describe.each([ 'oloo', 'class' ])('LGD erased return type scope in %s output.', javascriptObjectModel =>
{
    test.each([
        'interface IReader {}\nclass Reader { IReader echo(IReader value) { return value; } }',
        'Function createReader = () => {\ninterface IReader {}\nclass Reader { IReader echo(IReader value) { return value; } }\n};',
        'interface IReader {}\nFunction sibling = () => {\nString IReader = "unrelated";\n};\nclass Reader { IReader echo(IReader value) { return value; } }',
        'interface IReader {}\nclass Reader { IReader echo(IReader value) { const IReader = 1; return value; } }',
        'interface IReader {}\nclass Reader { IReader echo(IReader) { return IReader; } }',
        'interface IReader {}\nabstract class Base { abstract IReader echo(IReader value); }\nclass Reader : Base { override echo(IReader) { return IReader; } }',
        'Number Count = 1;\nclass Reader { Count echo(Count value) { const Count = 1; return value; } }'
    ])('Retains visible compile-time interface names: %s.', source =>
    {
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors).toEqual([]);
    });

    test('Checks nominal parameters against their annotation scope rather than body-local names.', () =>
    {
        const source = 'class Token {}\nclass Reader { write(Token value) { const Token = 1; value = "wrong"; } }';
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors).toEqual([expect.objectContaining({ message: 'Cannot assign String to Token.' })]);
    });

    test('Keeps copied dotted parameter types compatible with themselves.', () =>
    {
        const source = 'const vscode = require("vscode");\nFunction copy = (vscode.Uri value) => {\n'
            + 'vscode.Uri copied = value;\n};';
        expect(LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel }).errors).toEqual([]);
    });

    test('Keeps primitive markers distinct from same-named declared values.', () =>
    {
        const source = 'String Number = "prefix";\nString label = Number + 1;\nNumber count = 1;';
        expect(LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel }).errors).toEqual([]);
    });

    test('Does not leak an interface type out of a sibling function.', () =>
    {
        const source = 'Function sibling = () => {\ninterface IReader {}\n};\n'
            + 'class Reader { IReader echo(IReader value) { return value; } }';
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors.some(error => error.message.includes("Unknown return type 'IReader'"))).toBe(true);
    });

    test('Does not borrow an erased type through an enclosing untyped parameter shadow.', () =>
    {
        const source = 'interface IReader {}\nfunction factory(IReader) {\n'
            + 'class Reader { IReader echo(IReader value) { return value; } }\n}';
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors.some(error => error.message.includes("Unknown return type 'IReader'"))).toBe(true);
    });

    test('Still rejects a known primitive returned from a visible interface contract.', () =>
    {
        const source = 'interface IReader {}\nclass Reader { IReader echo() { return 1; } }';
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors).toEqual([expect.objectContaining({ message: 'Cannot return Number from a IReader method.' })]);
    });

    test.each([
        'Object IReader = require("./IReader.js");\nclass Reader { IReader echo(IReader value) { return value; } }',
        'Object Alias = require("./IReader.js");\nclass Reader { Alias echo(Alias value) { return value; } }',
        'const Alias = require("./IReader.js");\nclass Reader { Alias echo(Alias value) { return value; } }',
        'function factory() {\nObject Alias = require("./IReader.js");\nclass Reader { Alias echo(Alias value) { return value; } }\n}'
    ])('Retains erased imported interface names and aliases: %s.', source =>
    {
        const externals = new Map([[ './IReader.js', exportedContract('interface IReader {}', 'IReader') ]]);
        const result = LgdCompiler.create().compileToJs(source, externals, { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors).toEqual([]);
        expect(result.code).not.toContain('require("./IReader.js")');
    });

    test.each([ 'value', 'renamed', 'IReader' ])('Retains cross-file inherited interface signatures with parameter %s.', parameter =>
    {
        const baseSource = 'interface IReader {}\nabstract class Base { abstract IReader echo(IReader value); }';
        const externals = new Map([[ './Base.js', exportedContract(baseSource, 'Base') ]]);
        const source = 'const Parent = require("./Base.js");\n'
            + `class Reader : Parent { override echo(${parameter}) { return ${parameter}; } }`;
        const result = LgdCompiler.create().compileToJs(source, externals, { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors).toEqual([]);
    });

    test.each([
        'function sibling() {\nObject Alias = require("./IReader.js");\n}\nclass Reader { Alias echo(Alias value) { return value; } }',
        'Object Alias = require("./IReader.js");\nfunction factory(Alias) {\nclass Reader { Alias echo(Alias value) { return value; } }\n}'
    ])('Does not borrow an imported alias from a sibling or through an enclosing parameter: %s.', source =>
    {
        const externals = new Map([[ './IReader.js', exportedContract('interface IReader {}', 'IReader') ]]);
        const result = LgdCompiler.create().compileToJs(source, externals, { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors.some(error => error.message.includes("Unknown return type 'Alias'"))).toBe(true);
    });
});
