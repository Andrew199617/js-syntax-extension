const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

/** @description Compiles real LGD source and selects only virtual-documentation advisories. */
function warningsFor(source)
{
    return LgdCompiler.create().compileToJs(source).errors.filter(error => error.code === 'lgd.jsdoc.virtual');
}

describe('Legacy virtual documentation on LGD class methods', () =>
{
    test('warns on the exact tag without blocking the user example', () =>
    {
        const source = [
            'class Command {',
            '  /** ',
            '   * @virtual ',
            '   */ ',
            '  void executeCommand() {',
            '    throw new Error(\'Did not implement!\');',
            '  }',
            '}'
        ].join('\r\n');
        const result = LgdCompiler.create().compileToJs(source);
        const start = source.indexOf('@virtual');
        expect(result.errors).toEqual([expect.objectContaining({ code: 'lgd.jsdoc.virtual', severity: 'warning', line: 3,
            offset: start, endOffset: start + '@virtual'.length,
            message: 'Declare virtual inline on the LGD method instead of using the @virtual JSDoc tag.',
            quickFix: expect.objectContaining({ kind: 'moveVirtualModifier' }) })]);
        expect(source.slice(result.errors[0].offset, result.errors[0].endOffset)).toBe('@virtual');
        expect(result.code).toContain('executeCommand()');
    });

    test.each([ 'run() {}', 'async run() {}', '*run() {}', 'virtual void run() {}' ])('supports %s with one advisory for each directive', method =>
    {
        const source = `class Command {\n  /**\n   * @virtual\n   * @virtual\n   */\n  ${method}\n}`;
        const warnings = warningsFor(source);
        expect(warnings).toHaveLength(2);
        expect(warnings.map(warning => source.slice(warning.offset, warning.endOffset))).toEqual([ '@virtual', '@virtual' ]);
        expect(warnings[0].quickFix).toEqual(warnings[1].quickFix);
        if(method.startsWith('virtual'))
        {
            expect(warnings[0].message).toBe('Virtual is already declared; remove the @virtual JSDoc tag.');
        }
    });

    test.each([
        'class Command { /** @virtual */ static void run() {} }',
        'class Command { /** @virtual */ Command() {} }',
        'class Command { /** @virtual */ get label() { return "name"; } }',
        'class Command { /** @virtual */ set label(String value) {} }',
        'class Command { /** @virtual */ Number value = 1; }',
        'abstract class Command { /** @virtual */ abstract void run(); }',
        'interface Command { /** @virtual */ void run(); }',
        'class Base { virtual void run() {} }\nclass Command : Base { /** @virtual */ override void run() {} }',
        'Object Command = { /** @virtual */ void run() {} };'
    ])('does not suggest an invalid modifier or alter legacy OLOO semantics: %s', source =>
    {
        expect(warningsFor(source)).toEqual([]);
    });

    test('ignores prose, unrelated documentation and non-JSDoc source', () =>
    {
        const source = [
            'const example = "class Fake { /** @virtual */ void run() {} }";',
            '/** @virtual */',
            'class Command {',
            '  // /** @virtual */',
            '  void first() {}',
            '  /* @virtual */',
            '  void second() {}',
            '  /** @description Mention @virtual in prose. */',
            '  void third() {}',
            '  /** @virtualized */',
            '  void fourth() {}',
            '  /** @virtual */',
            '  /** @description The nearest documentation wins. */',
            '  void fifth() {}',
            '}'
        ].join('\n');
        expect(warningsFor(source)).toEqual([]);
    });

    test('matches the existing return-documentation warning severity', () =>
    {
        const source = 'class Command {\n  /**\n   * @virtual\n   * @returns {number} The result.\n   */\n  Number run() { return 1; }\n}';
        const errors = LgdCompiler.create().compileToJs(source).errors;
        expect(errors).toHaveLength(2);
        expect(errors.every(error => error.severity === 'warning')).toBe(true);
        expect(errors.find(error => error.code === 'lgd.jsdoc.virtual')).toBeDefined();
    });

    test.each([ '```lgd', '~~~~lgd' ])('ignores virtual text inside an example fence %s', fence =>
    {
        const source = [ 'class Command {',
            '    /**',
            '     * @example',
            `     * ${fence}`,
            '     * @virtual',
            `     * ${fence.replace('lgd', '')}`,
            '     */',
            '    void run() {}',
            '}' ].join('\n');
        expect(warningsFor(source)).toEqual([]);
    });
});
