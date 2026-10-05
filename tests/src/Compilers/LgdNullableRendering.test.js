const path = require('path');
const typescript = require('typescript-test-5-9');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');

/** @description Opens the emitted mirror in TypeScript with strict null checking and real vscode declarations. */
function createTypeService(code)
{
    const filename = path.join(__dirname, '../../fixtures/nullable-hover.js').replaceAll('\\', '/');
    const options = { allowJs: true, checkJs: true, strictNullChecks: true, declaration: true, emitDeclarationOnly: true,
        skipLibCheck: true, types: [], target: typescript.ScriptTarget.ES2020, module: typescript.ModuleKind.CommonJS };
    const host = {
        getScriptFileNames: () => [filename],
        getScriptVersion: () => '0',

        /** @description Loads the mirror or an installed TypeScript declaration snapshot. */
        getScriptSnapshot: file =>
        {
            const source = file === filename ? code : typescript.sys.readFile(file);
            return source === undefined ? undefined : typescript.ScriptSnapshot.fromString(source);
        },
        getCurrentDirectory: () => path.resolve(__dirname, '../../..'),
        getCompilationSettings: () => options,
        getDefaultLibFileName: settings => typescript.getDefaultLibFilePath(settings),
        fileExists: typescript.sys.fileExists,
        readFile: typescript.sys.readFile,
        readDirectory: typescript.sys.readDirectory
    };

    return { service: typescript.createLanguageService(host), filename: filename };
}

describe('LGD nullable output types', () =>
{
    test.each([ 'oloo', 'class' ])('retains qualified nullable types in real TypeScript hovers and declarations with %s output', javascriptObjectModel =>
    {
        const source = [
            'const vscode = require("vscode");',
            'class Search {',
            '    vscode.Position? previous = null;',
            '    static Number? count = null;',
            '    Search(vscode.Position? initial) { this.previous = initial; }',
            '    vscode.Position? findPreviousChar(vscode.Position? position) { return position; }',
            '}',
            'module.exports = Search;'
        ].join('\r\n');
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('@param {vscode.Position | null} position');
        expect(result.code).toContain('@returns {vscode.Position | null}');
        expect(result.code).toContain('@type {number | null}');
        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
        const map = LgdSourceMap.create(result.mappings);
        const { service, filename } = createTypeService(result.code);
        try
        {
            const expectations = [
                [ 'findPreviousChar(', 'findPreviousChar(position: vscode.Position | null): vscode.Position | null' ],
                [ 'position)', '(parameter) position: vscode.Position | null' ],
                [ 'initial)', '(parameter) initial: vscode.Position | null' ]
            ];
            for(const [ symbol, expected ] of expectations)
            {
                const offset = map.toOutput(source.indexOf(symbol));
                const info = service.getQuickInfoAtPosition(filename, offset);
                expect(info).toBeDefined();
                expect(typescript.displayPartsToString(info.displayParts)).toContain(expected);
                expect(map.toSource(offset)).toBe(source.indexOf(symbol));
            }

            expect(service.getSyntacticDiagnostics(filename)).toEqual([]);
            const messages = service.getSemanticDiagnostics(filename).map(diagnostic => typescript.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
            expect(messages).toEqual([]);
            const emitted = service.getEmitOutput(filename).outputFiles.find(file => file.name.endsWith('.d.ts'));
            expect(emitted.text).toContain('vscode.Position | null');
            expect(emitted.text).not.toContain('vscode.Position | null | undefined');
        }
        finally
        {
            service.dispose();
        }
    });

    test('renders unions and nullable rest elements in TypeScript output', () =>
    {
        const source = 'const vscode = require("vscode");\nvscode.Position? position = null;\nObject Search = { Number? read(...Number? values) { return null; } };';
        const result = LgdCompiler.create().compileToTs(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('let position: vscode.Position | null = null;');
        expect(result.code).toContain('read(...values: (number | null)[]): number | null');
    });

    test('renders nullable rest elements in interface, constructor and function documentation', () =>
    {
        const source = [
            'interface IReader { Number? read(...Number? values); String? label { get; } }',
            'class Reader { Reader(...Number? values) {} Number? read(...Number? values) { return null; } }',
            'Function read = (...Number? values) => null;'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('read: (...values: (number | null)[]) => number | null');
        expect(result.code).toContain('readonly label: string | null');
        expect(result.code).toContain('@param {[...values: (number | null)[]]}');
        const restSignatures = 3;
        expect(result.code.match(/@param {\.\.\.\(number \| null\)} values/g)).toHaveLength(restSignatures);
        const { service, filename } = createTypeService(result.code);
        try
        {
            const messages = service.getSemanticDiagnostics(filename).map(diagnostic => typescript.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
            expect(messages).toEqual([]);
        }
        finally
        {
            service.dispose();
        }
    });
});

describe('LGD postfix array mirror fidelity', () =>
{
    test.each([ 'oloo', 'class' ])('Preserves array hover, indexed element inference, native member completion and declarations with %s output.', javascriptObjectModel =>
    {
        const source = [
            'class Reader {',
            '    String[] read(String[] values) {',
            '        const string[] lines = values;',
            '        const string first = lines[0];',
            '        lines.push(first);',
            '        return lines;',
            '    }',
            '}',
            'module.exports = Reader;'
        ].join('\r\n');
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
        expect(result.errors).toEqual([]);
        const map = LgdSourceMap.create(result.mappings);
        const { service, filename } = createTypeService(result.code);
        try
        {
            for(const [ word, expected ] of [ [ 'read(', 'read(values: string[]): string[]' ], [ 'lines =', 'lines: string[]' ], [ 'first =', 'first: string' ] ])
            {
                const offset = map.toOutput(source.indexOf(word));
                const info = service.getQuickInfoAtPosition(filename, offset);
                expect(typescript.displayPartsToString(info.displayParts)).toContain(expected);
                expect(map.toSource(offset)).toBe(source.indexOf(word));
            }

            const member = map.toOutput(source.indexOf('lines.push') + 'lines.'.length);
            const completions = service.getCompletionsAtPosition(filename, member, {});
            expect(completions.entries.map(entry => entry.name)).toEqual(expect.arrayContaining([ 'push', 'length', 'map' ]));
            expect(service.getSyntacticDiagnostics(filename)).toEqual([]);
            expect(service.getSemanticDiagnostics(filename)).toEqual([]);
            const declarations = service.getEmitOutput(filename).outputFiles.find(file => file.name.endsWith('.d.ts'));
            expect(declarations.text).toContain('read(values: string[]): string[]');
        }
        finally
        {
            service.dispose();
        }
    });
});
