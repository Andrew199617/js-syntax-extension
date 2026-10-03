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
