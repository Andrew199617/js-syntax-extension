const virtualMachine = require('vm');
const LgdCleanupStyles = require('../../../../src/Lgd/Formatting/LgdCleanupStyles');
const LgdFormatter = require('../../../../src/Lgd/Formatting/LgdFormatter');

/** @description Both independent cleanup preferences are enabled only for these safety tests. */
const configuration = { options: { cleanup: { unusedLocals: 'remove', unreachableStatements: 'remove' } } };

it('keeps cleanup opt-in and independently honors each leaf severity', () =>
{
    const source = 'function run() { const unused = 1; return 2; work(); }';
    expect(LgdCleanupStyles.analyze(source)).toEqual([]);
    const selected = { ...configuration, rules: { 'lgd.format.cleanup.unusedLocals': { severity: 'off' } } };
    const findings = LgdCleanupStyles.analyze(source, selected);
    expect(findings.map(finding => finding.ruleId)).toEqual(['lgd.format.cleanup.unreachableStatements']);
});

it('removes only proven locals and unreachable expressions, preserving runtime behavior and settling', () =>
{
    const source = 'function run() { const unused = 1; return 2; missing(); } run();';
    const findings = LgdCleanupStyles.analyze(source, configuration);
    expect(findings).toHaveLength(2);
    const fixed = LgdFormatter.apply(source, findings);
    expect(virtualMachine.runInNewContext(fixed)).toBe(virtualMachine.runInNewContext(source));
    expect(LgdCleanupStyles.analyze(fixed, configuration)).toEqual([]);
});

it('maps unchanged LGD method bodies to the exact original source', () =>
{
    const source = 'class Entry { Number run() { const unused = 1; return 2; work(); } }';
    const findings = LgdCleanupStyles.analyze(source, configuration);
    expect(findings).toHaveLength(2);
    expect(LgdFormatter.apply(source, findings)).toBe('class Entry { Number run() {  return 2;  } }');
    for(const finding of findings)
    {
        expect(source.slice(finding.offset, finding.endOffset)).toBe(finding.expectedText);
    }
});

it.each([
    'function run() { const value = 1; return () => value; }',
    'function run() { const value = 1; value = 2; }',
    'function run() { const value = 1; return { value }; }',
    'function run() { const value = 1; return <value.Item />; }',
    'function run() { const value = 1; eval("value"); }',
    'function run() { with(scope) { const value = 1; } }',
    'const value = 1;',
    'export const value = 1;',
    'function run() { const value = effect(); }',
    'function run() { const value = source.property; }',
    'function run() { const { value } = source; }',
    'function run() { let value = 1; }',
    'function run() { const value = 1, other = 2; }',
    'function run() { /** Important local. */ const value = 1; }',
    'function run() { const value = 1; // Retain explanation\n }',
    'function run() { const value = 1; "use strict"; return this; }',
    'function run() { // lgd-format off\n const value = 1; }'
])('declines unsafe or deliberately unsupported unused cleanup: %s', source =>
{
    expect(LgdCleanupStyles.analyze(source, configuration)).toEqual([]);
});

it.each([
    'function run() { return 1; var hoisted = effect(); }',
    'function run() { return 1; function hoisted() {} }',
    'function run() { return 1; label: effect(); }',
    'function* run() { return 1; yield 2; }',
    'async function run() { return 1; await effect(); }',
    'function run() { return 1; (() => effect())(); }',
    'function run() { return 1; /* Keep reason. */ effect(); }',
    'function run() { return 1; effect(/* Keep argument. */); }',
    'function run() { if(ready) return 1; effect(); }',
    'function run() { return 1; if(ready) { effect(); } }'
])('retains declarations, comments and uncertain control flow: %s', source =>
{
    expect(LgdCleanupStyles.analyze(source, configuration)).toEqual([]);
});

it('resolves shadowing using bindings and preserves hoisted declarations after terminators', () =>
{
    const source = 'function run() { const value = 1; { const value = 2; use(value); } return typeof hoisted; var hoisted = 3; missing(); }';
    const findings = LgdCleanupStyles.analyze(source, configuration);
    expect(findings.map(finding => finding.expectedText).sort()).toEqual([ 'const value = 1;', 'missing();' ]);
});

it.each([
    'function run() { throw new Error(); missing(); }',
    'function run() { while(ready) { break; missing(); } }',
    'function run() { while(ready) { continue; missing(); } }'
])('recognizes immediate same-block terminators: %s', source =>
{
    expect(LgdCleanupStyles.analyze(source, configuration).map(finding => finding.expectedText)).toEqual(['missing();']);
});
