const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');

/** @description Shared real compiler and atomic-source fixtures bound to this runner. */
const { fixture, quickFixFixture } = require('./fixServiceFixture')(jest);
const LgdEditorConfig = require('../../../src/Lgd/Formatting/LgdEditorConfig');
const LgdFormattingOptions = require('../../../src/Lgd/Formatting/LgdFormattingOptions');


/** @description Isolates expression behavior from independently configured whitespace preferences. */
function expressionConfiguration()
{
    const mapped = LgdEditorConfig.map(Object.fromEntries([[ 'dotnet_style_prefer_simplified_boolean_expressions', 'true:warning' ]]));
    const rules = Object.fromEntries(LgdFormattingOptions.catalog.filter(rule => rule.id !== 'lgd.format.expressions').map(rule => [ rule.id, { severity: 'off' } ]));
    return { autoFix: false, formatting: { enabled: true, options: mapped.options }, rules: { ...rules, ...mapped.rules } };
}

jest.mock('vscode', () =>
{
    const api = require('./fakeVscode').createFakeVscode(jest);

    api.CodeAction = jest.fn((title, kind) => ({ title: title, kind: kind }));
    api.CodeActionKind = jest.fn(value => ({ value: value }));
    api.CodeActionKind.QuickFix = { value: 'quickfix' };
    api.commands.registerCommand = jest.fn();
    api.languages.registerCodeActionsProvider = jest.fn();
    api.workspace.registerTextDocumentContentProvider = jest.fn();
    api.window = { setStatusBarMessage: jest.fn(), showInformationMessage: jest.fn(), showWarningMessage: jest.fn(), showQuickPick: jest.fn(), withProgress: jest.fn() };
    api.ProgressLocation = { Notification: 15 };
    api.Uri = { file: filename => require('./fakeVscode').makeTextDocument(`file://${filename}`, '').uri };
    api.RelativePattern = jest.fn((base, pattern) => ({ base: base, pattern: pattern }));
    api.workspace.findFiles = jest.fn();
    api.workspace.getWorkspaceFolder = jest.fn();
    api.languages.createDiagnosticCollection = jest.fn(() => ({ set: jest.fn(), clear: jest.fn(), delete: jest.fn(), dispose: jest.fn() }));
    return api;
});

/** @description Original mirror-edit implementation, restored between fixtures. */
const baseApply = vscode.workspace.applyEdit.getMockImplementation();

/** @description Restores document creation after discovery tests customize file opening. */
const baseOpen = vscode.workspace.openTextDocument.getMockImplementation();

beforeEach(() =>
{
    vscode.__reset();
    vscode.workspace.applyEdit.mockImplementation(baseApply);
    vscode.workspace.openTextDocument.mockImplementation(baseOpen);
    vscode.workspace.isTrusted = true;
    vscode.workspace.workspaceFolders = [];
    vscode.workspace.textDocuments = [];
    vscode.window.activeTextEditor = undefined;
    vscode.window.showQuickPick.mockReset();
    vscode.window.showWarningMessage.mockReset();
    vscode.window.withProgress.mockImplementation((options, callback) => callback({ report: jest.fn() }, {}));
});

test('fixes all screenshot readonly locals in the unsaved buffer, preserves members, and is idempotent', async () =>
{
    const source = 'readonly Object editor = null;\r\nreadonly Number currentLine = 1;\r\nclass Example { readonly Number value; Example() { this.value = 1; } }';
    const { fixes, document } = await fixture(source);
    const batch = await fixes.plan([document], { scope: 'document', automatic: false });
    expect(batch.plan.entries).toHaveLength(2);
    expect(await fixes.applyBatch(batch, true)).toBe(true);
    expect(document.getText()).toBe(source.replace('readonly Object', 'const Object').replace('readonly Number currentLine', 'const Number currentLine'));
    expect((await fixes.plan([document], { automatic: false })).plan.entries).toHaveLength(0);
});

test('requires global and per-rule opt-in for native save actions', async () =>
{
    const { fixes, document, config } = await fixture('readonly Number value = 1;');
    const context = { only: { contains: kind => kind.value === 'source.fixAll.lgd' } };
    expect(await fixes.provideCodeActions(document, null, context, {})).toEqual([]);
    config.autoFix = true;
    expect(await fixes.provideCodeActions(document, null, context, {})).toEqual([]);
    config.rules['readonly-variable-declaration'] = { fix: 'automatic' };
    const [action] = await fixes.provideCodeActions(document, null, context, {});
    expect(action.kind.value).toBe('source.fixAll.lgd');
    expect(await fixes.applyPending(action.command.arguments[0])).toBe(true);
    expect(document.getText()).toBe('const Number value = 1;');
});

test('never automatically makes a base virtual even when its rule is set to automatic', async () =>
{
    const source = 'class Base { void run() {} }\nclass Child : Base { override void run() {} }';
    const { fixes, document } = await fixture(source, { autoFix: true, rules: { 'nonvirtual-base': { fix: 'automatic' } } });
    expect((await fixes.plan([document], { automatic: true })).plan.entries).toHaveLength(0);
    expect((await fixes.plan([document], { automatic: false })).plan.entries).toHaveLength(1);
    expect(document.getText()).toBe(source);
});

