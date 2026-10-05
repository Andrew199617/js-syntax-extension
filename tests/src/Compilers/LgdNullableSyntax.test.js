const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const { parseTypedParams, parseMethodHead } = require('../../../src/Compilers/LgdTypedParams');
const { parseTypeName, toTsType } = require('../../../src/Compilers/LgdTypeMaps');

/** @description Parses syntax without running independent expression type analysis. */
function parse(source)
{
    return LgdCompiler.create().parse(source, new Map(), { deferAnalysis: true });
}

describe('Nullable LGD type syntax.', () =>
{
    test.each([ 'Number?', 'Position?', 'vscode.Position?', 'vscode.editor.Position?' ])('Preserves the exact %s token and span.', typeName =>
    {
        const method = `${typeName} find(${typeName} position = null) { return position; }`;
        const head = parseMethodHead(method);
        const parameters = parseTypedParams(method.slice(head.paramStart));
        expect(head.returnTypeName).toBe(typeName);
        expect(method.slice(head.returnTypeStart, head.returnTypeEnd)).toBe(typeName);
        const parameter = parameters.params[0];
        expect(parameter.typeName).toBe(typeName);
        expect(method.slice(head.paramStart + parameter.typeStart, head.paramStart + parameter.typeEnd)).toBe(typeName);
        expect(parameter.defaultText).toBe('null');
    });

    test.each([ 'void?', 'Number??', 'vscode..Position?', 'vscode.Position?.' ])('Does not accept malformed or unsupported nullable type %s as a full method annotation.', typeName =>
    {
        expect(parseMethodHead(`${typeName} find() {}`)).toBeNull();
    });

    test('Rejects void as a nullable property value type.', () =>
    {
        expect(parse('interface Invalid { void? value { get; } }').errors).toEqual([expect.objectContaining({
            message: 'A property contract must have a value type and cannot explicitly be virtual.'
        })]);
    });

    test('Keeps typed comments and source offsets around nullable parameter annotations.', () =>
    {
        const source = '(/* first */ vscode.Position? /* next */ position = null)';
        const parameter = parseTypedParams(source).params[0];
        expect(parameter.typeName).toBe('vscode.Position?');
        expect(source.slice(parameter.typeStart, parameter.typeEnd)).toBe('vscode.Position?');
    });

    test('Parses nullable declarations, fields and interface contracts with complete type ranges.', () =>
    {
        const source = [
            "const Object vscode = require('vscode');",
            'vscode.Position? current = null;',
            'interface PositionSource { vscode.Position? position { get; set; } vscode.Position? find(vscode.Position? start); }',
            'class PositionStore { vscode.Position? position = null; static Number? count; }'
        ].join('\n');
        const result = parse(source);
        expect(result.errors).toEqual([]);
        const current = result.allDeclarations.find(declaration => declaration.name === 'current');
        expect(source.slice(current.typeStart, current.typeEnd)).toBe('vscode.Position?');
        const store = result.allDeclarations.find(declaration => declaration.name === 'PositionStore');
        expect(store.classMembers.map(member => member.propertyTypeName)).toEqual([ 'vscode.Position?', 'Number?' ]);
        const contract = result.allDeclarations.find(declaration => declaration.name === 'PositionSource');
        expect(contract.classMembers[0].propertyTypeName).toBe('vscode.Position?');
        expect(contract.classMembers[1].returnTypeName).toBe('vscode.Position?');
    });

    test('Leaves ternary and optional-chain expressions untouched.', () =>
    {
        const source = 'const position = ready ? vscode.Position : null;\nconst line = position?.line;';
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toBe(source);
    });

    test('Maps nullable types to null-only unions without changing their named component.', () =>
    {
        expect(toTsType('Number?')).toBe('number | null');
        expect(toTsType('vscode.Position?')).toBe('vscode.Position | null');
        expect(parseTypeName('vscode.Position?', 0)).toMatchObject({ baseTypeName: 'vscode.Position', nullable: true, end: 16 });
    });
});
