const vscode = require('vscode');

/** @description Shared real compiler and atomic-source fixtures bound to this runner. */
const { fixture, quickFixFixture } = require('./fixServiceFixture')(jest);
const LgdFormattingOptions = require('../../../src/Lgd/Formatting/LgdFormattingOptions');
const createLgdDiagnostics = require('../../../src/Lgd/LgdDiagnostics');

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

describe('Redundant inheritance documentation quick fixes', () =>
{
    test.each([
        [ '{GoToNextMethod}', '\n' ],
        [ 'GoToNextMethod', '\n' ],
        [ '{GoToNextMethod}', '\r\n' ],
        [ 'GoToNextMethod', '\r\n' ]
    ])('removes the screenshot @extends %s tag with %j line endings and retains all meaningful source', async (type, newline) =>
    {
        const lines = [ 'class GoToNextMethod { GoToNextMethod(String commandName, String title) {} }',
            '/**',
            ' * @description Command to help navigate in a window.',
            ` * @extends ${type}`,
            ' */',
            'class GoToLastMethod : GoToNextMethod',
            '{',
            '    /** @description Initialize an instance of GoToLastMethod. */',
            '    GoToLastMethod() : base("lgd.goToLastMethod", "Go To Last Method") {}',
            '}' ];
        const source = lines.join(newline);
        const { document, diagnostics, provider, range, fixes } = await quickFixFixture(source);
        const diagnostic = diagnostics.find(candidate => candidate.message.includes('redundant @extends'));
        expect(diagnostic.severity).toBe(vscode.DiagnosticSeverity.Warning);
        expect(document.getText(diagnostic.range)).toBe(`@extends ${type}`);
        const actions = await provider.provideCodeActions(document, range, { diagnostics: [diagnostic] }, {});
        const action = actions.find(candidate => candidate.title === 'Remove redundant inheritance documentation');
        expect(action.isPreferred).toBe(true);
        expect(await provider.applyFix(action.command.arguments[0])).toBe(true);
        expect(document.getText()).toBe(source.replace(` * @extends ${type}${newline}`, ''));
        expect(fixes.languageService.getState(document.uri).errors).toEqual([]);
        expect((await fixes.plan([document], { automatic: false })).plan.entries).toEqual([]);
        expect(await provider.applyFix(action.command.arguments[0])).toBe(false);
    });

    test.each([ '@extends {Base}', '@extends Base', '@augments {Base}' ])('drops an otherwise empty %s docblock without changing inheritance or base arguments', async tag =>
    {
        const source = `class Base { Base(String title) {} }\r\n/** ${tag} */\r\nclass Child : Base { Child() : base("title") {} }`;
        const { document, diagnostics, provider, range } = await quickFixFixture(source);
        const actions = await provider.provideCodeActions(document, range, { diagnostics: diagnostics }, {});
        const action = actions.find(candidate => candidate.title === 'Remove redundant inheritance documentation');
        expect(await provider.applyFix(action.command.arguments[0])).toBe(true);
        expect(document.getText()).toBe(source.replace(`/** ${tag} */\r\n`, ''));
    });

    test.each([
        'class Child { Child() {} }',
        'class Child : Other { Child() {} }'
    ])('keeps legacy-only or conflicting heritage documentation for its existing migration path: %s', async declaration =>
    {
        const source = `class Base {}\nclass Other {}\n/** @extends {Base} */\n${declaration}`;
        const { document, diagnostics, provider, range, fixes } = await quickFixFixture(source);
        const actions = await provider.provideCodeActions(document, range, { diagnostics: diagnostics }, {});
        expect(actions.some(action => action.title === 'Remove redundant inheritance documentation')).toBe(false);
        const batch = await fixes.plan([document], { automatic: true });
        expect(batch.plan.entries).toEqual([]);
        expect(document.getText()).toBe(source);
    });

    test('preserves fenced examples, descriptions, unrelated tags and constructor documentation', async () =>
    {
        const comment = [ '/**',
            ' * @description Keep this @extends mention.',
            ' * ```lgd',
            ' * @extends {ExampleOnly}',
            ' * ```',
            ' * @extends {Base}',
            ' * @deprecated Use NewChild.',
            ' */' ].join('\r\n');
        const source = `class Base {}\r\n${comment}\r\nclass Child : Base { /** @description Keep constructor docs. */ Child() {} }`;
        const { document, diagnostics, provider, range } = await quickFixFixture(source);
        const actions = await provider.provideCodeActions(document, range, { diagnostics: diagnostics }, {});
        const action = actions.find(candidate => candidate.title === 'Remove redundant inheritance documentation');
        expect(await provider.applyFix(action.command.arguments[0])).toBe(true);
        expect(document.getText()).toBe(source.replace(' * @extends {Base}\r\n', ''));
    });

    test('requires save opt-in twice and respects the native documentation-rule opt-out', async () =>
    {
        const source = 'class Base {}\n/** @extends Base */\nclass Child : Base { Child() {} }';
        const { document, diagnostics, provider, range, fixes, config } = await quickFixFixture(source);
        config.rules['inheritance-documentation'] = { fix: 'off' };
        expect(await provider.provideCodeActions(document, range, { diagnostics: diagnostics }, {})).toEqual([]);
        expect((await fixes.plan([document], { automatic: false })).plan.entries).toEqual([]);
        config.rules['inheritance-documentation'] = { fix: 'manual' };
        expect((await fixes.plan([document], { automatic: true })).plan.entries).toEqual([]);
        config.autoFix = true;
        expect((await fixes.plan([document], { automatic: true })).plan.entries).toEqual([]);
        config.rules['inheritance-documentation'] = { fix: 'automatic' };
        const batch = await fixes.plan([document], { automatic: true });
        expect(batch.plan.entries.map(entry => entry.handler.ruleId)).toEqual(['inheritance-documentation']);
        expect(await fixes.applyBatch(batch, true)).toBe(true);
        expect(document.getText()).toBe(source.replace('/** @extends Base */\n', ''));
        expect((await fixes.plan([document], { automatic: true })).plan.entries).toEqual([]);
    });

    test('rejects an offered documentation fix after source or policy changes', async () =>
    {
        const source = 'class Base {}\n/** @extends {Base} */\nclass Child : Base { Child() {} }';
        const { document, diagnostics, provider, range, fixes } = await quickFixFixture(source);
        const actions = await provider.provideCodeActions(document, range, { diagnostics: diagnostics }, {});
        const action = actions.find(candidate => candidate.title === 'Remove redundant inheritance documentation');
        fixes.configuration.isCurrent.mockResolvedValue(false);
        expect(await provider.applyFix(action.command.arguments[0])).toBe(false);
        expect(document.getText()).toBe(source);
    });
});