test.each([ 'source', 'configuration', 'cancellation', 'trust' ])('rejects a prepared plan after %s changes', async changed =>
{
    const { fixes, document } = await fixture('readonly Number value = 1;');
    const token = {};
    const batch = await fixes.plan([document], { scope: 'document', automatic: false, token: token });
    if(changed === 'source')
    {
        document.version++;
    }
    else if(changed === 'configuration')
    {
        fixes.configuration.isCurrent.mockResolvedValue(false);
    }
    else if(changed === 'cancellation')
    {
        token.isCancellationRequested = true;
    }
    else
    {
        vscode.workspace.isTrusted = false;
    }

    expect(await fixes.applyBatch(batch, true)).toBe(false);
    expect(document.getText()).toBe('readonly Number value = 1;');
});

test('disabled rules, ignored sources and invalid configuration produce no batch edits', async () =>
{
    const { fixes, document, config } = await fixture('readonly Number value = 1;');
    for(const override of [ { rules: { 'readonly-variable-declaration': { fix: 'off' } } }, { ignored: true }, { valid: false } ])
    {
        Object.assign(config, override);
        expect((await fixes.plan([document], { automatic: false })).plan.entries).toHaveLength(0);
    }
});

test('project discovery respects nested project boundaries and solution discovery spans workspace folders', async () =>
{
    const { fixes, document } = await fixture('readonly Number value = 1;');
    const nested = makeTextDocument('file:///project/nested/child.lgd', 'readonly Number value = 2;');
    nested.languageId = 'lgd';
    vscode.workspace.workspaceFolders = [ { uri: vscode.Uri.file('/project') }, { uri: vscode.Uri.file('/other') } ];
    vscode.workspace.findFiles.mockResolvedValue([ document.uri, nested.uri ]);
    vscode.workspace.openTextDocument.mockImplementation(uri =>
    {
        if(uri.toString() === nested.uri.toString())
        {
            return nested;
        }

        return document;
    });

    fixes.configuration.resolve.mockImplementation(target => Promise.resolve({ valid: true, ignored: false, rules: {}, root: target.uri.toString() === nested.uri.toString() ? '/project/nested' : '/project' }));
    expect(await fixes.documents('project', document, {})).toEqual([document]);
    expect(await fixes.documents('solution', document, {})).toEqual([ document, nested ]);
});

test('project commands require consent and cancellation leaves source unchanged', async () =>
{
    const { fixes, document } = await fixture('readonly Number value = 1;');
    fixes.documents = jest.fn(() => Promise.resolve([document]));
    vscode.window.withProgress.mockImplementation((options, callback) => callback({ report: jest.fn() }, {}));
    vscode.window.showWarningMessage.mockResolvedValue('Cancel');
    expect(await fixes.run('project', { document: document })).toBe(false);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('1 LGD fixes'), 'Review changes', 'Apply fixes', 'Cancel');
    expect(document.getText()).toBe('readonly Number value = 1;');
});

test('safe-only iterations do not introduce unreviewed semantic edits', async () =>
{
    const source = 'readonly Number count = 1; class Base { void run() {} } class Child : Base { override void run() {} }';
    const { fixes, document } = await fixture(source, { rules: { 'nonvirtual-base': { fix: 'manual' } } });
    const batch = await fixes.plan([document], { automatic: false, safeOnly: true });
    expect(batch.plan.entries).toHaveLength(1);
    expect(batch.plan.entries[0].handler.ruleId).toBe('readonly-variable-declaration');
});

test('one invalid project does not block safe fixes in an independent valid project', async () =>
{
    const { fixes, document, config } = await fixture('readonly Number value = 1;');
    const other = makeTextDocument('file:///invalid/other.lgd', 'readonly Number value = 2;');
    fixes.configuration.resolve.mockImplementation(target => Promise.resolve(target === other ? { valid: false, rules: {} } : config));
    const batch = await fixes.plan([ document, other ], { automatic: false });
    expect(batch.plan.entries).toHaveLength(1);
    expect(batch.configurations).toHaveLength(1);
    expect(await fixes.applyBatch(batch, false)).toBe(true);
});

test('rechecks open config buffers synchronously after asynchronous policy checks', async () =>
{
    const { fixes, document } = await fixture('readonly Number value = 1;');
    const batch = await fixes.plan([document], { automatic: false });
    fixes.configuration.buffersCurrent.mockReturnValue(false);
    expect(await fixes.applyBatch(batch, true)).toBe(false);
});

