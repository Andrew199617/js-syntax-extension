const virtualMachine = require('vm');
const LgdFormatter = require('../../../../src/Lgd/Formatting/LgdFormatter');

it('settles required braces and nested spacing in one formatting action', () =>
{
    const configuration = { options: { bracesRequired: { mode: 'always' } } };
    const formatted = LgdFormatter.format('if(ok) act( 1 );', configuration);
    expect(formatted).toContain('{');
    expect(formatted).toContain('act(1);');
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it('attaches only a genuine do-while continuation, not an unrelated while statement', () =>
{
    const source = 'if(ok) { first(); }\nwhile(ready) { next(); }\ndo { last(); } while(again);';
    const formatted = LgdFormatter.format(source);
    expect(formatted).toContain('}\nwhile(ready)');
    expect(formatted).toContain('} while(again);');
    expect(LgdFormatter.format(formatted)).toBe(formatted);
});

it.each([
    'interface IValue { Number value(); }',
    'abstract class Base { abstract Number value(); }'
])('keeps the semicolon on a bodyless contract signature: %s', source =>
{
    const formatted = LgdFormatter.format(source);
    expect(formatted).toContain('Number value();');
    expect(LgdFormatter.format(formatted)).toBe(formatted);
});

it('keeps case-block opening and closing braces aligned when case-block indentation is disabled', () =>
{
    const configuration = { options: { indentation: { caseBlocks: false } } };
    const formatted = LgdFormatter.format('switch(value) { case 1: { act(); break; } }', configuration);
    expect(formatted).toContain('    case 1:\n    {\n        act();\n        break;\n    }');
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it('indents GNU control contents farther than their indented braces', () =>
{
    const configuration = { options: { braces: { style: 'gnu' }, lineBreaks: { shortFunctions: 'never' } } };
    const formatted = LgdFormatter.format('function run() { if(ok) { work(); } }', configuration);
    const lines = formatted.split('\n');
    const statement = lines.findIndex(line => line.trim() === 'work();');
    const braceIndent = lines[statement - 1].match(/^\s*/u)[0].length;
    const bodyIndent = lines[statement].match(/^\s*/u)[0].length;
    expect(bodyIndent).toBeGreaterThan(braceIndent);
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it('preserves ASI-sensitive return and prefix increment behavior under formatting', () =>
{
    const source = 'let count = 0;\nfunction empty() { return\n({ value: 1 }); }\nfunction next() { count\n++count; return count; }\nJSON.stringify([empty(), next()]);';
    const configuration = { options: { lineBreaks: { shortFunctions: 'all' } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(virtualMachine.runInNewContext(formatted)).toBe(virtualMachine.runInNewContext(source));
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it('preserves tagged template raw content, regex text, JSX text and documentation verbatim', () =>
{
    const template = `tag\`a  \r\n \${value}  \``;
    const expression = '/a{2}  b\\/c/g';
    const jsx = '<p> a  b\n c </p>';
    const comment = '/** Keep   this\n * exact layout. */';
    const source = `${comment}\nfunction run(){ const template = ${template}; const expression = ${expression}; return ${jsx}; }`;
    const configuration = { options: { whitespace: { endOfLine: 'lf', trimTrailingWhitespace: true } } };
    const formatted = LgdFormatter.format(source, configuration);
    for(const protectedText of [ template, expression, jsx, comment ])
    {
        expect(formatted).toContain(protectedText);
    }

    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it('preserves complete formatting-off regions while formatting code outside them', () =>
{
    const disabled = '// lgd-format off\r\nif (ok) {   call( 1 ); }\r\n// lgd-format on';
    const source = `${disabled}\r\nif (ok) {   call( 1 ); }`;
    const configuration = { options: { whitespace: { endOfLine: 'lf' } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).toContain(disabled);
    expect(formatted.endsWith('if(ok)\n{\n    call(1);\n}')).toBe(true);
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it('does not insert a scope around Annex-B function declarations', () =>
{
    const configuration = { options: { bracesRequired: { mode: 'always' } } };
    const formatted = LgdFormatter.format('if(ok) function run() {}', configuration);
    expect(formatted).not.toContain('if(ok)\n{');
    expect(formatted).toContain('function run()');
});

it('keeps empty files empty when final-newline insertion is enabled', () =>
{
    expect(LgdFormatter.format('', { options: { whitespace: { finalNewline: 'always' } } })).toBe('');
});

it.each([ 'allman', 'attach', 'whitesmiths' ])('produces stable nested brace layout for %s', style =>
{
    const configuration = { options: { braces: { style: style }, lineBreaks: { shortFunctions: 'never' } } };
    const source = 'function run() { if(ok) { work(); } }';
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).not.toBe(source);
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it.each([ '1e-3', '1e+3', '1 .toString()' ])('formats surrounding code without corrupting numeric lexical form %s', expression =>
{
    const source = `const value=${expression}; if(ok){run();}`;
    const formatted = LgdFormatter.format(source);
    expect(formatted).toContain(`const value = ${expression};`);
    expect(formatted).toContain('if(ok)\n{\n    run();\n}');
    expect(LgdFormatter.format(formatted)).toBe(formatted);
});

it('keeps Linux enum braces attached while splitting class declarations', () =>
{
    const configuration = { options: { braces: { style: 'linux' } } };
    expect(LgdFormatter.format('enum State { Ready = "ready" }', configuration)).toContain('enum State {');
    expect(LgdFormatter.format('class Item { Number value = 1; }', configuration)).toContain('class Item\n{');
});

it('preserves label indentation bytes for the no-change policy, including hard tabs', () =>
{
    const source = 'function run(){\n\tlabel: while(ok){break label;}\n}';
    const configuration = { options: { indentation: { labels: 'preserve' } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).toContain('\n\tlabel:');
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it.each([
    [ 'blankLineAfterConditionalToken', 'const value = ok ?\n\n1 :\n\n2;' ],
    [ 'blankLineAfterArrow', 'const callback = () =>\n\n1;' ],
    [ 'blankLineAfterConstructorColon', 'class Value : Base { Value() :\n\nbase() {} }' ],
    [ 'blankLinesBetweenClosingBraces', 'if(ok) { if(ready) { act(); }\n\n}' ]
])('removes blank lines only at the configured %s boundary', (option, source) =>
{
    const configuration = { options: { lineBreaks: { [option]: false } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).not.toBe(source);
    expect(formatted).not.toContain('\n\n');
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it('allows existing blank lines between closing blocks independently of general block-end spacing', () =>
{
    const source = 'if(ok) { if(ready) { act(); }\n\n}';
    const configuration = { options: { lineBreaks: { blankLinesBetweenClosingBraces: true } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).toContain('}\n\n}');
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it('separates a statement after a block while preserving actual control continuations', () =>
{
    const source = 'if(ok) { act(); } else { other(); } next(); do { act(); } while(ready);';
    const configuration = { options: { lineBreaks: { statementImmediatelyAfterBlock: false } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).toContain('}\n\nnext();');
    expect(formatted).toContain('}\nelse');
    expect(formatted).toContain('} while(ready);');
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it.each([ 'respectPrecedence', 'onePerLine' ])('wraps parsed binary operations with %s and stable evaluation', mode =>
{
    const source = 'const result = firstValue + secondValue * thirdValue - fourthValue;';
    const configuration = { options: { wrapping: { binaryOperations: mode, binaryOperators: 'beforeNonAssignment', columnLimit: 25 } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).toContain('\n    + secondValue');
    expect(formatted).toContain('\n    - fourthValue');
    expect(formatted.includes('\n    * thirdValue')).toBe(mode === 'onePerLine');
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
    const values = { firstValue: 2, secondValue: 3, thirdValue: 4, fourthValue: 5 };
    expect(virtualMachine.runInNewContext(`${formatted} result;`, { ...values })).toBe(virtualMachine.runInNewContext(`${source} result;`, { ...values }));
});

it('leaves comments and opaque expression contents unchanged during precedence wrapping', () =>
{
    const source = 'const result = firstValue + /* keep exactly */ secondValue * thirdValue;';
    const configuration = { options: { wrapping: { binaryOperations: 'respectPrecedence', columnLimit: 15 } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).toContain('+ /* keep exactly */ secondValue');
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it('supports typed return-line style without breaking constructor signatures', () =>
{
    const source = 'class Example { Example() {} Number add(Number first) { return first; } }';
    const configuration = { options: { wrapping: { returnType: 'nextLine' } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).toContain('Number\n    add(Number first)');
    expect(formatted).toContain('Example()');
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
    const joined = LgdFormatter.format(formatted, { options: { wrapping: { returnType: 'sameLine' } } });
    expect(joined).toContain('Number add(Number first)');
});

it('preserves declaration-head alignment while formatting initializer expressions', () =>
{
    const source = 'Number total    =    first+second;';
    const formatted = LgdFormatter.format(source, { options: { spacing: { declarations: 'preserve' } } });
    expect(formatted).toBe('Number total    =    first + second;');
    expect(LgdFormatter.format(source)).toBe('Number total = first + second;');
});

it('separates and indents nested embedded statements when same-line controls are disabled', () =>
{
    const source = 'if(first) if(second) act();';
    const configuration = { options: { lineBreaks: { shortIfs: 'all', embeddedStatementsSameLine: false } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).toBe('if(first)\n    if(second)\n        act();');
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it.each([
    "import external from 'package';\nimport local from './local.js';",
    "const external = require('package');\nconst local = require('./local.js');"
])('groups adjacent imports by origin without reordering %s', source =>
{
    const configuration = { options: { lineBreaks: { importGroups: 'origin' } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).toContain(';\n\n');
    expect(formatted.replace('\n\n', '\n')).toBe(source);
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it('inserts only an explicit header and preserves existing license comments', () =>
{
    const source = '// Existing license\nNumber count = 1;';
    const configuration = { options: { whitespace: { fileHeader: 'Project\nCopyright 2026' } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).toBe(`// Project\n// Copyright 2026\n${source}`);
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
    expect(LgdFormatter.format(source)).toBe(source);
    expect(LgdFormatter.format(`// lgd-format off\n${source}`, configuration)).toBe(`// lgd-format off\n${source}`);
});

it.each([
    'Number count=( Number ) "2";',
    'Number count=(Number)(Number) "2";',
    'class Example {}\nObject value = {};\nExample casted = ( Example ) value;',
    'const result = (Number) /2/.test("2");',
    'const result = (Number) `2`;'
])('formats checked cast source without changing conversion or assertion behavior: %s', source =>
{
    const compiler = require('../../../../src/Compilers/LgdCompiler').create();

    const before = compiler.compileToJs(source);
    expect(before.errors).toHaveLength(0);
    const configuration = { options: { spacing: { afterCast: true, insideCastParens: true } } };
    const formatted = LgdFormatter.format(source, configuration);
    const after = compiler.compileToJs(formatted);
    expect(after.errors).toHaveLength(0);
    expect(after.casts.map(cast => cast.typeName)).toEqual(before.casts.map(cast => cast.typeName));
    expect(formatted).toMatch(/\( (?:Number|Example) \) /u);
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});

it('keeps casts separate from grouped expressions and invocation parentheses', () =>
{
    const source = 'Number count = (Number) "2";\nconst grouped = ( count + 1 );\nconst called = call( count );';
    const configuration = { options: { spacing: { insideCastParens: true, insideOtherParens: false, insideCallParens: false } } };
    const formatted = LgdFormatter.format(source, configuration);
    expect(formatted).toContain('( Number )"2"');
    expect(formatted).toContain('(count + 1)');
    expect(formatted).toContain('call(count)');
    expect(LgdFormatter.format(formatted, configuration)).toBe(formatted);
});
