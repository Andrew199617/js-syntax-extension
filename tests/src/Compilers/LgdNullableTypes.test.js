const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdContractChecker = require('../../../src/Compilers/LgdContractChecker');
const LgdOverrideChecker = require('../../../src/Compilers/LgdOverrideChecker');

/** @description Checks a fixture with the requested JavaScript object model. */
function compile(source, objectModel = 'oloo', externals = new Map())
{
    return LgdCompiler.create().compileToJs(source, externals, { javascriptObjectModel: objectModel });
}

/** @description Wraps named methods in an object or class without changing their checked signatures. */
function methods(members, owner, prefix = '')
{
    const classOwner = owner !== 'object';
    const body = members.join(classOwner ? '\n' : ',\n');
    const source = classOwner ? `class Example { ${body} }` : `Object Example = { ${body} };`;
    return compile(`${prefix}\n${source}`, classOwner ? owner : 'oloo');
}

describe.each([ 'object', 'oloo', 'class' ])('LGD nullable return checking in %s methods.', owner =>
{
    test.each([
        [ 'Number', '1' ],
        [ 'String', '"text"' ],
        [ 'Boolean', 'true' ],
        [ 'BigInt', '1n' ],
        [ 'Symbol', 'Symbol()' ],
        [ 'Object', '{}' ],
        [ 'Array', '[]' ],
        [ 'Function', '() => {}' ]
    ])('Accepts null and concrete %s results without changing the nominal type.', (type, value) =>
    {
        const result = methods([`${type}? read(Boolean ready) { return ready ? ${value} : null; }`], owner);
        expect(result.errors).toEqual([]);
    });

    test.each([
        [ 'return undefined;', 'Cannot return undefined' ],
        [ 'return;', 'Cannot return undefined' ],
        [ 'return "wrong";', 'Cannot return String' ],
        [ '', 'must return Number?' ],
        [ 'if(ready) return null;', 'must return Number?' ]
    ])('Rejects an incomplete or incompatible nullable body: %s.', (body, message) =>
    {
        const result = methods([`Number? read(Boolean ready) { ${body} }`], owner);
        expect(result.errors).toEqual([expect.objectContaining({ message: expect.stringContaining(message) })]);
    });

    test('Resolves qualified nullable parameters and returns from the actual vscode import.', () =>
    {
        const prefix = 'const vscode = require("vscode");\nconst vscode.Position? origin = null;';
        expect(methods(['vscode.Position? read(vscode.Position? position) { return position; }'], owner, prefix).errors).toEqual([]);
        expect(methods(['vscode.Position? read() { return "wrong"; }'], owner, prefix).errors)
            .toEqual([expect.objectContaining({ message: 'Cannot return String from a vscode.Position? method.' })]);

        expect(methods(['vscode.Position read(vscode.Position? position) { return position; }'], owner, prefix).errors)
            .toEqual([expect.objectContaining({ message: 'Cannot return null from a vscode.Position method.' })]);
    });

    test('Retains null through method calls, local aliases, and parameter contracts.', () =>
    {
        const result = methods([
            'Number? maybe(Number? value) { return value; }',
            'Number read(Number? value) { const alias = this.maybe(value); return alias; }'
        ], owner);
        expect(result.errors).toEqual([expect.objectContaining({ message: 'Cannot return null from a Number method.' })]);
        expect(methods(['Number read(Number? value) { return value ?? 1; }'], owner).errors).toEqual([]);
    });

    test('Checks async resolved nullable contracts and nullable method calls.', () =>
    {
        expect(methods(['async Number? maybe() { return Promise.resolve(null); }'], owner).errors).toEqual([]);
        const result = methods([
            'async Number? maybe() { return null; }',
            'async Number read() { return await this.maybe(); }'
        ], owner);
        expect(result.errors).toEqual([expect.objectContaining({ message: 'Cannot return null from a Number method.' })]);
    });

    test('Resolves nominal nullable types and still rejects incompatible named values.', () =>
    {
        const prefix = 'class Item {}\nclass Other {}';
        expect(methods(['Item? read(Item? value) { return value; }'], owner, prefix).errors).toEqual([]);
        expect(methods(['Item? read() { return Other.create(); }'], owner, prefix).errors)
            .toEqual([expect.objectContaining({ message: 'Cannot return Other from a Item? method.' })]);
    });
});

