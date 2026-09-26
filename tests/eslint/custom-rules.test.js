const { execFileSync } = require('child_process');
const path = require('path');

function checkChain(source)
{
    const script = `
        require('./scripts/register-eslint-rules')();
        const { Linter } = require('eslint');
        const rule = require('./.vscode/eslint-rules/consistent-chained-call-newline');
        const linter = new Linter();
        linter.defineRule('consistent-chained-call-newline', rule);
        const result = linter.verifyAndFix(JSON.parse(process.argv[1]), {
            parserOptions: { ecmaVersion: 2020 },
            rules: { 'consistent-chained-call-newline': 'error' }
        });
        process.stdout.write(JSON.stringify(result));
    `;
    const output = execFileSync(process.execPath, [ '-e', script, JSON.stringify(source) ], {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8'
    });

    return JSON.parse(output);
}

test.each([ '(values)', '((values))', '(values.filter(Boolean))' ])('checks parenthesized chain links: %s', receiver =>
{
    const source = `${receiver}\r\n    .map(convert).filter(Boolean);`;
    const result = checkChain(source);
    expect(result.fixed).toBe(true);
    expect(result.output).toBe(`${receiver}\r\n    .map(convert)\r\n    .filter(Boolean);`);
    expect(result.messages).toEqual([]);
});

test('multiline callback bodies do not force inline chain links apart', () =>
{
    const source = 'values.map(value => {\r\n    return value;\r\n}).filter(Boolean);';
    const result = checkChain(source);
    expect(result.fixed).toBe(false);
    expect(result.output).toBe(source);
    expect(result.messages).toEqual([]);
});
