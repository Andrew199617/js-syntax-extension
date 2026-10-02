const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdClassSyntax = require('../../../src/Compilers/LgdClassSyntax');
const { check, getConstructorParams } = require('../../../src/Compilers/LgdBaseChecker');
const { parseTypedParams } = require('../../../src/Compilers/LgdTypedParams');

/**
 * @description Checks parsed class and typed-variable declarations independently of compiler diagnostics.
 * @param {string} source the LGD document.
 * @param {Map} externals optional imported constructor signatures.
 * @returns {Array} base diagnostics.
 */
function checkSource(source, externals = new Map())
{
    const compiler = LgdCompiler.create();
    const classes = LgdClassSyntax.parse(source, compiler).declarations;
    const variables = compiler.parse(source, externals).allDeclarations.filter(declaration => declaration.kind !== 'class');
    return check(source, [ ...classes, ...variables ], externals);
}

/**
 * @description Builds a two-class fixture with a configurable base signature and base call.
 * @param {string} baseParams the base constructor parameter text.
 * @param {string} argumentsText the explicit base arguments.
 * @param {string} derivedParams the derived constructor parameter text.
 * @returns {string} the LGD document.
 */
function classSource(baseParams, argumentsText, derivedParams = '')
{
    return `class Parent { Parent(${baseParams}) {} }\nclass Child : Parent { Child(${derivedParams}) : base(${argumentsText}) {} }`;
}