test('a constructor factory migration requires both native rules and retains ordinary parameter/object handlers', async () =>
{
    const source = 'class Child { constructor() { return Object.create(Child); } }';
    const { document, diagnostics, provider, range, fixes, config } = await quickFixFixture(
        source,
        { rules: { 'class-constructor-name': { fix: 'manual' }, 'object-inheritance': { fix: 'off' } } }
    );
    expect(await provider.provideCodeActions(document, range, { diagnostics: diagnostics }, {})).toEqual([]);
    expect((await fixes.plan([document], { automatic: false })).plan.entries).toEqual([]);
    config.rules['object-inheritance'].fix = 'manual';
    const batch = await fixes.plan([document], { automatic: false });
    expect(batch.plan.entries).toHaveLength(1);
    expect(batch.plan.entries[0].proposal.ruleIds).toEqual([ 'class-constructor-name', 'object-inheritance' ]);
    expect(fixes.ruleHandlers.get('object-inheritance').individualOnly).toBeUndefined();
    expect(fixes.ruleHandlers.get('parameter-type').individualOnly).toBeUndefined();
    expect(await fixes.applyBatch(batch, false)).toBe(true);
    expect(document.getText()).toContain('Child()');
    expect(document.getText()).not.toContain('Object.create');
});

test('individual expression cleanup shares local whitespace composition without formatting unrelated code', async () =>
{
    const source = 'function choose(value)\r\n{\r\n    return value ? true : false;\r\n}\r\nfunction untouched(){return 1;}';
    const options = { formatting: { enabled: true, options: { expressions: { booleanSimplification: 'prefer' } } } };
    const { document, fixes, provider, range } = await quickFixFixture(source, options);
    const analysis = await fixes.analysisRequest(document, fixes.languageService.getState(document.uri));
    const diagnostics = createLgdDiagnostics(document, analysis.formattingErrors.filter(error => error.ruleId === 'lgd.format.expressions.booleanSimplification'));
    const [action] = await provider.provideCodeActions(document, range, { diagnostics: diagnostics }, {});
    expect(await provider.applyFix(action.command.arguments[0])).toBe(true);
    expect(document.getText()).toBe(source.replace('value ? true : false', '!!(value)'));
    const sourceEdits = vscode.workspace.applyEdit.mock.calls.filter(([edit]) => edit.replacements.some(replacement => replacement.uri.toString() === document.uri.toString()));
    expect(sourceEdits).toHaveLength(1);
});

