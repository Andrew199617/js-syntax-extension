const fs = require('fs');
const path = require('path');
const virtualMachine = require('vm');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const { parseTypeName, toTsType, rootTypeName, elementTypeName, canonicalTypeName, visitType, sameTypeShape } = require('../../../src/Compilers/LgdTypeMaps');

/** @description Compiles the same syntax under each accepted JavaScript object model. */
function compile(source, javascriptObjectModel)
{
    return LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: javascriptObjectModel });
}

describe('Structural LGD array annotations', () =>
{
    test.each([
        [ 'string[]', 'string[]', 'String', 'String' ],
        [ 'Number[][]', 'number[][]', 'Number', 'Number[]' ],
        [ 'String[]?', 'string[] | null', 'String', 'String' ],
        [ 'String?[]', '(string | null)[]', 'String', 'String?' ],
        [ 'Item?[][]?', '(Item | null)[][] | null', 'Item', 'Item?[]' ],
        [ 'vscode.Position[]', 'vscode.Position[]', 'vscode.Position', 'vscode.Position' ],
        [ 'vscode.Position?[]', '(vscode.Position | null)[]', 'vscode.Position', 'vscode.Position?' ]
    ])('Retains the structure, source spelling and correct rendering of %s.', (type, output, root, element) =>
    {
        const parsed = parseTypeName(`  ${type} value`, 2);
        expect(parsed).toMatchObject({ typeName: type, start: 2, end: type.length + 2 });
        expect(toTsType(type)).toBe(output);
        expect(rootTypeName(type)).toBe(root);
        expect(elementTypeName(type)).toBe(element);
        expect(canonicalTypeName(type)).toBe(type.replace(/^string/, 'String'));
        const nodes = [];
        visitType(parsed.annotation, node => nodes.push(node.kind));
        expect(nodes.at(-1)).toBe('named');
        expect(nodes).toContain('array');
    });

    test('Compares container shape separately from nominal leaf identities.', () =>
    {
        expect(sameTypeShape('First?[][]?', 'Second?[][]?')).toBe(true);
        expect(sameTypeShape('First?[]', 'First[]?')).toBe(false);
        expect(sameTypeShape('First[]', 'First[][]')).toBe(false);
        const visited = [];
        visitType({ kind: 'named', name: 'Future', typeArguments: [{ kind: 'named', name: 'Item' }] }, node => visited.push(node.name));
        expect(visited).toEqual([ 'Future', 'Item' ]);
    });

    test.each([ 'Number[', 'Number]', 'Number[3]', 'Number??[]', 'void[]', 'Array<String>', 'String|Number', '(String|Number)[]' ])('Rejects unsupported %s instead of partially consuming a type.', type =>
    {
        expect(parseTypeName(type)).toBeNull();
    });
});

