const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdAmbientTypes = require('../../../src/Compilers/LgdAmbientTypes');

/** @description Moves a declaration timestamp enough to exercise dependency invalidation deterministically. */
const timestampAdvanceMs = 1000;

/** @description Uses the exact user String.match initializer with its annotated receiver. */
const MATCH_SOURCE = 'String textLine = "a=b";\n';

describe('standard-library ambient type resolution', () =>
{
    test('resolves nullable ambient types when Windows paths reach the normalized TypeScript host', () =>
    {
        const factory = Object.create(LgdAmbientTypes);
        factory._registries = new Map();
        factory._typescript = require('typescript');
        const join = jest.spyOn(path, 'join').mockImplementation(path.win32.join);
        let registry;
        try
        {
            registry = factory.forSource();
        }
        finally
        {
            join.mockRestore();
        }

        expect(registry.resolve('RegExpMatchArray')).toEqual({ name: 'RegExpMatchArray', kind: 'interface' });
        expect(registry.resolve('Date')).toEqual({ name: 'Date', kind: 'interface' });
        const externals = new Map();
        externals.ambient = registry;
        const source = 'Date? date = null;\nRegExpMatchArray? match = "a=b".match(/=/);\n'
            + 'interface IResult {\n RegExpMatchArray? read(Date? value);\n}\n'
            + 'class Result {\n RegExpMatchArray? cached = null;\n Date? read(Date? value) { return value; }\n}\n'
            + 'Function inspect = (RegExpMatchArray? value) => value;\n'
            + 'RegExpMatchArray? asserted = (RegExpMatchArray?) opaqueCall();';
        expect(LgdCompiler.create().compileToJs(source, externals).errors).toEqual([]);
    });

    test('reads type-space names and nullable overload results from the TypeScript checker', () =>
    {
        const registry = LgdAmbientTypes.forSource();
        expect(registry.resolve('RegExpMatchArray')).toEqual({ name: 'RegExpMatchArray', kind: 'interface' });
        expect(registry.memberReturnTypes('String', 'match')).toEqual(expect.arrayContaining([ 'RegExpMatchArray', 'null' ]));
        expect(registry.resolve('Date')).toEqual({ name: 'Date', kind: 'interface' });
        expect(registry.resolve('MissingArray')).toBeNull();
        expect(registry.resolve('parseInt')).toBeNull();
        expect(LgdAmbientTypes.forSource()).toBe(registry);
        expect(registry.memberReturnTypes('Unknown', 'match')).toBeNull();
        expect(registry.memberReturnTypes('Array', 'map')).toBeNull();
    });

    test.each([ 'oloo', 'class' ])('accepts nullable String.match and diagnoses the nonnullable result in %s output', javascriptObjectModel =>
    {
        const compiler = LgdCompiler.create();
        const nullable = compiler.compileToJs(`${MATCH_SOURCE}RegExpMatchArray? match = textLine.match(/=(\\s*)/);`, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(nullable.errors).toEqual([]);
        const nonnullable = compiler.compileToJs(`${MATCH_SOURCE}RegExpMatchArray match = textLine.match(/=(\\s*)/);`, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(nonnullable.errors).toEqual([expect.objectContaining({ code: 'lgd.assignment.typeMismatch', message: 'Cannot assign null to RegExpMatchArray.' })]);
        const unknown = compiler.compileToJs(`${MATCH_SOURCE}MissingArray match = textLine.match(/=(\\s*)/);`, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(unknown.errors).toEqual([expect.objectContaining({ message: "Unknown type 'MissingArray'." })]);
    });

    test('keeps regex literal and alias types precise when the real ambient RegExp resolves', () =>
    {
        const compiler = LgdCompiler.create();
        const source = 'RegExp pattern = /=(\\s*)/;\nconst alias = /x/;\nRegExp copy = alias;';
        expect(compiler.compileToJs(source).errors).toEqual([]);
        expect(compiler.compileToJs('RegExp pattern = 42;').errors).toEqual([expect.objectContaining({ message: 'Cannot assign Number to RegExp.' })]);
        const incompatible = 'const pattern = /x/;\nString wrong = pattern;';
        expect(compiler.compileToJs(incompatible).errors).toEqual([expect.objectContaining({ message: 'Cannot assign RegExp to String.' })]);
    });

    test.each([
        'const RegExp = 42;\nNumber wrong = /x/;',
        'Number RegExp = 42;\nNumber wrong = /x/;',
        'const pattern = /x/;\nFunction read = (Number RegExp) => {\n Number wrong = pattern;\n};'
    ])('never treats an intrinsic regex result as a shadowed numeric value: %s', source =>
    {
        expect(LgdCompiler.create().compileToJs(source).errors).toEqual([expect.objectContaining({ message: 'Cannot assign Object to Number.' })]);
    });

    test('retains the conservative regex Object classification without ambient library declarations', async () =>
    {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lgd-regexp-no-lib-'));
        try
        {
            await fs.writeFile(path.join(directory, 'jsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true } }));
            const externals = new Map();
            externals.ambient = LgdAmbientTypes.forSource(path.join(directory, 'Source.lgd'));
            const source = 'const pattern = /x/;\nString wrong = pattern;';
            expect(LgdCompiler.create().compileToJs(source, externals).errors)
                .toEqual([expect.objectContaining({ message: 'Cannot assign Object to String.' })]);
        }
        finally
        {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    test('checks known ambient assignments instead of accepting every object or primitive', () =>
    {
        const compiler = LgdCompiler.create();
        expect(compiler.compileToJs('RegExpMatchArray? value = 42;').errors).toEqual([expect.objectContaining({ message: 'Cannot assign Number to RegExpMatchArray?.' })]);
        expect(compiler.compileToJs('Date value = 42;').errors).toEqual([expect.objectContaining({ message: 'Cannot assign Number to Date.' })]);
        expect(compiler.compileToJs('RegExpMatchArray? value = opaqueCall();').errors).toEqual([]);
        expect(compiler.compileToJs('Number legacy = null;').errors).toEqual([]);
        expect(compiler.compileToJs('RegExpMatchArray value = null;').errors).toEqual([expect.objectContaining({ message: 'Cannot assign null to RegExpMatchArray.' })]);
    });

    test('supports ambient fields, typed parameters, contracts, casts, and named return annotations', () =>
    {
        const source = 'interface IMatch {\n RegExpMatchArray? run(String textLine);\n}\n'
            + 'class Reader {\n RegExpMatchArray? cached = null;\n RegExpMatchArray? run(String textLine) { return textLine.match(/=/); }\n}\n'
            + 'Function read = (RegExpMatchArray? value) => value;\nRegExpMatchArray? asserted = (RegExpMatchArray?) opaqueCall();';
        expect(LgdCompiler.create().compileToJs(source).errors.filter(error => error.severity !== 'warning')).toEqual([]);
    });

    test('does not assume unknown or overwritten receivers use native String.match', () =>
    {
        const compiler = LgdCompiler.create();
        expect(compiler.compileToJs('Object textLine = { match() { return 1; } };\nRegExpMatchArray match = textLine.match(/=/);').errors).toEqual([]);
        const mutated = `${MATCH_SOURCE}String.prototype.match = replacement;\nRegExpMatchArray match = textLine.match(/=/);`;
        expect(compiler.compileToJs(mutated).errors).toEqual([]);
        expect(compiler.compileToJs('String textLine = opaqueCall();\nRegExpMatchArray match = textLine.match(/=/);').errors).toEqual([]);
    });

    test('resolves only explicit imports and refreshes edited or newly available declaration files', async () =>
    {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lgd-ambient-imports-'));
        const filename = path.join(directory, 'Types.d.ts');
        const sourcePath = path.join(directory, 'Source.lgd');
        const imports = [ { name: 'Alias', importedName: 'Result', spec: './Types' }, { name: 'types', importedName: '*', spec: './Types' } ];
        try
        {
            const missing = LgdAmbientTypes.forSource(sourcePath, imports);
            expect(missing.resolve('Alias')).toBeNull();
            await fs.writeFile(filename, 'export class Result {}\nexport interface IResult {}');
            const known = LgdAmbientTypes.forSource(sourcePath, imports);
            expect(known.resolve('Alias')).toEqual({ name: 'Alias', kind: 'class' });
            expect(known.resolve('types.IResult')).toEqual({ name: 'types.IResult', kind: 'interface' });
            expect(known.completions('types').map(symbol => symbol.name)).toEqual([ 'Result', 'IResult' ]);
            expect(LgdAmbientTypes.forSource(sourcePath, imports)).toBe(known);
            await fs.writeFile(filename, 'export class Result {}\nexport interface IChanged {}');
            const modified = new Date(Date.now() + timestampAdvanceMs);
            await fs.utimes(filename, modified, modified);
            const changed = LgdAmbientTypes.forSource(sourcePath, imports);
            expect(changed).not.toBe(known);
            expect(changed.resolve('types.IResult')).toBeNull();
            expect(changed.resolve('types.IChanged')).toEqual({ name: 'types.IChanged', kind: 'interface' });
        }
        finally
        {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    test('assigns a narrowed match array to a typed string array through the actual library relationship', () =>
    {
        expect(LgdAmbientTypes.forSource().assignable('String[]', 'RegExpMatchArray')).toBe(true);
        const source = `${MATCH_SOURCE}RegExpMatchArray? match = textLine.match(/=/);\nif(match !== null) {\n String[] values = match;\n}`;
        expect(LgdCompiler.create().compileToJs(source).errors).toEqual([]);
    });

    test('honors explicit project libraries and caches library configurations separately', async () =>
    {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lgd-ambient-'));
        try
        {
            await fs.writeFile(path.join(directory, 'jsconfig.json'), JSON.stringify({ compilerOptions: { lib: ['es2022'], types: [] } }));
            const server = LgdAmbientTypes.forSource(path.join(directory, 'source.lgd'));
            expect(server.resolve('HTMLElement')).toBeNull();
            await fs.writeFile(path.join(directory, 'jsconfig.json'), JSON.stringify({ compilerOptions: { lib: [ 'es2022', 'dom' ], types: [] } }));
            const browser = LgdAmbientTypes.forSource(path.join(directory, 'source.lgd'));
            expect(browser.resolve('HTMLElement')).toEqual({ name: 'HTMLElement', kind: 'interface' });
            expect(browser).not.toBe(server);
            await fs.writeFile(path.join(directory, 'jsconfig.json'), JSON.stringify({ compilerOptions: { target: 'es5' } }));
            const legacy = LgdAmbientTypes.forSource(path.join(directory, 'source.lgd'));
            expect(legacy.resolve('Map')).toBeNull();
            expect(legacy.resolve('RegExpMatchArray')).not.toBeNull();
            expect(legacy.resolve('HTMLElement')).toBeNull();
            await fs.writeFile(path.join(directory, 'jsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true } }));
            expect(LgdAmbientTypes.forSource(path.join(directory, 'source.lgd')).resolve('RegExpMatchArray')).toBeNull();
        }
        finally
        {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });
});
