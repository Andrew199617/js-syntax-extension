const DiagnosticQuickFix = require('../../../src/Lgd/QuickFixes/DiagnosticQuickFix');
const { makeTextDocument } = require('./fakeVscode');

/** @description Creates a guarded edit without relying on the language-service fixture. */
function proposal()
{
    const document = makeTextDocument('file:///workspace/Child.lgd', 'class Child {}');
    document.version = 1;
    const snapshot = DiagnosticQuickFix.snapshot(document);
    return { target: snapshot, snapshots: [snapshot], offset: 0, endOffset: 'class'.length, newText: 'abstract class' };
}

describe('atomic diagnostic edit guards', () =>
{
    test.each([ 'out of bounds', 'overlapping', 'untracked', 'non-array' ])('rejects an invalid companion edit: %s', invalid =>
    {
        const primary = proposal();
        const companion = { target: primary.target, offset: primary.offset, endOffset: primary.endOffset, newText: '' };
        if(invalid === 'out of bounds')
        {
            companion.offset = -1;
        }
        else if(invalid === 'untracked')
        {
            companion.target = { ...primary.target };
        }

        primary.additionalEdits = invalid === 'non-array' ? {} : [companion];
        expect(DiagnosticQuickFix.canApply(primary)).toBe(false);
    });

    test('requires both documents and each expected source range to remain unchanged', () =>
    {
        const primary = proposal();
        const document = makeTextDocument('file:///workspace/Base.lgd', 'class Base {}');
        document.version = 1;
        const snapshot = DiagnosticQuickFix.snapshot(document);
        primary.snapshots.push(snapshot);
        const companion = { target: snapshot, offset: 0, endOffset: 'class'.length, newText: 'abstract class', expectedText: 'class' };
        primary.additionalEdits = [companion];
        expect(DiagnosticQuickFix.canApply(primary)).toBe(true);
        companion.expectedText = 'wrong';
        expect(DiagnosticQuickFix.canApply(primary)).toBe(false);
        companion.expectedText = 'class';
        primary.target.document.version++;
        expect(DiagnosticQuickFix.canApply(primary)).toBe(false);
    });
});
