const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdFixService = require('../../../src/Editors/VSCode/LgdFixService');


/** @description Creates real compiler diagnostics with controlled configuration and atomic source edits. */
async function fixture(source, options = {})
{
    const service = LgdLanguageService.create({ set: jest.fn(), delete: jest.fn() }, error =>
    {
        throw error;
    });

    const document = makeTextDocument('file:///project/example.lgd', source);
    document.version = 1;
    document.languageId = 'lgd';
    await service.openDocument(document);
    const fixes = LgdFixService.create(service);
    const config = { valid: true, ignored: false, root: '/project', autoFix: false, rules: {}, ...options };
    fixes.configuration = { resolve: jest.fn(() => Promise.resolve(config)), isCurrent: jest.fn(() => Promise.resolve(true)), buffersCurrent: jest.fn(() => true) };
    fixes.formattingDiagnostics.configuration = fixes.configuration;
    const baseApply = vscode.workspace.applyEdit.getMockImplementation();
    vscode.workspace.applyEdit.mockImplementation(edit =>
    {
        const sourceEdits = edit.replacements.filter(replacement => replacement.uri.toString() === document.uri.toString());
        const ordered = sourceEdits.sort((left, right) => document.offsetAt(right.range.start) - document.offsetAt(left.range.start));
        for(const replacement of ordered)
        {
            const start = document.offsetAt(replacement.range.start);
            const end = document.offsetAt(replacement.range.end);
            const text = document.getText();
            document.setText(text.slice(0, start) + replacement.newText + text.slice(end));
        }

        if(sourceEdits.length > 0)
        {
            document.version++;
        }

        return baseApply(edit);
    });

    return { service: service, fixes: fixes, document: document, config: config };
}

jest.mock('vscode', () =>
{
    const api = require('./fakeVscode').createFakeVscode(jest);

    api.CodeAction = jest.fn((title, kind) => ({ title: title, kind: kind }));
    api.CodeActionKind = jest.fn(value => ({ value: value }));
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
    expect(batch.plan.entries[0].proposal.newText).toBe('return;');
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
