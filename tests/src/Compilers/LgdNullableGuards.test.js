const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

/** @description Compiles an immutable nullable parameter contract in each supported method form. */
function compile(body, owner, parameters = 'Number? value')
{
    const method = `Number read(${parameters}) { ${body} }`;
    const source = owner === 'object' ? `Object Example = { ${method} };` : `class Example { ${method} }`;
    const objectModel = owner === 'object' ? 'oloo' : owner;
    return LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
}

describe.each([ 'object', 'oloo', 'class' ])('LGD nullable guards in %s methods.', owner =>
{
    test.each([
        'if(value !== null) return value; return 0;',
        'if(value === null) return 0; return value;',
        'if(value != null) return value; return 0;',
        'if(value == null) return 0; return value;',
        'if(null !== value) return value; return 0;',
        'if(!(null === value)) return value; return 0;',
        'return value === null ? 0 : value;'
    ])('Narrows a stable binding through a null guard: %s.', body =>
    {
        expect(compile(body, owner).errors).toEqual([]);
    });

    test('Narrows immutable aliases and preserves the proof across ordinary calls.', () =>
    {
        const body = 'const alias = value; if(alias === null) return 0; unknown(); return alias;';
        expect(compile(body, owner).errors).toEqual([]);
    });

    test('Combines early exits through nested branches without leaking a one-sided proof.', () =>
    {
        expect(compile('if(ready) { if(value === null) return 0; } else { if(value == null) return 0; } return value;', owner).errors).toEqual([]);
        const result = compile('if(ready) { if(value === null) return 0; } return value;', owner);
        expect(result.errors).toEqual([expect.objectContaining({ message: 'Cannot return null from a Number method.' })]);
    });

    test('Preserves null on the equality branch instead of widening it to the base type.', () =>
    {
        const result = compile('if(value === null) return value; return 0;', owner);
        expect(result.errors).toEqual([expect.objectContaining({ message: 'Cannot return null from a Number method.' })]);
    });

    test.each([
        'if(value !== null) { value = null; return value; } return 0;',
        'if(value !== null) { const reset = () => { value = null; }; return value; } return 0;',
        'if(value !== null) { arguments[0] = null; return value; } return 0;',
        'if(value !== null) { const reset = () => { arguments[0] = null; }; return value; } return 0;',
        'if(value !== null) { const reset = () => eval("value = null"); return value; } return 0;'
    ])('Withholds immutable proof when the binding can change: %s.', body =>
    {
        expect(compile(body, owner).errors).toEqual([expect.objectContaining({ message: 'Cannot return null from a Number method.' })]);
    });

    test('Does not narrow a same-named binding in a nested lexical scope.', () =>
    {
        const body = 'if(value === null) return 0; { const value = other; return value; }';
        expect(compile(body, owner, 'Number? value, Number? other').errors)
            .toEqual([expect.objectContaining({ message: 'Cannot return null from a Number method.' })]);
    });

    test('Keeps strict null checks distinct from loose nullish checks.', () =>
    {
        const prefix = 'const selected = ready ? value : undefined; ';
        expect(compile(`${prefix}if(selected != null) return selected; return 0;`, owner).errors).toEqual([]);
        expect(compile(`${prefix}if(selected !== null) return selected; return 0;`, owner).errors)
            .toEqual([expect.objectContaining({ message: 'Cannot return undefined from a Number method.' })]);
    });
});

describe.each([ 'oloo', 'class' ])('LGD nullable member guard safety with %s output.', objectModel =>
{
    test('Does not reuse a field guard across mutable member reads.', () =>
    {
        const source = 'class Example { Number? Value = null; Number read() { if(this.Value === null) return 0; unknown(); return this.Value; } }';
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
        expect(result.errors).toEqual([expect.objectContaining({ message: 'Cannot return null from a Number method.' })]);
    });

    test('Narrowing a captured field value is safe even when its source member changes.', () =>
    {
        const source = 'class Example { Number? Value = null; Number read() { const value = this.Value; if(value === null) return 0; this.Value = null; return value; } }';
        const result = LgdCompiler.create().compileToJs(source, new Map(), { javascriptObjectModel: objectModel });
        expect(result.errors).toEqual([]);
    });
});
