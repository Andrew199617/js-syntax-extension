const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdOverrideChecker = require('../../../src/Compilers/LgdOverrideChecker');

/**
 * @description Checks method contracts independently from other compiler diagnostics.
 * @param {string} source the class source.
 * @param {Map} externals the known relative exports.
 * @returns {Array} virtual/override diagnostics.
 */
function check(source, externals = new Map())
{
    const parsed = LgdCompiler.create().parse(source, externals);
    return LgdOverrideChecker.check(source, parsed.allDeclarations, externals);
}

/**
 * @description Describes one named exported class using the same metadata as the language service.
 * @param {string} source the class source.
 * @param {string} name the declaration to describe.
 * @param {Map} externals the known relative exports.
 * @returns {Object} methodSignatures and methodsKnown metadata.
 */
function describeExport(source, name, externals = new Map())
{
    const parsed = LgdCompiler.create().parse(source, externals);
    const declaration = parsed.allDeclarations.find(candidate => candidate.name === name);
    return LgdOverrideChecker.describeMethods(source, parsed.allDeclarations, declaration, externals);
}

describe('LGD virtual and override contracts', () =>
{
    test('requires override on a known inherited virtual method with a precise method-name range', () =>
    {
        const source = [
            'class Base { virtual run() {} }',
            'class Child : Base { run() {} }'
        ].join('\n');
        const errors = check(source);

        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('requires the override keyword');
        expect(source.slice(errors[0].offset, errors[0].endOffset)).toBe('run');
    });

    test.each([ '', 'override ' ])('rejects replacing a known nonvirtual method with modifier %s', modifier =>
    {
        const source = `class Base { run() {} }\nclass Child : Base { ${modifier}run() {} }`;
        const errors = check(source);

        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('non-virtual inherited member');
        expect(errors[0].message).not.toContain('requires the override keyword');
        expect(source.slice(errors[0].offset, errors[0].endOffset)).toBe(modifier ? 'override' : 'run');
    });

    test('keeps valid overrides virtual through an inherited chain', () =>
    {
        const source = [
            'class Base { virtual Number run(Number count) { return count; } }',
            'class Middle : Base { override Number run(Number total) { return total; } }',
            'class Leaf : Middle { override Number run(Number value) { return value; } }'
        ].join('\n');

        expect(check(source)).toEqual([]);
        expect(describeExport(source, 'Leaf')).toMatchObject({
            methodsKnown: true,
            methodSignatures: [{ name: 'run', virtual: true, override: true, returnTypeName: 'Number', declaredIn: 'Leaf' }]
        });
    });

    test.each([
        'class Child { override run() {} }',
        'class Base {}\nclass Child : Base { override run() {} }'
    ])('rejects override when the complete known ancestry has no matching method', source =>
    {
        expect(check(source)[0].message).toContain('no inherited method');
    });

    test.each([
        'Object Base = require("external");\nclass Child : Base { override run() {} }',
        'const library = require("external");\nclass Child : library.Base { override run() {} }'
    ])('does not guess methods on unknown external ancestry', source =>
    {
        expect(check(source)).toEqual([]);
        expect(describeExport(source, 'Child').methodsKnown).toBe(false);
    });

    test.each([
        [ 'Number count, String label', 'Number count', '2 parameter(s)' ],
        [ 'Number count', 'String count', 'parameter 1 must be Number' ],
        [ '...String labels', 'String labels', 'rest parameter' ]
    ])('checks definite signature mismatches from (%s) to (%s)', (baseParams, overrideParams, message) =>
    {
        const source = `class Base { virtual run(${baseParams}) {} }\nclass Child : Base { override run(${overrideParams}) {} }`;
        expect(check(source).some(error => error.message.includes(message))).toBe(true);
    });

    test('does not turn an optional base argument into a required override argument', () =>
    {
        const source = 'class Base { virtual run(Number count = 0) {} }\nclass Child : Base { override run(Number count) {} }';
        expect(check(source)[0].message).toContain('cannot require more arguments');
    });

    test('retains an inherited typed contract when an intermediate override omits annotations', () =>
    {
        const source = [
            'class Base { virtual Number run(Number count) { return count; } }',
            'class Middle : Base { override run(value) { return value; } }',
            'class Leaf : Middle { override String run(String title) { return title; } }'
        ].join('\n');
        const errors = check(source);
        expect(errors.some(error => error.message.includes('parameter 1 must be Number'))).toBe(true);
        expect(errors.some(error => error.message.includes('must return Number'))).toBe(true);
    });

    test('checks explicit built-in returns while allowing omitted or opaque annotations', () =>
    {
        const mismatch = [
            'class Base { virtual Number run() { return 1; } }',
            'class Child : Base { override String run() { return "ready"; } }'
        ].join('\n');
        expect(check(mismatch)[0].message).toContain('must return Number');

        const unknown = [
            'class Base { virtual Number run(Number value) { return value; } }',
            'class Child : Base { override run(value) { return value; } }',
            'class Opaque : Child { override library.Result run(library.Input value) { return value; } }'
        ].join('\n');
        expect(check(unknown)).toEqual([]);
    });

    test('resolves a shadowing local base instead of a same-named outer class', () =>
    {
        const source = [
            'class Base { virtual run() {} }',
            'function build() {',
            '  Object Base = { create() {}, run() {} };',
            '  class Child : Base { override run() {} }',
            '}'
        ].join('\n');
        expect(check(source)[0].message).toContain('non-virtual inherited member');
    });

    test('preserves explicit JSDoc virtual contracts when migrating an OLOO base', () =>
    {
        const source = [
            'Object Base = {',
            '  create() {},',
            '  /**',
            '   * @description Runs the command.',
            '   * @virtual',
            '   */',
            '  run(String title) {}',
            '};',
            'class Child : Base { override run(String title) {} }'
        ].join('\n');
        expect(check(source)).toEqual([]);
        expect(describeExport(source, 'Base').methodSignatures[0].virtual).toBe(true);
    });

    test('does not take virtual tags from a method body or an unrelated previous docblock', () =>
    {
        const source = [
            'Object Base = {',
            '  create() {},',
            '  /** @virtual */',
            '  /** @description An ordinary method. */',
            '  run() { const text = "@virtual"; }',
            '};',
            'class Child : Base { override run() {} }'
        ].join('\n');
        expect(check(source)[0].message).toContain('non-virtual inherited member');
    });

    test('uses effective method signatures through multiple CommonJS export boundaries', () =>
    {
        const baseSource = 'class Base { virtual Number run(String title) { return 1; } }';
        const base = { exportName: 'Base', keyword: 'Object', kind: 'class', ...describeExport(baseSource, 'Base') };
        const imports = new Map([[ './Base.js', base ]]);
        const middleSource = 'Object Parent = require("./Base.js");\nclass Middle : Parent { override Number run(String title) { return 2; } }';
        expect(check(middleSource, imports)).toEqual([]);
        const middle = { exportName: 'Middle', keyword: 'Object', kind: 'class', ...describeExport(middleSource, 'Middle', imports) };
        const leafImports = new Map([[ './Middle.js', middle ]]);
        const leafSource = 'const Parent = require("./Middle.js");\nclass Leaf : Parent { run(String title) { return 3; } }';

        expect(check(leafSource, leafImports)[0].message).toContain('requires the override keyword');
        expect(middle.methodSignatures[0]).toMatchObject({ virtual: true, paramsKnown: true, params: [{ typeName: 'String' }] });
    });

    test('keeps missing inherited names uncertain for dynamic OLOO bases and cycles', () =>
    {
        const spreadSource = 'Object Base = { ...unknown, create() {} };\nclass Child : Base { override run() {} }';
        expect(check(spreadSource)).toEqual([]);
        expect(describeExport(spreadSource, 'Child').methodsKnown).toBe(false);
        const cycleSource = 'class First : Second { override run() {} }\nclass Second : First {}';
        expect(check(cycleSource)).toEqual([]);
        expect(describeExport(cycleSource, 'First').methodsKnown).toBe(false);
    });
});
