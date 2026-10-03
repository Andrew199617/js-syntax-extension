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

    test('Locates a missing constructor opener after parameters and recovers past its object assignment.', () =>
    {
        const source = [
            "readonly Object vscode = require('vscode');",
            'class BaseCommand {',
            '  BaseCommand(String commandName, String title)',
            '    /** @type {vscode.Command} */',
            '    this.command = { title: title, command: commandName };',
            '  }',
            '  Object command = {};',
            '  get commandName() { return this.command.command; }',
            '  void createCommand() { return vscode.commands.registerCommand(this.commandName, this.executeCommand, this); }',
            '  void executeCommand() { throw new Error("Did not implement!"); }',
            '  findNextChar() {}',
            '  findPreviousChar() {}',
            '}'
        ].join('\n');
        const result = parse(source);
        const insertionOffset = source.indexOf('String title)') + 'String title)'.length;
        expect(result.errors).toEqual([expect.objectContaining({
            message: 'Expected "{" after constructor parameters.',
            offset: insertionOffset, endOffset: insertionOffset, code: 'lgd.syntax.missingMemberBody'
        })]);

        expect(result.declarations[0].classMembers.map(member => member.name)).toEqual([
            'command', 'commandName', 'createCommand', 'executeCommand', 'findNextChar', 'findPreviousChar'
        ]);
        expect(result.declarations[0].end).toBe(source.length);
        expect(result.declarations[0].contractSyntaxComplete).toBe(false);
        const broken = LgdCompiler.create().compileToJs(source);
        expect(broken.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.syntax.missingMemberBody' })]));
        const repaired = `${source.slice(0, insertionOffset)} {${source.slice(insertionOffset)}`;
        expect(parse(repaired).errors).toEqual([]);
        const knownReturn = repaired.replace('return vscode.commands.registerCommand(this.commandName, this.executeCommand, this);', 'return 1;');
        const compiled = LgdCompiler.create().compileToJs(knownReturn);
        expect(compiled.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.return.typeMismatch' })]));
    });

    test('Does not absorb a following top-level declaration after a missing opener.', () =>
    {
        const source = 'class First {\n First()\n this.value = {};\n}\nclass Second {\n good() {}\n}';
        const result = parse(source);
        expect(result.errors).toHaveLength(1);
        expect(result.declarations.map(declaration => declaration.name)).toEqual([ 'First', 'Second' ]);
        expect(result.declarations[0].classMembers).toEqual([]);
        expect(result.declarations[1].classMembers.map(member => member.name)).toEqual(['good']);
    });

    test('Keeps a missing method opener at its signature rather than the following statement.', () =>
    {
        const source = 'class Example {\n run()\n return 1;\n}';
        const result = parse(source);
        const insertionOffset = source.indexOf('run()') + 'run()'.length;
        expect(result.errors).toEqual([expect.objectContaining({
            message: 'Expected "{" after method parameters.', offset: insertionOffset, endOffset: insertionOffset
        })]);
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
