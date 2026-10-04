const LgdFormatter = require('../../../../src/Lgd/Formatting/LgdFormatter');
const LgdFormattingModel = require('../../../../src/Lgd/Formatting/LgdFormattingModel');

/** @description Every supported declaration spelling must preserve executable structure and reach a fixed point. */
function format(source, declarations, rules = {})
{
    const configuration = { options: { declarations: declarations }, rules: rules };
    let result = source;
    const maximumPasses = 4;
    for(let pass = 0; pass < maximumPasses; pass++)
    {
        result = LgdFormatter.format(result, configuration);
    }

    expect(LgdFormatter.format(result, configuration)).toBe(result);
    expect(LgdFormattingModel.signature(LgdFormattingModel.create(result))).toBe(LgdFormattingModel.signature(LgdFormattingModel.create(source)));
    return result;
}

describe('Guarded declaration spelling', () =>
{
    test('orders known modifiers without moving comments or unspecified modifiers', () =>
    {
        const options = { modifierOrder: { public: 0, static: 1, readonly: 2 } };
        expect(format('class Sample { static public Number value = 1; }', options)).toContain('public static Number');
        expect(format('class Sample { static /* keep */ public Number value = 1; }', options)).toContain('static /* keep */ public');
        expect(format('class Sample { static private Number value = 1; }', options)).toContain('static private');
    });

    test('makes the LGD public member default explicit without changing existing accessibility', () =>
    {
        const result = format('class Sample { Number value = 1; private Number secret = 2; Number read() { return this.value; } }', { accessibility: 'always' });
        expect(result).toContain('public Number value');
        expect(result).toContain('private Number secret');
        expect(result).toContain('public Number read');
    });

    test.each([ [ '1', 'Number' ], [ 'true', 'Boolean' ], [ '"sample"', 'String' ] ])('toggles literal %s const type spelling', (literal, type) =>
    {
        expect(format(`const value = ${literal};`, { localTypes: 'explicit' })).toBe(`const ${type} value = ${literal};`);
        expect(format(`const ${type} value = ${literal};`, { localTypes: 'inferred' })).toBe(`const value = ${literal};`);
    });

    test('declines mutable, exported, object, multi-binding, comment-bearing and nonliteral contracts', () =>
    {
        for(const source of [ 'let value = 1;', 'export const value = 1;', 'const value = {};', 'const left = 1, right = 2;', 'const value = compute();', 'const value = 1; export { value };', '/** @type {unknown} */ const value = 1;' ])
        {
            expect(format(source, { localTypes: 'explicit' })).not.toContain('const Number');
        }

        expect(format('const Number /* keep */ value = 1;', { localTypes: 'inferred' })).toContain('Number /* keep */ value');
        expect(format('const Number value = compute();', { localTypes: 'inferred' })).toContain('Number value');
    });

    test.each([ 'Number', 'String', 'Boolean' ])('declines annotations shadowed by a nominal class or import named %s', type =>
    {
        const literals = { Number: '1', String: '"sample"', Boolean: 'true' };
        for(const prefix of [ `class ${type} {}\n`, `import { ${type} } from "./types";\n` ])
        {
            const inferred = format(`${prefix}const value = ${literals[type]};`, { localTypes: 'explicit' });
            expect(inferred).toContain(`const value = ${literals[type]};`);
            const explicit = format(`${prefix}const ${type} value = ${literals[type]};`, { localTypes: 'inferred' });
            expect(explicit).toContain(`const ${type} value = ${literals[type]};`);
        }
    });

    test('honors option severity and formatting-off regions', () =>
    {
        expect(format('const value = 1;', { localTypes: 'explicit' }, { 'lgd.format.declarations.localTypes': { severity: 'off' } })).toBe('const value = 1;');
        expect(format('// lgd-format off\nconst value = 1;', { localTypes: 'explicit' })).toContain('const value = 1;');
    });
});

describe('Declaration configuration imports', () =>
{
    test('maps foreign preference spelling to independent LGD option policies', () =>
    {
        const adapter = require('../../../../src/Lgd/Formatting/LgdEditorConfig');

        const result = adapter.map(Object.fromEntries([
            [ 'csharp_preferred_modifier_order', 'public,private,static,extern,readonly:warning' ],
            [ 'dotnet_style_require_accessibility_modifiers', 'for_non_interface_members:error' ],
            [ 'csharp_style_var_for_built_in_types', 'false:warning' ]
        ]));
        expect(result.options.declarations.modifierOrder).toEqual({ public: 0, private: 1, static: 2, readonly: 3 });
        expect(result.options.declarations.localTypes).toBe('explicit');
        expect(result.rules['lgd.format.declarations.accessibility'].severity).toBe('error');
    });
});
