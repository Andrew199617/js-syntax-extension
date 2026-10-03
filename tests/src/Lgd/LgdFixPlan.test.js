const LgdFixPlan = require('../../../src/Lgd/Fixes/LgdFixPlan');
const DiagnosticQuickFix = require('../../../src/Lgd/QuickFixes/DiagnosticQuickFix');
const { makeTextDocument } = require('./fakeVscode');


/** @description Creates a guarded source edit without relying on compiler details. */
function entry(document, offset, endOffset, newText)
{
    const source = DiagnosticQuickFix.snapshot(document);
    return { proposal: { target: source, snapshots: [source], offset: offset, endOffset: endOffset, newText: newText } };
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

test('deduplicates actions, preserves adjacent replacements and drops overlapping atomic actions', () =>
{
    const document = makeTextDocument('file:///project/example.lgd', 'abcdef');
    document.version = 1;
    const first = entry(document, 0, 1, 'A');
    const conflict = entry(document, 1, 'abc'.length, 'BC');
    conflict.proposal.additionalEdits = [{ ...entry(document, 'abcd'.length, 'abcde'.length, 'E').proposal, snapshots: undefined }];
    conflict.proposal.snapshots.push(conflict.proposal.additionalEdits[0].target);
    const plan = LgdFixPlan.create([ first, first, entry(document, 1, 2, 'B'), conflict ]);
    expect(plan.entries).toHaveLength(2);
    expect(plan.skipped).toBe(1);
    expect(LgdFixPlan.previews(plan)[0]).toMatchObject({ before: 'abcdef', after: 'ABcdef' });
    expect(plan.edits).toHaveLength(2);
    document.version++;
    expect(LgdFixPlan.isCurrent(plan)).toBe(false);
});

test('guards insertions at the same position instead of choosing an arbitrary ordering', () =>
{
    const document = makeTextDocument('file:///project/example.lgd', 'abcdef');
    const plan = LgdFixPlan.create([ entry(document, 1, 1, 'x'), entry(document, 1, 1, 'y') ]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.skipped).toBe(1);
});

test('rejects an entire cross-file edit when any imported source changed', () =>
{
    const document = makeTextDocument('file:///project/example.lgd', 'abcdef');
    const dependency = makeTextDocument('file:///project/base.lgd', 'base');
    const candidate = entry(document, 0, 1, 'A');
    candidate.proposal.snapshots.push(DiagnosticQuickFix.snapshot(dependency));
    dependency.setText('changed');
    expect(LgdFixPlan.create([candidate]).entries).toEqual([]);
});