test('serializes concurrent apply requests and recovers its queue after a failed request', async () =>
{
    const { fixes } = await fixture('readonly Number value = 1;');
    let release;
    const first = new Promise(resolve =>
    {
        release = resolve;
    });
    fixes._applyBatch = jest.fn().mockImplementationOnce(() => first).mockRejectedValueOnce(new Error('apply failed')).mockResolvedValue(true);
    const pendingFirst = fixes.applyBatch({}, false);
    const pendingSecond = fixes.applyBatch({}, false);
    const rejected = expect(pendingSecond).rejects.toThrow('apply failed');
    await Promise.resolve();
    expect(fixes._applyBatch).toHaveBeenCalledTimes(1);
    release(true);
    expect(await pendingFirst).toBe(true);
    await rejected;
    expect(await fixes.applyBatch({}, false)).toBe(true);
});

test('cancellation during asynchronous policy validation prevents the pending edit', async () =>
{
    const { fixes, document } = await fixture('readonly Number value = 1;');
    const token = {};
    const batch = await fixes.plan([document], { automatic: false, token: token });
    fixes.configuration.isCurrent.mockImplementation(() =>
    {
        token.isCancellationRequested = true;
        return Promise.resolve(true);
    });

    expect(await fixes.applyBatch(batch, false)).toBe(false);
});

test('a target policy is read once and never replaced with a newer policy during the same plan', async () =>
{
    const { fixes, document, service, config } = await fixture('readonly Number value = 1;');
    const other = makeTextDocument('file:///project/consumer.lgd', '');
    const state = service.getState(document.uri);
    const [entry] = await fixes.engine.collect(document, state, state.errors);
    entry.document = other;
    fixes.engine.currentState = jest.fn(() => Promise.resolve(state));
    fixes.engine.collect = jest.fn().mockResolvedValueOnce([entry]).mockResolvedValueOnce([]);
    fixes.configuration.resolve.mockImplementation(() => Promise.resolve(config));
    await fixes.plan([ other, document ], { automatic: false });
    expect(fixes.configuration.resolve.mock.calls.filter(([target]) => target === document)).toHaveLength(1);
});

test('a manifest-only project identity change invalidates a prepared fix', async () =>
{
    const { fixes, document, service } = await fixture('readonly Number value = 1;');
    const externals = service.getState(document.uri).externals;
    externals.sourceContext = { projectId: '/project/first.csproj' };
    const batch = await fixes.plan([document], { automatic: false });
    service.collectExternalTypes = jest.fn(() =>
    {
        const current = new Map();
        current.sourceContext = { projectId: '/project/second.csproj' };
        return Promise.resolve(current);
    });

    expect(await fixes.applyBatch(batch, false)).toBe(false);
    expect(document.getText()).toBe('readonly Number value = 1;');
});

test.each([
    [ 'class-constructor-name', 'class Example { constructor() { this.value = 1; } }' ],
    [ 'object-inheritance', 'class Example {\r\n    Example() {\r\n        const Object instance = Object.create(Example);\r\n        instance.value = 1;\r\n        return instance;\r\n    }\r\n}' ]
])('keeps %s migrations manual even with automatic configuration', async (ruleId, source) =>
{
    const { fixes, document } = await fixture(source, { autoFix: true, rules: { [ruleId]: { fix: 'automatic' } } });
    expect((await fixes.plan([document], { automatic: true })).plan.entries).toHaveLength(0);
    expect((await fixes.plan([document], { automatic: false })).plan.entries).toHaveLength(1);
    expect(document.getText()).toBe(source);
});

test('allows the narrowly safe return-this fix without enabling factory migration automatically', async () =>
{
    const source = 'class Example { Example() { this.value = 1; return this; } }';
    const { fixes, document } = await fixture(source, { autoFix: true, rules: { 'constructor-return-value': { fix: 'automatic' } } });
    const batch = await fixes.plan([document], { automatic: true });
    expect(batch.plan.entries).toHaveLength(1);
    expect(batch.plan.entries[0].proposal.newText).toBe(' ');
    expect(document.getText()).toBe(source);
});

test('native save actions inherit a family mode while respecting a per-option manual override', async () =>
{
    const { fixes, document } = await fixture('Number count=1;', {
        autoFix: true,
        formatting: { enabled: true, options: {} },
        rules: { 'lgd.format.spacing': { fix: 'automatic' }, 'lgd.format.spacing.beforeAssignment': { fix: 'manual' } }
    });
    const batch = await fixes.plan([document], { automatic: true });
    expect(batch.plan.entries.map(entry => entry.handler.ruleId)).toEqual(['lgd.format.spacing.afterAssignment']);
    expect(await fixes.applyBatch(batch, true)).toBe(true);
    expect(document.getText()).toBe('Number count= 1;');
});

