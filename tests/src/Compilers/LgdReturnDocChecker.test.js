const virtualMachine = require('vm');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

/** @description The advisory text shown on a redundant JSDoc type. */
const message = 'Return type is already declared; the JSDoc type is not required.';

/**
 * @description Wraps one source method in a named LGD object or class.
 * @param {string} kind the declaration kind.
 * @param {string} member the documented method.
 * @returns {string} the complete source.
 */
function sourceFor(kind, member)
{
    return kind === 'class' ? `class Example {\r\n${member}\r\n}` : `Object Example = {\r\n${member}\r\n};`;
}

describe.each([ 'class', 'object' ])('Redundant return JSDoc on an LGD %s method', kind =>
{
    test.each([
        [ 'return', '' ],
        [ 'returns', '' ],
        [ 'return', ' The current count.' ],
        [ 'returns', ' The current count.' ]
    ])('warns on @%s and preserves description %s without blocking output', (tag, description) =>
    {
        const source = sourceFor(kind, `    /** @${tag} {number}${description} */\r\n    Number count() { return 1; }`);
        const result = LgdCompiler.create().compileToJs(source);
        const start = source.indexOf('{number}');

        expect(result.errors).toEqual([{ message: message, line: 2, offset: start, endOffset: start + '{number}'.length, severity: 'warning' }]);
        expect(source.slice(result.errors[0].offset, result.errors[0].endOffset)).toBe('{number}');
        expect(result.code).toContain(`@returns {number}${description}`);
        const receiver = kind === 'class' ? 'Example.create()' : 'Example';
        expect(virtualMachine.runInNewContext(`${result.code}\n${receiver}.count();`)).toBe(1);
        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
    });

    test('keeps legacy typed-parameter methods that rely on JSDoc return types silent', () =>
    {
        const source = sourceFor(kind, '    /** @returns {number} The value. */\r\n    count(Number value) { return value; }');
        const result = LgdCompiler.create().compileToJs(source);

        expect(result.errors).toEqual([]);
        expect(result.code).toContain('@returns {number} The value.');
    });

    test('does not warn on a descriptive return tag without a braced type', () =>
    {
        const source = sourceFor(kind, '    /** @returns The count. */\r\n    Number count() { return 1; }');
        expect(LgdCompiler.create().compileToJs(source).errors).toEqual([]);
    });
});

test('supports an inline tag after prose and balances record types without selecting their description', () =>
{
    const source = sourceFor('object', '    /** Details. @returns {{label: "}"}} The label. */\r\n    Object result() { return { label: "ready" }; }');
    const result = LgdCompiler.create().compileToJs(source);

    expect(result.errors).toHaveLength(1);
    expect(source.slice(result.errors[0].offset, result.errors[0].endOffset)).toBe('{{label: "}"}}');
    expect(result.code).toContain('The label.');
});

test('does not treat JSDoc-looking strings, line comments or ordinary block comments as attached JSDoc', () =>
{
    const source = [
        'const sample = "class Fake { /** @returns {number} */ Number count() { return 1; } }";',
        'class Example {',
        '    // /** @returns {number} */',
        '    Number first() { return 1; }',
        '    /* /** @returns {number} */',
        '    Number second() { return 2; }',
        '}',
        'const template = `/** @returns {number} */ Number example() {}`;'
    ].join('\n');

    expect(LgdCompiler.create().compileToJs(source).errors).toEqual([]);
});

test('ignores unattached documentation and generated JavaScript return docs', () =>
{
    const source = '/** @returns {number} */\nNumber saved = 1;\nclass Example { Number count() { return saved; } }';
    const result = LgdCompiler.create().compileToJs(source);

    expect(result.errors).toEqual([]);
    expect(result.code).toContain('@returns {number}');
    expect(LgdCompiler.create().compileToJs(result.code).errors).toEqual([]);
});

test('does not invent a source range for an incomplete braced type', () =>
{
    const source = sourceFor('class', '    /** @returns {number The count. */\r\n    Number count() { return 1; }');
    expect(LgdCompiler.create().compileToJs(source).errors).toEqual([]);
});