describe.each([ 'oloo', 'class' ])('LGD nullable assignment and contract checking with %s output.', objectModel =>
{
    test('Allows null while rejecting undefined and incorrect primitive assignments.', () =>
    {
        expect(compile('Number? amount = null;\namount = 2;\namount = null;', objectModel).errors).toEqual([]);
        const source = 'Number? amount = undefined;\namount = "wrong";';
        const result = compile(source, objectModel);
        expect(result.errors.map(error => error.message)).toEqual([ 'Cannot assign undefined to Number?.', 'Cannot assign String to Number?.' ]);
        expect(compile('Number amount = undefined;\namount = null;', objectModel).errors).toEqual([]);
    });

    test('Checks explicit nullable parameter defaults and later writes.', () =>
    {
        const source = 'class Example { void update(Number? value = undefined) { value = null; value = "wrong"; } }';
        expect(compile(source, objectModel).errors.map(error => error.message))
            .toEqual([ 'Cannot assign undefined to Number?.', 'Cannot assign String to Number?.' ]);
    });

    test('Preserves field nullability despite unknown document effects and checks field writes.', () =>
    {
        const source = 'class Example { Number? Value; Number read() { return this.Value; } void update() { this.Value = undefined; } }\nunknown();';
        const messages = compile(source, objectModel).errors.map(error => error.message);
        expect(messages).toContain('Cannot return null from a Number method.');
        expect(messages).toContain("Cannot assign undefined to Number? member 'Value'.");
        expect(compile('class Example { Number? Value = null; Number read() { return this.Value ?? 1; } }', objectModel).errors).toEqual([]);
    });

    test('Resolves nullable class receivers without losing their field or method contracts.', () =>
    {
        const source = 'class Item { Number? Value = 1; Number? read() { return this.Value; } }\nclass Example { Number read(Item? item) { return item.read(); } }';
        expect(compile(source, objectModel).errors)
            .toEqual([expect.objectContaining({ message: 'Cannot return null from a Number method.' })]);
    });

    test.each([ 'Number', 'Item', 'vscode.Position' ])('Checks nullable %s interface signatures consistently.', type =>
    {
        const prefix = 'const vscode = require("vscode");\nclass Item {}\n';
        const source = `${prefix}interface I { ${type}? read(${type}? value); }\nclass Example : I { ${type}? read(${type}? value) { return value; } }`;
        expect(compile(source, objectModel).errors).toEqual([]);
        const changed = source.replace(`class Example : I { ${type}? read`, `class Example : I { ${type} read`);
        expect(compile(changed, objectModel).errors.some(error => error.code === 'lgd.contract.signatureMismatch')).toBe(true);
        const parameter = source.replace(`class Example : I { ${type}? read(${type}?`, `class Example : I { ${type}? read(${type}`);
        expect(compile(parameter, objectModel).errors.some(error => error.code === 'lgd.contract.signatureMismatch')).toBe(true);
    });

    test('Checks nullable override, inherited abstract body, and property contracts.', () =>
    {
        const inherited = 'abstract class Base { abstract Number? read(Number? value); }\nclass Example : Base { override read(value) { return value; } }';
        expect(compile(inherited, objectModel).errors).toEqual([]);
        expect(compile(inherited.replace('return value;', 'return undefined;'), objectModel).errors)
            .toEqual([expect.objectContaining({ message: 'Cannot return undefined from a Number? method.' })]);
        const override = 'class Base { virtual Number? read() { return null; } }\nclass Example : Base { override Number read() { return 1; } }';
        expect(compile(override, objectModel).errors)
            .toEqual([expect.objectContaining({ message: "Override 'read' must return Number?, not Number." })]);
        const property = 'interface I { Number? Value { get; set; } }\nclass Example : I { get Number? Value() { return null; } set Value(Number? value) {} }';
        expect(compile(property, objectModel).errors).toEqual([]);
        expect(compile(property.replace('set Value(Number?', 'set Value(Number'), objectModel).errors
            .some(error => error.code === 'lgd.contract.signatureMismatch')).toBe(true);
    });

    test('Carries nullable contracts across imported abstract class metadata.', () =>
    {
        const source = 'abstract class Base { abstract Number? read(Number? value); }';
        const parsed = LgdCompiler.create().parse(source);
        const declaration = parsed.allDeclarations[0];
        const external = { exportName: 'Base', kind: 'class', keyword: 'Object',
            ...LgdOverrideChecker.describeMethods(source, parsed.allDeclarations, declaration),
            ...LgdContractChecker.describeContracts(source, parsed.allDeclarations, declaration) };
        const externals = new Map([[ './base', external ]]);
        const derived = 'const Base = require("./base");\nclass Example : Base { override read(value) { return value; } }';
        expect(compile(derived, objectModel, externals).errors).toEqual([]);
        expect(compile(derived.replace('return value;', 'return undefined;'), objectModel, externals).errors)
            .toEqual([expect.objectContaining({ message: 'Cannot return undefined from a Number? method.' })]);
    });

    test('Reports unknown nullable names precisely instead of accepting misspelled types.', () =>
    {
        const source = 'interface I { Missing? read(); }';
        const result = compile(source, objectModel);
        const unknown = result.errors.find(error => error.code === 'lgd.contract.unknownType');
        expect(unknown.message).toBe("Unknown contract type 'Missing?'.");
        expect(source.slice(unknown.offset, unknown.endOffset)).toBe('Missing?');
    });
});