test('style diagnostic severity is independent of compiler errors and fix enablement', async () =>
{
    const { fixes, document, service, config } = await fixture('Number count=1;', {
        formatting: { enabled: true, options: {} },
        rules: { 'lgd.format.spacing': { fix: 'off', severity: 'error' } }
    });
    await fixes.formattingDiagnostics.refresh(document);
    const diagnostics = fixes.formattingDiagnostics.collection.set.mock.calls[0][1];
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Error && diagnostic.code === 'style')).toBe(true);
    expect(service.getState(document.uri).errors).toEqual([]);
    expect((await fixes.plan([document], { automatic: false })).plan.entries).toEqual([]);
    config.rules['lgd.format.spacing'].severity = 'off';
    await fixes.formattingDiagnostics.refresh(document);
    expect(fixes.formattingDiagnostics.collection.set.mock.calls.slice(-1)[0][1]).toEqual([]);
    config.valid = false;
    await fixes.formattingDiagnostics.refresh(document);
    expect(fixes.formattingDiagnostics.collection.delete).toHaveBeenCalledWith(document.uri);
});

test('every contributing option must permit an automatic formatting edit', async () =>
{
    const { fixes, config } = await fixture('Number count=1;', {
        autoFix: true,
        formatting: { enabled: true, options: {} },
        rules: { 'lgd.format.spacing': { fix: 'automatic' }, 'lgd.format.whitespace': { fix: 'manual' } }
    });
    const handler = fixes.ruleHandlers.get('lgd.format.spacing.beforeAssignment');
    const error = { relatedRuleIds: ['lgd.format.whitespace.endOfLine'] };
    expect(fixes.eligibleError(handler, error, config, { automatic: true })).toBe(false);
    config.rules['lgd.format.whitespace'].fix = 'automatic';
    expect(fixes.eligibleError(handler, error, config, { automatic: true })).toBe(true);
});

test('EditorConfig expression styles register diagnostics, manual fixes and opt-in save actions', async () =>
{
    const source = 'function choose(value) { return value ? true : false; }';
    const { fixes, document, config } = await fixture(source, expressionConfiguration());
    await fixes.formattingDiagnostics.refresh(document);
    const diagnostics = fixes.formattingDiagnostics.collection.set.mock.calls[0][1];
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('style');
    expect(diagnostics[0].severity).toBe(vscode.DiagnosticSeverity.Warning);
    const batch = await fixes.plan([document], { scope: 'document', automatic: false });
    expect(batch.plan.entries.map(entry => entry.handler.ruleId)).toEqual(['lgd.format.expressions.booleanSimplification']);
    expect((await fixes.plan([document], { automatic: true })).plan.entries).toHaveLength(0);
    config.autoFix = true;
    expect((await fixes.plan([document], { automatic: true })).plan.entries).toHaveLength(0);
    config.rules['lgd.format.expressions'] = { fix: 'automatic' };
    expect((await fixes.plan([document], { automatic: true })).plan.entries).toHaveLength(1);
    config.rules['lgd.format.expressions.booleanSimplification'].fix = 'off';
    expect((await fixes.plan([document], { automatic: false })).plan.entries).toHaveLength(0);
    config.rules['lgd.format.expressions.booleanSimplification'].fix = 'automatic';
    const ready = await fixes.plan([document], { automatic: true });
    expect(await fixes.applyBatch(ready, true)).toBe(true);
    expect(document.getText()).toBe('function choose(value) { return !!(value); }');
    expect((await fixes.plan([document], { automatic: true })).plan.entries).toHaveLength(0);
});

test.each([ 'document', 'project', 'solution' ])('expression Fix All uses guarded edits in %s scope', async scope =>
{
    const source = 'function choose(value) { return value ? true : false; }';
    const { fixes, document, service } = await fixture(source, expressionConfiguration());
    const unrelated = makeTextDocument('file:///project/untouched.lgd', 'function choose(value) { return value ? 1 : 0; }');
    unrelated.version = 1;
    unrelated.languageId = 'lgd';
    await service.openDocument(unrelated);
    const javascript = makeTextDocument('file:///project/untouched.js', source);
    javascript.languageId = 'javascript';
    vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/project') }];
    vscode.workspace.textDocuments = [ document, unrelated, javascript ];
    vscode.workspace.findFiles.mockResolvedValue([]);
    const discovered = await fixes.documents(scope, document, {});
    expect(discovered).not.toContain(javascript);
    const batch = await fixes.plan(discovered, { scope: scope, automatic: false });
    expect(batch.plan.entries).toHaveLength(1);
    expect(batch.plan.entries[0].document.uri.toString()).toBe(document.uri.toString());
    expect(await fixes.applyBatch(batch, true)).toBe(true);
    expect(document.getText()).toContain('!!(value)');
    expect(unrelated.getText()).toBe('function choose(value) { return value ? 1 : 0; }');
    expect(javascript.getText()).toBe(source);
});

test('settles arrow-body style and overlapping whitespace through the complete fix engine', async () =>
{
    const source = 'const fn = value => { return value + 1; };';
    const { fixes, document } = await fixture(source, {
        formatting: { enabled: true, options: { expressions: { lambdaBodies: 'always' } } }
    });
    const first = await fixes.plan([document], { scope: 'document', automatic: false });
    expect(first.plan.entries.length).toBeGreaterThan(0);
    expect(await fixes.applyBatch(first, true)).toBe(true);
    expect(document.getText()).toBe('const fn = value => (value + 1);');
    expect((await fixes.plan([document], { scope: 'document', automatic: false })).plan.entries).toHaveLength(0);
});

