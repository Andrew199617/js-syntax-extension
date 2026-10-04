const virtualMachine = require('vm');
const LgdExpressionStyles = require('../../../src/Lgd/Formatting/LgdExpressionStyles');
const LgdFormatter = require('../../../src/Lgd/Formatting/LgdFormatter');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

/** @description Applies only the requested lambda body option without unrelated whitespace transformations. */
function rewrite(source, mode, rules = {})
{
    const findings = LgdExpressionStyles.analyze(source, { options: { expressions: { lambdaBodies: mode } }, rules: rules });
    return LgdFormatter.apply(source, findings);
}

test.each([
    [ 'const fn = x => { return x + 1; };', 'always', '=> (x + 1)' ],
    [ 'const fn = () => { return { value: 1 }; };', 'always', '=> ({ value: 1 })' ],
    [ 'const fn = x => { return (x++, x); };', 'always', '=> (x++, x)' ],
    [ 'const fn = x => (x + 1);', 'never', '=> { return (x + 1); }' ],
    [ 'const fn = () => ({ value: 1 });', 'never', '=> { return ({ value: 1 }); }' ],
    [ 'const fn = x => { return x + 1; };', 'when_on_single_line', '=> (x + 1)' ]
])('converts an exact single-return arrow body: %s', (source, mode, expected) =>
{
    const formatted = rewrite(source, mode);
    expect(formatted).toContain(expected);
    expect(formatted).not.toBe(source);
    expect(rewrite(formatted, mode)).toBe(formatted);
    expect(rewrite(source, 'preserve')).toBe(source);
    expect(rewrite(source, mode, { 'lgd.format.expressions.lambdaBodies': { severity: 'off' } })).toBe(source);
});

test.each([
    'const fn = () => { "use strict"; return 1; };',
    'const fn = () => { /* keep */ return 1; };',
    'const fn = () => { return /* keep */ 1; };',
    'const fn = () => /* keep */ 1;',
    'const fn = () => { return; };',
    'const fn = () => { let value = 1; return value; };',
    'const fn = () => { return\n1; };',
    '// lgd-format off\nconst fn = () => { return 1; };',
    'Function fn = (Number value) => { return value; };'
])('declines directives, comments, contracts and non-single-return bodies: %s', source =>
{
    const mode = source.includes('/* keep */ 1;') && !source.includes('{') ? 'never' : 'always';
    expect(rewrite(source, mode)).toBe(source);
});

test('when_on_single_line preserves a multiline expression', () =>
{
    const source = 'const fn = () => { return first +\nsecond; };';
    expect(rewrite(source, 'when_on_single_line')).toBe(source);
    expect(rewrite(source, 'always')).not.toBe(source);
});

test.each([ 'always', 'never' ])('preserves lexical this, arguments, evaluation count and object results in %s mode', mode =>
{
    const body = mode === 'always' ? '{ return [this.value, arguments[0], ++count, {result: 4}]; }' : '[this.value, arguments[0], ++count, {result: 4}]';
    const source = `function owner(value) { let count = 0; const fn = () => ${body}; return JSON.stringify([fn(), fn(), count]); } owner.call({value: 7}, 9);`;
    const formatted = rewrite(source, mode);
    expect(formatted).not.toBe(source);
    expect(virtualMachine.runInNewContext(formatted)).toBe(virtualMachine.runInNewContext(source));
});

test('preserves asynchronous return and promise behavior', async () =>
{
    const source = 'const fn = async value => { return await Promise.resolve(value + 1); }; fn(3);';
    const formatted = rewrite(source, 'always');
    expect(formatted).not.toBe(source);
    expect(await virtualMachine.runInNewContext(formatted)).toBe(await virtualMachine.runInNewContext(source));
});

test('preserves surrounding LGD contracts and refuses a source with compilation errors', () =>
{
    const source = 'Number count = 1;\nconst fn = value => { return value + count; };';
    const formatted = rewrite(source, 'always');
    const compiler = LgdCompiler.create();
    const before = compiler.compileToJs(source);
    const after = compiler.compileToJs(formatted);
    expect(formatted).not.toBe(source);
    expect(before.errors).toEqual([]);
    expect(after.errors).toEqual([]);
    expect(after.allDeclarations.map(entry => [ entry.name, entry.typeName ])).toEqual(before.allDeclarations.map(entry => [ entry.name, entry.typeName ]));
    const invalid = 'Number count = "invalid";\nconst fn = value => { return value + count; };';
    expect(rewrite(invalid, 'always')).toBe(invalid);
});
