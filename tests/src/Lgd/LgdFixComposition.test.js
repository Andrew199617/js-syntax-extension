const LgdFixComposition = require('../../../src/Lgd/Fixes/LgdFixComposition');
const LgdFixPlan = require('../../../src/Lgd/Fixes/LgdFixPlan');
const LgdFormattingPolicy = require('../../../src/Lgd/Fixes/LgdFormattingPolicy');
const DiagnosticQuickFix = require('../../../src/Lgd/QuickFixes/DiagnosticQuickFix');

/** @description Makes one guarded semantic removal in an otherwise immutable plain source buffer. */
function fixture(source, removed = 'const removed = 1;')
{
    const document = { uri: { toString: () => 'host:example' }, version: 1, getText: () => source };
    const target = DiagnosticQuickFix.snapshot(document);
    const offset = source.indexOf(removed);
    const proposal = { title: 'Remove the selected local', target: target, snapshots: [target], offset: offset,
        endOffset: offset + removed.length, newText: '', validate: () => true };
    const configuration = { valid: true, ignored: false, rules: {}, formatting: { enabled: true, options: {} } };
    return { document: document, proposal: proposal, configuration: configuration };
}

/** @description Uses the same family/leaf policies as a host while selecting manual or automatic cleanup. */
function compose(opened, automatic = false)
{
    function eligible(error, configuration)
    {
        return (error.relatedRuleIds || [error.ruleId]).every(ruleId =>
        {
            const setting = LgdFormattingPolicy.setting(ruleId, configuration.rules);
            const mode = setting.fix || 'manual';
            return setting.severity !== 'off' && mode !== 'off' && (!automatic || mode === 'automatic');
        });
    }

    return LgdFixComposition.compose(opened.proposal, new Map([[ 'host:example', opened.configuration ]]), eligible);
}

/** @description Previews the exact atomic original-source edits. */
function preview(proposal)
{
    return LgdFixPlan.previews(LgdFixPlan.create([{ proposal: proposal }]))[0].after;
}

jest.mock('vscode', () =>
{
    throw new Error('Editor-neutral composition must not import vscode.');
});

test.each([ '\n', '\r\n', '\r' ])('cleans only the whitespace left by a removal with %j line endings', newline =>
{
    const unrelated = 'function untouched(){return 3;}';
    const source = [ 'function run()', '{', '    const removed = 1;', '', '    return 2;', '}', unrelated ].join(newline);
    const opened = fixture(source);
    const proposal = compose(opened);
    expect(preview(proposal)).toBe([ 'function run()', '{', '    return 2;', '}', unrelated ].join(newline));
    expect(DiagnosticQuickFix.canApply(proposal)).toBe(true);
    expect(proposal.validate).toBe(opened.proposal.validate);
    expect(proposal.ruleIds).toContain('lgd.format.lineBreaks.emptyLinesAtBlockStart');
    const repeated = LgdFixComposition.compose(proposal, new Map([[ 'host:example', opened.configuration ]]), () => true);
    expect(preview(repeated)).toBe(preview(proposal));
    opened.document.version++;
    expect(DiagnosticQuickFix.canApply(proposal)).toBe(false);
});

test.each([ 'disabled', 'invalid', 'ignored', 'leaf off', 'family off', 'leaf severity off', 'automatic with manual policy' ])('preserves the requested semantic edit without applying %s cleanup', condition =>
{
    const source = 'function run()\n{\n    const removed = 1;\n\n    return 2;\n}';
    const opened = fixture(source);
    if(condition === 'disabled') opened.configuration.formatting.enabled = false;
    if(condition === 'invalid') opened.configuration.valid = false;
    if(condition === 'ignored') opened.configuration.ignored = true;
    if(condition === 'leaf off') opened.configuration.rules['lgd.format.lineBreaks.emptyLinesAtBlockStart'] = { fix: 'off' };
    if(condition === 'family off') opened.configuration.rules['lgd.format.lineBreaks'] = { fix: 'off' };
    if(condition === 'leaf severity off') opened.configuration.rules['lgd.format.lineBreaks.emptyLinesAtBlockStart'] = { severity: 'off' };
    const proposal = compose(opened, condition === 'automatic with manual policy');
    expect(proposal).toBe(opened.proposal);
    expect(preview(proposal)).toBe(source.replace('const removed = 1;', ''));
});

test('respects formatting-off boundaries without altering the requested semantic removal', () =>
{
    const source = '// lgd-format off\nfunction run()\n{\n    const removed = 1;\n\n    return 2;\n}\n// lgd-format on';
    const opened = fixture(source);
    expect(compose(opened)).toBe(opened.proposal);
    expect(preview(compose(opened))).toBe(source.replace('const removed = 1;', ''));
});

test('does not introduce unrelated opt-in expression, declaration, cleanup or header edits', () =>
{
    const source = 'function run()\n{\n    const removed = 1;\n    const other = 2;\n    return value ? true : false;\n}';
    const opened = fixture(source);
    opened.configuration.formatting.options = { expressions: { booleanSimplification: 'prefer' }, declarations: { localTypes: 'explicit' },
        cleanup: { unusedLocals: 'remove' }, whitespace: { fileHeader: 'A new license' } };
    const result = preview(compose(opened));
    expect(result).toContain('const other = 2;');
    expect(result).toContain('return value ? true : false;');
    expect(result).not.toContain('A new license');
    expect(result).not.toContain('const Number');
});

test('normalizes whitespace in an inserted expression and preserves literal and comment bytes', () =>
{
    const protectedText = 'const text = `a  \r\n b`; // Keep   this';
    const source = `function run()\r\n{\r\n    return value ? true : false;\r\n}\r\n${protectedText}`;
    const opened = fixture(source, 'value ? true : false');
    opened.proposal.newText = '!!(  value  )';
    opened.configuration.formatting.options.spacing = { insideOtherParens: false };
    const result = preview(compose(opened));
    expect(result).toContain('return !!(value);');
    expect(result).toContain(protectedText);
});

test('joins its own touching edit windows and keeps distant targets guarded and atomic', () =>
{
    const source = 'function run() { const removed = 1; const second = 2; return 3; }';
    const opened = fixture(source);
    const offset = source.indexOf('const second');
    opened.proposal.additionalEdits = [{ target: opened.proposal.target, offset: offset,
        endOffset: offset + 'const second = 2;'.length, newText: '' }];
    const proposal = compose(opened);
    expect(DiagnosticQuickFix.canApply(proposal)).toBe(true);
    expect(preview(proposal)).not.toContain('const removed');
    expect(preview(proposal)).not.toContain('const second');
    expect(preview(proposal)).toContain('return 3;');
    expect(LgdFixPlan.create([{ proposal: proposal }]).entries).toHaveLength(1);
});