describe('LGD base constructor verification.', () =>
{
    test.each([
        [ '', "Base 'Parent' expects 1 argument(s), but received 0." ],
        [ '1, 2', "Base 'Parent' expects 1 argument(s), but received 2." ]
    ])('Rejects known parameter-count mismatches for base(%s).', (argumentsText, message) =>
    {
        const source = classSource('Number amount', argumentsText);
        const start = source.indexOf('base(') + 'base('.length;
        expect(checkSource(source)).toEqual([{ offset: start, endOffset: start + argumentsText.length, message: message }]);
    });

    test('Reports a literal mismatch at the exact argument offset.', () =>
    {
        const source = classSource('Number amount, String label', '1, "label".length');
        expect(checkSource(source)).toEqual([]);
        const invalid = classSource('Number amount, String label', '1, false');
        expect(checkSource(invalid)).toEqual([{
            offset: invalid.indexOf('false'),
            endOffset: invalid.indexOf('false') + 'false'.length,
            message: "Base 'Parent' argument 2 must be String, but received Boolean."
        }]);
    });

    test('Resolves derived constructor parameters and masks operators inside string literals.', () =>
    {
        expect(checkSource(classSource('Number amount', 'amount + 1', 'Number amount'))).toEqual([]);
        const invalid = classSource('Number amount', 'label', 'String label');
        expect(checkSource(invalid)[0].message).toBe("Base 'Parent' argument 1 must be Number, but received String.");
        expect(checkSource(classSource('String label', '"a,b > c"'))).toEqual([]);
    });

    test('Accepts defaulted trailing parameters and still checks positional required parameters.', () =>
    {
        expect(checkSource(classSource('Number amount, String label = "default"', '1'))).toEqual([]);
        expect(checkSource(classSource('Number amount = 1, String label = "default"', ''))).toEqual([]);
        expect(checkSource(classSource('{ amount } = {}, [first] = []', ''))).toEqual([]);
        expect(checkSource(classSource('Number amount = 1, String label', '1'))[0].message)
            .toBe("Base 'Parent' expects 2 argument(s), but received 1.");
    });

    test('Checks each rest argument while allowing any number of correctly typed extras.', () =>
    {
        expect(checkSource(classSource('String label, ...Number amounts', '"ok", 1, 2, 3'))).toEqual([]);
        expect(checkSource(classSource('...Number amounts', ''))).toEqual([]);
        expect(checkSource(classSource('String label, ...Number amounts', '"ok", 1, false'))[0].message)
            .toBe("Base 'Parent' argument 3 must be Number, but received Boolean.");
    });

    test('Allows unknown expressions, nullable values, and unknown spread lengths.', () =>
    {
        for(const argument of [ 'unknown', 'getAmount()', 'settings.amount', 'null', 'undefined', '...values' ])
        {
            expect(checkSource(classSource('Number amount', argument))).toEqual([]);
        }

        expect(checkSource(classSource('Number amount, String label', 'getAmount(), ...values, false'))).toEqual([]);
    });

    test('Counts nested commas, regexes, and template expressions as individual arguments.', () =>
    {
        const source = classSource(
            'Object first, Object second, Object third, String label',
            `evaluate(1, 2), { pair: [1, 2] }, /a,b/, \`text, \${evaluate(1, 2)}\``
        );
        expect(checkSource(source)).toEqual([]);
    });

    test('Validates implicit zero-argument base calls and constructors.', () =>
    {
        const implicit = 'class Parent { Parent(Number amount) {} }\nclass Child : Parent {}';
        expect(checkSource(implicit)[0].message).toBe("Base 'Parent' expects 1 argument(s), but received 0.");
        const explicit = 'class Parent { Parent(Number amount) {} }\nclass Child : Parent { Child() {} }';
        expect(checkSource(explicit)[0].message).toBe("Base 'Parent' expects 1 argument(s), but received 0.");
        expect(checkSource('class Parent {}\nclass Child : Parent {}')).toEqual([]);
        expect(checkSource('class Parent {}\nclass Child : Parent { Child() : base(1) {} }')[0].message)
            .toBe("Base 'Parent' expects 0 argument(s), but received 1.");
    });

    test('Reads typed and untyped OLOO create method signatures.', () =>
    {
        const typed = 'Object Parent = { create(Number amount, String label = "default") { return this; } };\nclass Child : Parent { Child() : base(false) {} }';
        expect(checkSource(typed)[0].message).toBe("Base 'Parent' argument 1 must be Number, but received Boolean.");
        const untyped = 'Object Parent = { create(amount, label = "default") { return this; } };\nclass Child : Parent { Child() : base() {} }';
        expect(checkSource(untyped)[0].message).toBe("Base 'Parent' expects 1 to 2 argument(s), but received 0.");
        expect(checkSource(untyped.replace('base()', 'base(1)'))).toEqual([]);
    });

    test('Rejects plain local object bases with no create factory.', () =>
    {
        for(const initializer of [ '{}', '{ helper() {} }' ])
        {
            const source = `Object Parent = ${initializer};\nclass Child : Parent {}`;
            expect(checkSource(source)).toEqual([{
                offset: source.lastIndexOf('Parent'),
                message: "Base 'Parent' must provide a create(...) factory."
            }]);
        }
    });

    test('Keeps inherited, spread, computed, and getter-provided factories conservative.', () =>
    {
        const initializers = [
            '{ ...factoryMethods }',
            '{ __proto__: prototype }',
            '{ [factoryName]: factory }',
            '{ get create() { return factory; } }',
            '{ create: factory }',
            'require("external")'
        ];
        for(const initializer of initializers)
        {
            expect(checkSource(`Object Parent = ${initializer};\nclass Child : Parent {}`)).toEqual([]);
        }

        expect(checkSource('Object Parent = {};\nParent.create = factory;\nclass Child : Parent {}')).toEqual([]);
        expect(checkSource('Object Parent = {};\nObject.assign(Parent, factories);\nclass Child : Parent {}')).toEqual([]);
    });

    test('Uses known imported signatures under their local alias.', () =>
    {
        const params = parseTypedParams('(Number amount, String label = "default")').params;
        const externals = new Map([[ './parent', { exportName: 'Original', keyword: 'Object', kind: 'class', constructorParams: params } ]]);
        for(const declaration of [ 'Object Parent = require("./parent");', 'const Parent = require("./parent");' ])
        {
            const source = `${declaration}\nclass Child : Parent { Child() : base(false) {} }`;
            expect(checkSource(source, externals)[0].message).toBe("Base 'Parent' argument 1 must be Number, but received Boolean.");
        }
    });

    test('Honors optional metadata while leaving unknown imported signatures unchecked.', () =>
    {
        const params = [{ name: 'amount', typeName: 'Number', optional: true }];
        const source = 'Object Parent = require("./parent");\nclass Child : Parent {}';
        const externals = new Map([[ './parent', { exportName: 'Parent', keyword: 'Object', constructorParams: params } ]]);
        expect(checkSource(source, externals)).toEqual([]);
        expect(checkSource(source)).toEqual([]);
    });

    test('Reports unknown and primitive bases without inventing dotted external signatures.', () =>
    {
        expect(checkSource('class Child : Missing {}')[0].message).toBe("Unknown base 'Missing'.");
        expect(checkSource('Number Parent = 1;\nclass Child : Parent {}')[0].message)
            .toBe("Base 'Parent' must be a class or OLOO object.");
        expect(checkSource('const library = require("external");\nclass Child : library.Parent {}')).toEqual([]);
        expect(checkSource('import Parent from "external";\nclass Child : Parent {}')).toEqual([]);
    });

    test('Keeps sibling declarations out of the base lookup scope.', () =>
    {
        const source = [
            'class Parent { Parent(Number amount) {} }',
            '{',
            '    class Parent { Parent(String label) {} }',
            '}',
            'class Child : Parent { Child() : base(1) {} }'
        ].join('\n');
        expect(checkSource(source)).toEqual([]);
    });

    test('Rejects self-inheritance and ignores empty parameter comments.', () =>
    {
        expect(checkSource('class Parent : Parent {}')[0].message).toBe("Class 'Parent' cannot inherit from itself.");
        expect(checkSource(classSource('/* no parameters */', '/* no arguments */'))).toEqual([]);
    });

    test('Rejects indirect local inheritance cycles before emitting recursive create calls.', () =>
    {
        const source = 'class First : Second {}\nclass Second : Third {}\nclass Third : First {}';
        const errors = checkSource(source);
        expect(errors.map(error => error.message)).toEqual([
            "Class 'First' has a circular base inheritance chain.",
            "Class 'Second' has a circular base inheritance chain.",
            "Class 'Third' has a circular base inheritance chain."
        ]);
    });

    test('Accepts known subclasses passed to nominal base parameters.', () =>
    {
        const source = [
            'class Item {}',
            'class SpecialItem : Item {}',
            'class Parent { Parent(Item value) {} }',
            'class Child : Parent { Child(SpecialItem value) : base(value) {} }'
        ].join('\n');
        expect(checkSource(source)).toEqual([]);
    });

    test('Exposes signatures for imported OLOO create properties without guessing arbitrary factories.', () =>
    {
        expect(getConstructorParams({ initializerText: '{ create: (Number amount) => amount }' })[0].typeName).toBe('Number');
        expect(getConstructorParams({ initializerText: '{ create: factory }' })).toBeNull();
        expect(getConstructorParams({ initializerText: 'factory()' })).toBeNull();
        expect(getConstructorParams({ kind: 'class', constructorMember: null })).toEqual([]);
    });
});