describe.each([ 'oloo', 'class' ])('Postfix array checking with %s JavaScript output.', objectModel =>
{
    test('Compiles and executes the exact user example while preserving Array APIs and ordinary lowercase bindings.', () =>
    {
        const ordinaryNumber = 4;
        const source = [
            'const document = { getText() { return "first\\nsecond"; } };',
            "const string[] lines = document.getText().split('\\n');",
            'let number[] lengths = [lines.length];',
            'lengths[0] = 2;',
            'const string = "ordinary";',
            `let number = ${ordinaryNumber};`,
            'Array legacy = new Array(1);',
            'const result = [lines, lengths, string, number, Array.isArray(lines), legacy.length];'
        ].join('\r\n');
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('@type {string[]}');
        expect(result.code).toContain('@type {number[]}');
        expect(result.code).toContain('@type {any[]}');
        expect(result.code).toContain('const string = "ordinary";');
        expect(result.code).toContain(`let number = ${ordinaryNumber};`);
        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
        expect(virtualMachine.runInNewContext(`${result.code}\nresult;`)).toEqual([ [ 'first', 'second' ], [2], 'ordinary', ordinaryNumber, true, 1 ]);
    });

    test('Compiles fields, local const/let bindings, params, returns and nullable/nested arrays from the native fixture.', async () =>
    {
        const source = await fs.promises.readFile(path.join(__dirname, '../../fixtures/postfix-array-types.lgd'), 'utf8');
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('@param {string[]} lines');
        expect(result.code).toContain('@returns {number[]}');
        expect(result.code).toContain('@type {(string | null)[]}');
        expect(result.code).toContain('@type {string[][]}');
        expect(result.code).toContain('@type {string[] | null}');
        const lines = result.allDeclarations.find(declaration => declaration.name === 'lines');
        expect(source.slice(lines.typeStart, lines.typeEnd)).toBe('string[]');
    });

    test('Accepts inline locals, comments, array rest parameters and nullable element literals.', () =>
    {
        const source = [
            'class Reader { String[] read(/* keep */ String[] /* name */ values) { const string[] copy = values; let string[] next = copy; return next; } }',
            'Function first = (...Number[] groups) => groups[0][0];',
            'Number?[] optional = [1, null];',
            'String[][] nested = [["one"], []];',
            'Number[] spread = [...[1, 2]];'
        ].join('\n');
        expect(compile(source, objectModel).errors).toEqual([]);
    });

    test.each([
        [ 'String[] values = [1];', 'Cannot assign Number[] to String[]' ],
        [ 'Number[] values = [1];\nvalues = ["wrong"];', 'Cannot assign String[] to Number[]' ],
        [ 'Number[] values = [1];\nvalues[0] = "wrong";', 'Cannot assign String to Number array element' ],
        [ 'String[][] values = [["one"]];\nvalues[0][0] = 3;', 'Cannot assign Number to String array element' ],
        [ 'Number[] values = [1];\nString wrong = values[0];', 'Cannot assign Number to String' ],
        [ 'Number[] values = [1];\nString wrong = values.length;', 'Cannot assign Number to String' ],
        [ 'class Store { Number[] values = ["wrong"]; }', "Cannot assign String[] to Number[] member 'values'" ],
        [ 'class Store { Number[] read(Number[] values = ["wrong"]) { return values; } }', 'Cannot assign String[] to Number[]' ],
        [ 'class Store { String[] read() { return [1]; } }', 'Cannot return Number[] from a String[] method' ],
        [ 'String[][] nested = [[1]];', 'Cannot assign Number[][] to String[][]' ],
        [ 'const String[] values = [];\nvalues = [];', "Cannot assign to const variable 'values'" ],
        [ 'Missing[] values = [];', "Unknown type 'Missing'" ]
    ])('Checks concrete element contracts: %s', (source, message) =>
    {
        expect(compile(source, objectModel).errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining(message) })]));
    });

    test('Creates independent empty defaults for nonnullable array fields and null defaults only for nullable containers.', () =>
    {
        const source = 'class Store { String[] labels; Number[][] rows; String[]? cached; }';
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        const Store = virtualMachine.runInNewContext(`${result.code}\nStore;`);
        const first = Store.create();
        const second = Store.create();
        expect(first.labels).toEqual([]);
        expect(first.rows).toEqual([]);
        expect(first.cached).toBeNull();
        first.labels.push('first');
        expect(second.labels).toEqual([]);
    });

    test('Keeps new array nullability precise while retaining legacy bare Array assignment behavior.', () =>
    {
        const accepted = 'String[]? cached = null;\nString?[] values = ["one", null];\nArray legacy = null;';
        expect(compile(accepted, objectModel).errors).toEqual([]);
        for(const source of [ 'String[] values = null;', 'String[]? values = undefined;', 'String[] values = [null];', 'String[]? cached = null;\nString[] values = cached;' ])
        {
            expect(compile(source, objectModel).errors.some(error => error.code === 'lgd.assignment.typeMismatch')).toBe(true);
        }

        expect(compile('class Store { String[] read() { return null; } }', objectModel).errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'lgd.return.typeMismatch' })
        ]));
    });

    test('Keeps mutable element contracts invariant while allowing fresh nullable element literals.', () =>
    {
        expect(compile('Number?[] values = [1];', objectModel).errors).toEqual([]);
        const source = 'Number[] narrow = [1];\nNumber?[] wide = narrow;';
        expect(compile(source, objectModel).errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.assignment.typeMismatch' })]));
    });

    test('Resolves nominal array elements, nested indexes and member types without assigning class members to the array itself.', () =>
    {
        const source = [
            'class Item { Number score = 1; }',
            'Item[][] rows = [[Item.create()]];',
            'Number index = 0;',
            'Number score = rows[index][0].score;',
            'String wrong = rows[index][0].score;'
        ].join('\n');
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([expect.objectContaining({ message: 'Cannot assign Number to String.' })]);
        expect(compile(source.replace('String wrong', 'Number wrong'), objectModel).errors).toEqual([]);
    });

    test('Retains nominal element identity when indexing an annotated method result directly.', () =>
    {
        const source = [
            'class Item { Number score = 1; }',
            'class Reader { Item[] read() { return [Item.create()]; } }',
            'Reader reader = Reader.create();',
            'String wrong = reader.read()[0].score;'
        ].join('\n');
        expect(compile(source, objectModel).errors).toEqual([expect.objectContaining({ message: 'Cannot assign Number to String.' })]);
    });

    test('Keeps imported class array identity and rejects an incompatible indexed member result.', () =>
    {
        const externals = new Map([[ './Item.js', { exportName: 'Item', keyword: 'Object', kind: 'class',
            sourcePath: '/project/Item.lgd', members: [{ name: 'score', kind: 'field', typeName: 'Number', propertyTypeName: 'Number', static: false }] } ]]);
        const source = 'const Remote = require("./Item.js");\nRemote[] items = [Remote.create()];\nString wrong = items[0].score;';
        const result = LgdCompiler.create().compileToJs(source, externals, { javascriptObjectModel: objectModel });
        expect(result.errors).toEqual([expect.objectContaining({ message: 'Cannot assign Number to String.' })]);
    });

    test('Compares complete interface and override array shapes.', () =>
    {
        const contract = 'interface IRead { Number[] read(); }\nclass Reader : IRead { String[] read() { return ["wrong"]; } }';
        expect(compile(contract, objectModel).errors.some(error => error.code === 'lgd.contract.signatureMismatch')).toBe(true);
        const inherited = 'class Base { virtual Number[] read() { return [1]; } }\nclass Derived : Base { override Number[][] read() { return [[1]]; } }';
        expect(compile(inherited, objectModel).errors.some(error => error.message.includes("Override 'read' must return Number[]"))).toBe(true);
    });

    test('Treats array casts as reference assertions and never calls a primitive converter.', () =>
    {
        const source = 'const original = ["one"];\nString[] values = (String[])original;';
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('@type {string[]}');
        expect(result.code).not.toContain('globalThis.String');
        expect(virtualMachine.runInNewContext(`${result.code}\nvalues === original;`)).toBe(true);
        expect(compile('Number[] values = (Number[])3;', objectModel).errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'lgd.cast.incompatibleType' })
        ]));
    });

    test.each([ 'Number[3] values = [];', 'const string[ values = [];', 'Array<String> values = [];', 'String | Number values = [];', 'vscode.Position[3] values = [];' ])('Reports unsupported array/generic/union source syntax directly: %s', source =>
    {
        const result = compile(source, objectModel);
        expect(result.errors).toEqual([expect.objectContaining({ message: 'Unsupported type annotation. Use a named type with [] or ? suffixes.' })]);
    });
});

test('Preserves postfix-array annotations in the TypeScript backend.', () =>
{
    const source = 'String[][] rows = [["one"]];\nString?[] optional = [null];\nObject Reader = { String[]? read(String[] values) { return values; } };';
    const result = LgdCompiler.create().compileToTs(source);
    expect(result.errors).toEqual([]);
    expect(result.code).toContain('let rows: string[][]');
    expect(result.code).toContain('let optional: (string | null)[]');
    expect(result.code).toContain('read(values: string[]): string[] | null');
});