test('imports unreachable severity without enabling cleanup or automatic application', () =>
{
    const mapped = LgdEditorConfig.map({ 'dotnet_diagnostic.ide0035.severity': 'error' });
    expect(mapped.options).toEqual({});
    expect(mapped.rules['lgd.format.cleanup.unreachableStatements']).toEqual({ severity: 'error' });
    expect(mapped.issues).toEqual([]);
    const policy = require('../../../src/Lgd/Fixes/LgdFormattingRules');

    const config = { valid: true, formatting: { enabled: true, options: {} }, rules: mapped.rules };
    expect(policy.analyze('function run() { return 1; work(); }', config).filter(error => error.ruleId.startsWith('lgd.format.cleanup.'))).toEqual([]);
    const schema = require('../../../schemas/lgd.schema.json');
    const catalog = require('../../../src/Lgd/Formatting/LgdCleanupStyleOptions').catalog;

    expect(schema.properties.formatting.properties.options.properties.cleanup.properties).toEqual(catalog.properties);
    for(const option of Object.keys(catalog.properties))
    {
        expect(schema.definitions.rules.properties[`${catalog.id}.${option}`]).toBeDefined();
    }
});

test.each([ 'document', 'project', 'solution' ])('cleanup Fix All enforces opt-in and safe mixed-file edits in %s scope', async scope =>
{
    const source = 'function run() { const unused = 1; return 2; work(); }';
    const rules = Object.fromEntries(LgdFormattingOptions.catalog.filter(rule => rule.id !== 'lgd.format.cleanup').map(rule => [ rule.id, { severity: 'off' } ]));
    const { fixes, document, service, config } = await fixture(source, {
        formatting: { enabled: true, options: { cleanup: { unusedLocals: 'remove', unreachableStatements: 'remove' } } }, rules: rules
    });
    const unsafe = makeTextDocument('file:///project/unsafe.lgd', 'function run() { const unused = effect(); return 2; }');
    unsafe.version = 1;
    unsafe.languageId = 'lgd';
    await service.openDocument(unsafe);
    const javascript = makeTextDocument('file:///project/untouched.js', source);
    javascript.languageId = 'javascript';
    vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/project') }];
    vscode.workspace.textDocuments = [ document, unsafe, javascript ];
    vscode.workspace.findFiles.mockResolvedValue([]);
    const documents = await fixes.documents(scope, document, {});
    expect(documents).not.toContain(javascript);
    expect((await fixes.plan(documents, { scope: scope, automatic: true })).plan.entries).toHaveLength(0);
    config.autoFix = true;
    expect((await fixes.plan(documents, { scope: scope, automatic: true })).plan.entries).toHaveLength(0);
    config.rules['lgd.format.cleanup'] = { fix: 'automatic' };
    expect((await fixes.plan(documents, { scope: scope, automatic: true })).plan.entries).toHaveLength(2);
    config.rules['lgd.format.cleanup.unusedLocals'] = { fix: 'off' };
    expect((await fixes.plan(documents, { scope: scope, automatic: false })).plan.entries).toHaveLength(1);
    config.rules['lgd.format.cleanup.unusedLocals'] = { severity: 'off' };
    expect((await fixes.plan(documents, { scope: scope, automatic: false })).plan.entries).toHaveLength(1);
    config.rules['lgd.format.cleanup.unusedLocals'] = { fix: 'automatic' };
    const batch = await fixes.plan(documents, { scope: scope, automatic: true });
    expect(await fixes.applyBatch(batch, true)).toBe(true);
    expect(document.getText()).toBe('function run() {  return 2;  }');
    expect(unsafe.getText()).toBe('function run() { const unused = effect(); return 2; }');
    expect(javascript.getText()).toBe(source);
    expect((await fixes.plan(documents, { scope: scope, automatic: true })).plan.entries).toHaveLength(0);
});

test.each([ 'document', 'project', 'solution' ])('declaration imports reach the shared %s diagnostic and quick-fix plan', async scope =>
{
    const adapter = require('../../../src/Lgd/Formatting/LgdEditorConfig');

    const imported = adapter.map(Object.fromEntries([[ 'csharp_style_var_for_built_in_types', 'false:error' ]]));
    const { fixes, document } = await fixture('const amount = 42;', {
        autoFix: true, formatting: { enabled: true, options: imported.options },
        rules: { ...imported.rules, 'lgd.format.declarations': { fix: 'automatic' } }
    });
    await fixes.formattingDiagnostics.refresh(document);
    const diagnostics = fixes.formattingDiagnostics.collection.set.mock.calls.at(-1)[1];
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(vscode.DiagnosticSeverity.Error);
    const batch = await fixes.plan([document], { scope: scope, automatic: true });
    expect(batch.plan.entries.map(entry => entry.handler.ruleId)).toEqual(['lgd.format.declarations.localTypes']);
    expect(await fixes.applyBatch(batch, true)).toBe(true);
    expect(document.getText()).toBe('const Number amount = 42;');
});

