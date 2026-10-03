const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdClassSyntax = require('../../../src/Compilers/LgdClassSyntax');

function parse(source)
{
    return LgdClassSyntax.parse(source, LgdCompiler.create());
}

describe('LGD class-member error locations and bounded recovery.', () =>
{
    test.each([
        [ 'public broken() {}', 'public', 'memberModifier', "Remove 'public'" ],
        [ ',', ',', 'memberComma', 'Remove this comma' ],
        [ 'value: 1;', ':', 'memberColon', 'Type name = value;' ],
        [ 'value: { hidden() {} };', ':', 'memberColon', 'Type name = value;' ],
        [ 'value: { hidden() {} },', ':', 'memberColon', 'Type name = value;' ],
        [ '[key]() {}', '[', 'memberComputedName', 'Use a named method' ],
        [ '@broken() {}', '@', 'memberHead', "Unexpected '@'" ]
    ])('Diagnoses %s at its offending token and preserves later members.', (invalid, token, code, message) =>
    {
        const source = `class Example {\n first() {}\n ${invalid}\n later() {}\n}`;
        const result = parse(source);
        const offset = source.indexOf(token);
        expect(result.errors).toEqual([expect.objectContaining({
            offset: offset, endOffset: offset + token.length, category: 'syntax',
            code: `lgd.syntax.${code}`, message: expect.stringContaining(message)
        })]);
        expect(result.declarations[0].classMembers.map(member => member.name)).toEqual([ 'first', 'later' ]);
        expect(result.declarations[0].contractSyntaxComplete).toBe(false);
    });

    test('Does not promote nested members or masked punctuation during recovery.', () =>
    {
        const source = [
            'class Example {',
            ' public broken() {',
            '  const nested = { hidden() {} };',
            '  const text = "}; later() {"; // }',
            ' }',
            ' later() {}',
            '}'
        ].join('\n');
        const result = parse(source);
        expect(result.errors).toHaveLength(1);
        expect(result.declarations[0].classMembers.map(member => member.name)).toEqual(['later']);
    });

    test('Stops at an unbalanced invalid member rather than exposing its apparent nested methods.', () =>
    {
        const source = 'class Example {\n public broken( { nested() {} }\n later() {}\n}';
        const result = parse(source);
        expect(result.errors).toHaveLength(1);
        expect(result.declarations[0].classMembers).toEqual([]);
        expect(result.declarations[0].contractSyntaxComplete).toBe(false);
    });

    test('Stops at an unfinished head instead of swallowing or promoting the following line.', () =>
    {
        const result = parse('class Example {\n @unfinished\n later() {}\n}');
        expect(result.errors).toHaveLength(1);
        expect(result.declarations[0].classMembers).toEqual([]);
    });

    test('Keeps valid members and constructor syntax free of fallback errors.', () =>
    {
        const result = parse('class Example {\n Example() {}\n Number count;\n get value() { return this.count; }\n set value(Number next) { this.count = next; }\n async run() {}\n void finish() {}\n}');
        expect(result.errors).toEqual([]);
        const expectedMemberCount = 6;
        expect(result.declarations[0].classMembers).toHaveLength(expectedMemberCount);
        expect(result.declarations[0].contractSyntaxComplete).toBe(true);
    });
});