/** @description Captures the governed bytes for each confirmed overlapping-transform policy regression. */
const attributionCases = [
    [ 'lineBreaks.emptyLinesAtBlockStart', 'function run()\n{\n\n    return 1;\n}', {}, '{\n\n    return' ],
    [ 'lineBreaks.emptyLinesAtBlockEnd', 'function run()\n{\n    return 1;\n\n}', {}, 'return 1;\n\n}' ],
    [ 'lineBreaks.shortFunctions', 'function run()\n{\n    return 1;\n}', { lineBreaks: { shortFunctions: 'all' } }, 'run()\n{\n' ],
    [ 'lineBreaks.shortIfs', 'if (true)\n{\n    work();\n}', { lineBreaks: { shortIfs: 'all' } }, ')\n{\n' ],
    [ 'lineBreaks.shortLoops', 'while (true)\n{\n    work();\n}', { lineBreaks: { shortLoops: true } }, ')\n{\n' ],
    [ 'lineBreaks.preserveSingleLineBlocks', 'function run()\n{ return 1; }', { lineBreaks: { preserveSingleLineBlocks: true } }, 'run()\n{' ],
    [ 'wrapping.columnLimit', 'function run()\n{\n    return 1;\n}', { lineBreaks: { shortFunctions: 'all' } }, 'run()\n{\n' ],
    [ 'indentation.size', 'function run()\n{\n    switch(value)\n    {\n    case 1:\n      work();\n      break;\n    }\n}', {}, '\n    case 1:\n      work();' ],
    [ 'whitespace.trimTrailingWhitespace', 'function run()\n{\n    work();   \n    other();\n}', {}, 'work();   \n    other();' ]
];

for(const mode of [ 'fix off', 'severity off', 'save manual override' ])
{
    test.each(attributionCases)(`respects ${mode} for %s while applying independent enabled fixes`, async (option, affected, options, preserved) =>
    {
        const ruleId = `lgd.format.${option}`;
        const rules = Object.fromEntries(LgdFormattingOptions.catalog.map(rule => [ rule.id, { fix: 'automatic' } ]));
        rules[ruleId] = mode === 'severity off' ? { severity: 'off' } : { fix: mode === 'fix off' ? 'off' : 'manual' };
        const source = `${affected}\nNumber independent=1;`;
        const { fixes, document } = await fixture(source, { autoFix: true, formatting: { enabled: true, options: options }, rules: rules });
        const batch = await fixes.plan([document], { scope: 'document', automatic: mode === 'save manual override' });
        expect(batch.plan.edits.every(edit => !edit.ruleIds?.includes(ruleId))).toBe(true);
        expect(await fixes.applyBatch(batch, false)).toBe(true);
        expect(document.getText()).toContain(preserved);
        expect(document.getText()).toContain('Number independent = 1;');
    });
}

test('explicitly preserving trailing whitespace cannot be overridden by block layout', async () =>
{
    const source = 'function run()\n{\n    work();   \n    other();\n}';
    const { fixes, document } = await fixture(source, { formatting: { enabled: true, options: { whitespace: { trimTrailingWhitespace: false } } } });
    const batch = await fixes.plan([document], { automatic: false });
    if(batch.plan.entries.length > 0)
    {
        await fixes.applyBatch(batch, false);
    }

    expect(document.getText()).toContain('work();   \n    other();');
});