test('declaration save actions require global opt-in and respect manual/off leaf overrides', async () =>
{
    const { fixes, document, config } = await fixture('const amount = 42;', {
        formatting: { enabled: true, options: { declarations: { localTypes: 'explicit' } } },
        rules: { 'lgd.format.declarations': { fix: 'automatic' } }
    });
    const context = { only: { contains: kind => kind.value === 'source.fixAll.lgd' } };
    expect(await fixes.provideCodeActions(document, null, context, {})).toEqual([]);
    config.autoFix = true;
    config.rules['lgd.format.declarations.localTypes'] = { fix: 'manual' };
    expect((await fixes.plan([document], { automatic: true })).plan.entries).toEqual([]);
    expect((await fixes.plan([document], { automatic: false })).plan.entries).toHaveLength(1);
    config.rules['lgd.format.declarations.localTypes'].fix = 'off';
    expect((await fixes.plan([document], { automatic: false })).plan.entries).toEqual([]);
    config.rules['lgd.format.declarations.localTypes'] = { fix: 'automatic', severity: 'off' };
    expect((await fixes.plan([document], { automatic: true })).plan.entries).toEqual([]);
    expect(document.getText()).toBe('const amount = 42;');
});

test('declaration project plans retain safe files while declining a nominal type shadow', async () =>
{
    const { fixes, document, service } = await fixture('const amount = 42;', {
        autoFix: true, formatting: { enabled: true, options: { declarations: { localTypes: 'explicit' } } },
        rules: { 'lgd.format.declarations': { fix: 'automatic' } }
    });
    const shadowed = makeTextDocument('file:///project/shadowed.lgd', 'class Number {}\nconst amount = 42;');
    shadowed.version = 1;
    shadowed.languageId = 'lgd';
    await service.openDocument(shadowed);
    const batch = await fixes.plan([ document, shadowed ], { scope: 'project', automatic: true });
    expect(batch.plan.entries).toHaveLength(1);
    expect(batch.plan.entries[0].document).toBe(document);
    expect(shadowed.getText()).toBe('class Number {}\nconst amount = 42;');
});

test('IDE0004 severity refreshes compiler presentation without authorizing automatic fixes or hiding errors', async () =>
{
    const source = 'class Item {}\nconst Item original = Item.create();\nconst value = (Item)original;\nconst wrong = (String)true;';
    const { fixes, document, service, config } = await fixture(source, {
        autoFix: true, rules: { 'unnecessary-reference-cast': { severity: 'error' } }
    });
    await fixes.formattingDiagnostics.refresh(document);
    let diagnostics = service.diagnosticCollection.set.mock.calls.slice(-1)[0][1];
    expect(diagnostics.find(error => error.code === 'style').severity).toBe(vscode.DiagnosticSeverity.Error);
    expect((await fixes.plan([document], { automatic: true })).plan.entries).toEqual([]);
    config.rules['unnecessary-reference-cast'].severity = 'warning';
    await fixes.formattingDiagnostics.refresh(document);
    diagnostics = service.diagnosticCollection.set.mock.calls.slice(-1)[0][1];
    expect(diagnostics.find(error => error.code === 'style').severity).toBe(vscode.DiagnosticSeverity.Warning);
    config.rules['unnecessary-reference-cast'].severity = 'off';
    await fixes.formattingDiagnostics.refresh(document);
    diagnostics = service.diagnosticCollection.set.mock.calls.slice(-1)[0][1];
    expect(diagnostics.some(error => error.code === 'style')).toBe(false);
    expect(diagnostics.some(error => error.message.includes('Cannot cast Boolean to String'))).toBe(true);
    expect((await fixes.analysisRequest(document, service.getState(document.uri))).state.errors.some(error => error.code === 'lgd.cast.redundant')).toBe(false);
    expect(service.getState(document.uri).errors.some(error => error.code === 'lgd.cast.redundant')).toBe(true);
});

test('terminal-return cleanup obeys its independent fix opt-out', async () =>
{
    const source = 'class Example\n{\n    Example()\n    {\n        return this;\n    }\n}';
    const { fixes, document, config } = await fixture(source, { autoFix: true, rules: { 'constructor-return-value': { fix: 'off' } } });
    expect((await fixes.plan([document], { automatic: false })).plan.entries).toEqual([]);
    expect(document.getText()).toBe(source);
    config.rules['constructor-return-value'].fix = 'automatic';
    const batch = await fixes.plan([document], { automatic: true });
    expect(await fixes.applyBatch(batch, true)).toBe(true);
    expect(document.getText()).toBe('class Example\n{\n    Example()\n    {\n    }\n}');
    expect((await fixes.plan([document], { automatic: true })).plan.entries).toEqual([]);
});

