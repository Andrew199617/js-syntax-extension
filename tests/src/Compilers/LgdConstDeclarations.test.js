const nodeVm = require('vm');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');

/** @description Compiles variable fixtures with either supported JavaScript object model. */
function compile(source, javascriptObjectModel = 'oloo')
{
    return LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
}

describe('LGD immutable variable declarations', () =>
{
    test.each([ 'oloo', 'class' ])('accepts the screenshot typed const locals with %s output', mode =>
    {
        const source = [
            'const Object vscode = require("vscode");',
            'class BaseCommand { BaseCommand(String command, String title) {} virtual async executeCommand() {} }',
            'class GoToAssignment : BaseCommand {',
            '    GoToAssignment() : base("lgd.goToAssignment", "Go To Assignment") {}',
            '    async override executeCommand() {',
            '        const Object editor = vscode.window.activeTextEditor;',
            '        if(!editor) { return; }',
            '        const Object document = editor.document;',
            '        const Object position = editor.selection.active;',
            '        const String textLine = document.lineAt(position.line).text;',
            '        Object match = textLine.match(/=(\\s*)/);',
            '        if(!match) { return; }',
            '        Number assignmentIndex = match.index + match[0].length;',
            '        if(assignmentIndex !== -1) {',
            '            const Object newPosition = new vscode.Position(position.line, assignmentIndex);',
            '            editor.selection = new vscode.Selection(newPosition, newPosition);',
            '            editor.revealRange(new vscode.Range(newPosition, newPosition));',
            '        }',
            '    }',
            '}'
        ].join('\r\n');
        const result = compile(source, mode);
        expect(result.errors).toEqual([]);
        const map = LgdSourceMap.create(result.mappings);
        for(const name of [ 'editor', 'document', 'position', 'textLine', 'newPosition' ])
        {
            const declaration = result.allDeclarations.find(candidate => candidate.name === name);
            expect(declaration).toMatchObject({ readonly: true, bindingKind: 'const' });
            const mapped = map.toOutput(declaration.nameStart);
            expect(result.code.slice(mapped, mapped + name.length)).toBe(name);
            expect(map.toSource(mapped)).toBe(declaration.nameStart);
        }

        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
    });

    test.each([ 'oloo', 'class' ])('keeps runtime initializers and mutable object contents with %s output', mode =>
    {
        const source = [
            'class Counter {',
            '    Number read() {',
            '        const Object value = { count: 1 };',
            '        value.count++;',
            '        const count = value.count;',
            '        return count;',
            '    }',
            '}',
            'globalThis.result = Counter.create().read();'
        ].join('\n');
        const result = compile(source, mode);
        expect(result.errors).toEqual([]);
        const context = {};
        nodeVm.runInNewContext(result.code, context);
        expect(context.result).toBe(2);
    });

    test.each([ 'value = 2;', 'value += 1;', 'value++;', '[value] = [2];', '({ value } = { value: 2 });' ])('rejects typed and inferred constant writes: %s', statement =>
    {
        for(const head of [ 'const Number value = 1;', 'const value = 1;' ])
        {
            const result = compile(`${head}\n${statement}`);
            expect(result.errors.map(error => error.message)).toEqual(["Cannot assign to const variable 'value'."]);
        }
    });

    test('checks typed initializers and keeps mutable shadowed bindings independent', () =>
    {
        expect(compile('const Number value = "wrong";').errors.map(error => error.message)).toEqual(['Cannot assign String to Number.']);
        expect(compile('const Number value = 1;\n{\n Number value = 2;\n value++;\n}').errors).toEqual([]);
        expect(compile('const Config = {};\nconst { value } = { value: 1 };\nconst [first] = [1];').errors).toEqual([]);
    });

    test.each([ 'const Config\n = {};', 'export const Config\r\n = {};', 'const Config /* keep */\n = {};', 'export const Config /* multiline\n note */ = {};' ])('leaves inferred capitalized bindings valid across line breaks: %s', source =>
    {
        const result = compile(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toBe(source);
    });

    test('preserves exports, qualified nullable annotations, and TypeScript const output', () =>
    {
        const source = 'const vscode = require("vscode");\nexport const vscode.Position? position = null;';
        const result = LgdCompiler.create().compileToTs(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('export const position: vscode.Position | null = null;');
        expect(compile('const Number initial = compute();').errors).toEqual([]);
    });

    test('warns only on old variable syntax while preserving the compiled output and other errors', () =>
    {
        const source = '/** readonly Number example = 1; */\nexport readonly Number value = 1;\nvalue = 2;';
        const result = compile(source);
        const [ warning, assignment ] = result.errors;
        expect(warning).toMatchObject({ code: 'lgd.declaration.readonly', severity: 'warning',
            quickFix: { kind: 'replaceReadonlyLocal' } });
        expect(source.slice(warning.offset, warning.endOffset)).toBe('readonly');
        expect(assignment.message).toBe("Cannot assign to const variable 'value'.");
        expect(result.code).toContain('export const value = 1;');
    });

    test('never migrates readonly member syntax and preserves getter-only contracts', () =>
    {
        const source = 'class Sample {\n    readonly Number value = 1;\n}';
        const field = compile(source);
        expect(field.errors).toEqual([]);
        expect(field.declarations[0].classMembers[0]).toMatchObject({ kind: 'field', readonly: true });
        const contract = compile('interface IRead { Number value { get; } }');
        expect(contract.errors).toEqual([]);
        expect(contract.code).toContain('readonly value: number');
    });
});
