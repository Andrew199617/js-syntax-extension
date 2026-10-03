const LgdFixSettings = require('../../../src/Lgd/Fixes/LgdFixSettings');
const LgdFixEngine = require('../../../src/Lgd/Fixes/LgdFixEngine');
const LgdFixPlan = require('../../../src/Lgd/Fixes/LgdFixPlan');
const DiagnosticQuickFix = require('../../../src/Lgd/QuickFixes/DiagnosticQuickFix');
const LgdFormattingRules = require('../../../src/Lgd/Fixes/LgdFormattingRules');

jest.mock('vscode', () =>
{
    throw new Error('Editor-neutral fix modules must not import vscode.');
});

test('settings parse and layer resolution do not require an editor SDK', () =>
{
    const settings = LgdFixSettings.create(['readonly-variable-declaration']);
    const layer = settings.parse('{"version":1,"rules":{"readonly-variable-declaration":{"fix":"automatic"}}}');
    const result = { rules: {}, formatting: { enabled: false, options: {} } };
    settings.applyLayers(result, [layer], 'Example.lgd');
    expect(result.rules['readonly-variable-declaration'].fix).toBe('automatic');
});

test('a host can supply plain buffers and rule handlers to the shared engine and offset plan', async () =>
{
    const document = { uri: { toString: () => 'host:example' }, version: 1, getText: () => 'readonly Number value = 1;' };
    const source = DiagnosticQuickFix.snapshot(document);
    const error = { code: 'lgd.declaration.readonly', quickFix: { kind: 'replaceReadonlyLocal' } };
    const state = { compiledVersion: 1, compiledText: document.getText(), errors: [error], externals: new Map() };
    const handler = { create: () => Promise.resolve({ target: source, snapshots: [source], offset: 0, endOffset: 'readonly'.length, newText: 'const' }) };
    const runtime = { getOutputOptions: () => ({}), collectExternalTypes: () => Promise.resolve(new Map()) };
    const adapter = { handlers: new Map([[ 'replaceReadonlyLocal', handler ]]), createContext: () => ({ prepare: () => Promise.resolve(true) }) };
    const engine = LgdFixEngine.create(runtime, adapter);
    const entries = await engine.collect(document, state, [error]);
    expect(await engine.isAnalysisCurrent(entries[0].proposal)).toBe(true);
    const plan = LgdFixPlan.create(entries);
    expect(LgdFixPlan.previews(plan)[0].after).toBe('const Number value = 1;');
    expect(plan.edits).toHaveLength(1);
});

test('formatting diagnostics are reusable without importing an editor SDK', () =>
{
    const errors = LgdFormattingRules.analyze('Number count=1;', { valid: true, rules: {}, formatting: { enabled: true, options: {} } });
    expect(errors.map(error => error.ruleId)).toContain('lgd.format.spacing.beforeAssignment');
    expect(errors.map(error => error.ruleId)).toContain('lgd.format.spacing.afterAssignment');
});