test.each([ 'lgd.format.lineBreaks.separateDefinitions', 'lgd.format.wrapping.binaryOperations' ])('respects the default-layout fix opt-out for %s', async ruleId =>
{
    const source = 'class Example\n{\n    Example() { }\n    Number add(Number first)\n    {\n        return first\n            + 1;\n    }\n}';
    const { fixes, document } = await fixture(source, { formatting: { enabled: true, options: {} }, rules: { [ruleId]: { fix: 'off' } } });
    const batch = await fixes.plan([document], { automatic: false });
    expect(batch.plan.edits.every(edit => !edit.ruleIds.includes(ruleId))).toBe(true);
    expect(await fixes.applyBatch(batch, true)).toBe(true);
    const formatted = document.getText();
    if(ruleId.endsWith('separateDefinitions'))
    {
        expect(formatted).toContain('Example() { }\n    Number add');
        expect(formatted).toContain('return first + 1;');
    }
    else
    {
        expect(formatted).toContain('Example() { }\n\n    Number add');
        expect(formatted).toContain('return first\n');
    }
});

describe('Fix All in the native diagnostic quick-fix menu', () =>
{
    test('offers a generic scope picker when hovering this and preserves terminal versus early return behavior', async () =>
    {
        const source = await fs.promises.readFile(path.join(__dirname, '../../fixtures/fix-all-hover.lgd'), 'utf8');
        const { fixes, document, diagnostics, provider } = await quickFixFixture(source);
        const returnDiagnostics = diagnostics.filter(diagnostic => document.getText(diagnostic.range) === 'this');
        expect(returnDiagnostics).toHaveLength(2);
        const position = document.positionAt(source.indexOf('return this;') + 'return th'.length);
        const range = new vscode.Range(position, position);
        const context = { diagnostics: [returnDiagnostics[0]], only: { contains: kind => kind.value === 'quickfix' } };
        const actions = await provider.provideCodeActions(document, range, context, {});
        expect(actions.map(action => action.title)).toEqual([ 'Replace return this with an early exit', 'Fix All…' ]);
        const action = actions[1];
        expect(action.kind).toBe(vscode.CodeActionKind.QuickFix);
        expect(action.isPreferred).toBe(false);
        expect(action.diagnostics).toEqual([returnDiagnostics[0]]);
        expect(action.command).toEqual({ command: 'lgd.fixAll', title: 'Fix All…', arguments: [document.uri] });

        fixes.formattingDiagnostics.register = jest.fn();
        fixes.configuration.register = jest.fn();
        fixes.register([]);
        const command = vscode.commands.registerCommand.mock.calls.find(([name]) => name === action.command.command)[1];
        vscode.workspace.openTextDocument.mockResolvedValueOnce(document);
        vscode.window.showQuickPick.mockResolvedValue({ scope: 'document' });
        expect(await command(...action.command.arguments)).toBe(true);
        expect(vscode.window.showQuickPick.mock.calls[0][0].map(item => item.scope)).toEqual([ 'document', 'project', 'solution' ]);
        expect(document.getText()).toContain('if(stop) return;');
        expect(document.getText()).not.toContain('return this;');
        expect(document.getText()).toContain('const Number amount = 2;');
        expect(fixes.languageService.getState(document.uri).errors).toEqual([]);
    });

    test('adds just one diagnostic-linked Fix All action for multiple eligible diagnostics', async () =>
    {
        const source = 'readonly Number first = 1; readonly Number second = 2;';
        const { document, diagnostics, provider, range } = await quickFixFixture(source);
        const actions = await provider.provideCodeActions(document, range, { diagnostics: diagnostics }, {});
        expect(actions).toHaveLength(diagnostics.length + 1);
        const bulk = actions.filter(action => action.command.command === 'lgd.fixAll');
        expect(bulk).toHaveLength(1);
        expect(bulk[0].diagnostics).toEqual(diagnostics);
    });

    test.each([
        { rules: { 'readonly-variable-declaration': { fix: 'off' } } },
        { rules: { 'readonly-variable-declaration': { severity: 'off' } } },
        { ignored: true },
        { valid: false }
    ])('does not expose bulk fixing for disabled or excluded configuration %j', async options =>
    {
        const { document, diagnostics, provider, range } = await quickFixFixture('readonly Number value = 1;', options);
        const actions = await provider.provideCodeActions(document, range, { diagnostics: diagnostics }, {});
        expect(actions.some(action => action.command.command === 'lgd.fixAll')).toBe(false);
    });

    test.each([ 'cancelled', 'stale', 'untrusted', 'unsupported scheme', 'other language', 'source action', 'unrelated diagnostic', 'outside range' ])('does not expose a bulk action in a %s context', async condition =>
    {
        const { document, diagnostics, provider, range } = await quickFixFixture('readonly Number value = 1;');
        const context = { diagnostics: diagnostics };
        const token = { isCancellationRequested: condition === 'cancelled' };
        let requestedRange = range;
        if(condition === 'stale') document.version++;
        if(condition === 'untrusted') vscode.workspace.isTrusted = false;
        if(condition === 'unsupported scheme') document.uri.scheme = 'git';
        if(condition === 'other language') document.languageId = 'javascript';
        if(condition === 'source action') context.only = { contains: kind => kind.value === 'source.fixAll.lgd' };
        if(condition === 'unrelated diagnostic') diagnostics[0].source = 'Other extension';
        if(condition === 'outside range') requestedRange = new vscode.Range(document.positionAt(document.getText().length), document.positionAt(document.getText().length));
        const actions = await provider.provideCodeActions(document, requestedRange, context, token);
        expect(actions.some(action => action.command.command === 'lgd.fixAll')).toBe(false);
    });

    test('allows manual fixes in an untitled LGD buffer without enabling save actions', async () =>
    {
        const { document, diagnostics, provider, range, fixes } = await quickFixFixture('readonly Number value = 1;');
        document.uri.scheme = 'untitled';
        const actions = await provider.provideCodeActions(document, range, { diagnostics: diagnostics }, {});
        expect(actions.some(action => action.command.command === 'lgd.fixAll')).toBe(true);
        const sourceContext = { only: { contains: kind => kind.value === 'source.fixAll.lgd' } };
        expect(await fixes.provideCodeActions(document, range, sourceContext, {})).toEqual([]);
    });

    test('requires manual bulk opt-in for semantic fixes and keeps the review prompt', async () =>
    {
        const source = 'class Base { void run() {} }\nclass Child : Base { override void run() {} }';
        const { document, diagnostics, provider, range, fixes, config } = await quickFixFixture(source);
        const context = { diagnostics: diagnostics };
        const individual = await provider.provideCodeActions(document, range, context, {});
        expect(individual.map(action => action.title)).toEqual(['Make Base.run virtual']);
        config.rules['nonvirtual-base'] = { fix: 'manual' };
        const enabled = await provider.provideCodeActions(document, range, context, {});
        expect(enabled.map(action => action.title)).toEqual([ 'Make Base.run virtual', 'Fix All…' ]);
        vscode.workspace.openTextDocument.mockResolvedValueOnce(document);
        vscode.window.showQuickPick.mockResolvedValue({ scope: 'document' });
        vscode.window.showWarningMessage.mockResolvedValue('Cancel');
        expect(await fixes.chooseScope(enabled[1].command.arguments[0])).toBe(false);
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('Includes changes to contracts or behavior.'), 'Review changes', 'Apply fixes', 'Cancel');
        expect(document.getText()).toBe(source);
    });

    test('withholds bulk fixing for an unsafe return and unrelated available fixes elsewhere', async () =>
    {
        const source = 'class Command { Command() { return initializeOther(); } } readonly Number value = 1;';
        const { document, diagnostics, provider } = await quickFixFixture(source);
        const diagnostic = diagnostics.find(candidate => document.getText(candidate.range) === 'initializeOther()');
        expect(await provider.provideCodeActions(document, diagnostic.range, { diagnostics: [diagnostic] }, {})).toEqual([]);
    });

    test.each([ 'document', 'project', 'solution' ])('keeps the original document when choosing %s after the active editor changes', async scope =>
    {
        const { fixes, document } = await fixture('readonly Number value = 1;');
        const other = makeTextDocument('file:///other/changed.lgd', 'readonly Number other = 2;');
        vscode.window.activeTextEditor = { document: other };
        vscode.workspace.openTextDocument.mockResolvedValueOnce(document);
        vscode.window.showQuickPick.mockResolvedValue({ scope: scope });
        fixes.run = jest.fn(() => true);
        expect(await fixes.chooseScope(document.uri)).toBe(true);
        expect(fixes.run).toHaveBeenCalledWith(scope, { document: document });
    });

    test('cancelling the scope picker applies nothing', async () =>
    {
        const { fixes, document } = await fixture('readonly Number value = 1;');
        vscode.workspace.openTextDocument.mockResolvedValueOnce(document);
        vscode.window.showQuickPick.mockResolvedValue();
        fixes.run = jest.fn();
        expect(await fixes.chooseScope(document.uri)).toBe(false);
        expect(fixes.run).not.toHaveBeenCalled();
    });

    test('rechecks configuration when Fix All is selected after opening the quick-fix menu', async () =>
    {
        const source = 'readonly Number value = 1;';
        const { document, diagnostics, provider, range, fixes, config } = await quickFixFixture(source);
        const actions = await provider.provideCodeActions(document, range, { diagnostics: diagnostics }, {});
        const action = actions.find(candidate => candidate.command.command === 'lgd.fixAll');
        config.rules['readonly-variable-declaration'] = { fix: 'off' };
        vscode.workspace.openTextDocument.mockResolvedValueOnce(document);
        vscode.window.showQuickPick.mockResolvedValue({ scope: 'document' });
        expect(await fixes.chooseScope(action.command.arguments[0])).toBe(false);
        expect(document.getText()).toBe(source);
    });
});
