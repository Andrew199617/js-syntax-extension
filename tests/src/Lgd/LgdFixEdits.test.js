const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdFixService = require('../../../src/Editors/VSCode/LgdFixService');
const LgdFormattingRules = require('../../../src/Lgd/Fixes/LgdFormattingRules');
const LgdFormattingOptions = require('../../../src/Lgd/Formatting/LgdFormattingOptions');

/** @description Reproduces VS Code normalization to the current document EOL before applying an explicit EOL edit. */
function applyNormalized(document, workspaceEdit)
{
    const edits = workspaceEdit.get(document.uri);
    const ending = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const replacements = edits.filter(edit => edit.range).map(edit => ({ start: document.offsetAt(edit.range.start), end: document.offsetAt(edit.range.end), text: edit.newText }));
    let source = document.getText();
    for(const edit of replacements.sort((left, right) => right.start - left.start))
    {
        const text = edit.text.replace(/\r\n|\r|\n/gu, ending);
        source = source.slice(0, edit.start) + text + source.slice(edit.end);
    }

    const metadata = edits.filter(edit => edit.newEol !== undefined);
    for(const edit of metadata)
    {
        document.eol = edit.newEol;
        source = source.replace(/\r\n|\r|\n/gu, edit.newEol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
    }

    document.setText(source);
    document.version++;
    return true;
}

/** @description Uses the real compiler, style policy, proposal registry and guarded batch application. */
async function fixture(source, mode)
{
    const document = makeTextDocument('file:///project/example.lgd', source);
    document.languageId = 'lgd';
    document.version = 1;
    document.eol = source.includes('\r\n') ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF;
    const service = LgdLanguageService.create({ set: jest.fn(), delete: jest.fn() }, error =>
    {
        throw error;
    });

    await service.openDocument(document);
    const fixes = LgdFixService.create(service);
    const rules = Object.fromEntries(LgdFormattingOptions.catalog.map(rule => [ rule.id, { severity: 'off' } ]));
    rules['lgd.format.whitespace'] = { severity: 'warning', fix: 'automatic' };
    const config = { valid: true, ignored: false, root: '/project', autoFix: true, rules: rules,
        formatting: { enabled: true, options: { whitespace: { endOfLine: mode } } } };
    fixes.configuration = { resolve: jest.fn(() => Promise.resolve(config)), isCurrent: jest.fn(() => Promise.resolve(true)), buffersCurrent: jest.fn(() => true) };
    fixes.formattingDiagnostics.configuration = fixes.configuration;
    vscode.workspace.applyEdit.mockImplementation(edit => applyNormalized(document, edit));
    return { document: document, fixes: fixes, config: config };
}

jest.mock('vscode', () =>
{
    const api = require('./fakeVscode').createFakeVscode(jest);

    api.EndOfLine = Object.fromEntries([ [ 'LF', 1 ], [ 'CRLF', 2 ] ]);
    api.TextEdit = { setEndOfLine: newEol => ({ newEol: newEol }) };
    api.WorkspaceEdit = function WorkspaceEdit()
    {
        const edits = new Map();
        return {
            /** @description Records regular edits separately from EOL metadata. */
            replace: (uri, range, newText) =>
            {
                const key = uri.toString();
                edits.set(key, [ ...edits.get(key) || [], { range: range, newText: newText } ]);
            },
            get: uri => edits.get(uri.toString()) || [],
            set: (uri, replacements) => edits.set(uri.toString(), replacements)
        };
    };

    api.languages.createDiagnosticCollection = jest.fn(() => ({ set: jest.fn(), clear: jest.fn(), delete: jest.fn(), dispose: jest.fn() }));
    api.window = { showInformationMessage: jest.fn(), showWarningMessage: jest.fn() };
    return api;
});

beforeEach(() =>
{
    vscode.__reset();
    vscode.workspace.isTrusted = true;
    vscode.workspace.applyEdit.mockClear();
});

test.each([
    [ 'crlf', '\n', '\r\n', 2 ],
    [ 'lf', '\r\n', '\n', 1 ]
])('Fix All changes document metadata once for %s and the second run is clean', async (mode, before, after, expected) =>
{
    const source = [ 'function choose(value)', '{', '    return value;', '}' ].join(before);
    const { document, fixes, config } = await fixture(source, mode);
    const errors = LgdFormattingRules.analyze(source, config);
    const lineBreakCount = source.split(before).length - 1;
    expect(errors).toHaveLength(lineBreakCount);
    expect(errors.every(error => error.ruleId === 'lgd.format.whitespace.endOfLine')).toBe(true);
    expect(errors.every(error => error.relatedRuleIds.length === 1)).toBe(true);
    expect(errors.every(error => error.message.startsWith('Line ending style'))).toBe(true);
    const batch = await fixes.plan([document], { automatic: true });
    expect(batch.plan.entries).toHaveLength(lineBreakCount);
    expect(await fixes.applyBatch(batch, true)).toBe(true);
    expect(document.getText()).toBe(source.split(before).join(after));
    expect(document.eol).toBe(expected);
    const edits = vscode.workspace.applyEdit.mock.calls[0][0].get(document.uri);
    expect(edits.filter(edit => edit.newEol !== undefined)).toEqual([{ newEol: expected }]);
    expect(LgdFormattingRules.analyze(document.getText(), config)).toEqual([]);
    expect((await fixes.plan([document], { automatic: true })).plan.entries).toEqual([]);
});

test('per-rule EOL opt-out prevents both textual conversion and document metadata changes', async () =>
{
    const source = 'function choose(value)\n{\n    return value;\n}';
    const { document, fixes, config } = await fixture(source, 'crlf');
    config.rules['lgd.format.whitespace.endOfLine'] = { fix: 'off' };
    expect((await fixes.plan([document], { automatic: true })).plan.entries).toEqual([]);
    expect((await fixes.plan([document], { automatic: false })).plan.entries).toEqual([]);
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    expect(document.getText()).toBe(source);
    expect(document.eol).toBe(vscode.EndOfLine.LF);
});

test('mixed layout and newline changes carry the EOL permission contributor', async () =>
{
    const source = 'function choose(value) {\nreturn value;\n}';
    const { document, fixes, config } = await fixture(source, 'crlf');
    config.rules['lgd.format.indentation'] = { severity: 'warning', fix: 'automatic' };
    config.rules['lgd.format.braces'] = { severity: 'warning', fix: 'automatic' };
    config.rules['lgd.format.lineBreaks'] = { severity: 'warning', fix: 'automatic' };
    const findings = LgdFormattingRules.analyze(source, config);
    const mixed = findings.find(error => error.expectedText === '\n' && error.newText.includes('    '));
    expect(mixed.relatedRuleIds).toContain('lgd.format.whitespace.endOfLine');
    config.rules['lgd.format.whitespace.endOfLine'] = { fix: 'off' };
    const batch = await fixes.plan([document], { automatic: true });
    expect(batch.plan.edits.every(edit => !edit.ruleIds.includes('lgd.format.whitespace.endOfLine'))).toBe(true);
    expect(await fixes.applyBatch(batch, true)).toBe(true);
    expect(document.eol).toBe(vscode.EndOfLine.LF);
    expect(vscode.workspace.applyEdit.mock.calls.every(([edit]) => edit.get(document.uri).every(change => change.newEol === undefined))).toBe(true);
});

test.each([
    'const message = `first\nsecond`;\nconst count = 1;',
    '/* first\nsecond */\nconst count = 1;',
    '// lgd-format off\nconst count=1;\n// lgd-format on\nconst other = 2;'
])('does not globally normalize protected or disabled bytes: %s', async source =>
{
    const { document, fixes } = await fixture(source, 'crlf');
    const batch = await fixes.plan([document], { automatic: true });
    expect(batch.plan.entries.length).toBeGreaterThan(0);
    expect(await fixes.applyBatch(batch, true)).toBe(true);
    const edits = vscode.workspace.applyEdit.mock.calls[0][0].get(document.uri);
    expect(edits.some(edit => edit.newEol !== undefined)).toBe(false);
    expect(document.getText()).toBe(source);
    expect(document.eol).toBe(vscode.EndOfLine.LF);
});

test.each([ 'buffer', 'configuration' ])('a stale %s prevents the EOL directive from reaching VS Code', async changed =>
{
    const { document, fixes } = await fixture('const count = 1;\nconst next = 2;', 'crlf');
    const batch = await fixes.plan([document], { automatic: true });
    if(changed === 'buffer')
    {
        document.setText(`${document.getText()}\n`);
        document.version++;
    }
    else
    {
        fixes.configuration.isCurrent.mockResolvedValue(false);
    }

    expect(await fixes.applyBatch(batch, true)).toBe(false);
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    expect(document.eol).toBe(vscode.EndOfLine.LF);
});
