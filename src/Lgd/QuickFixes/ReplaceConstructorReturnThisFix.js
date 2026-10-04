const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const LgdCompiler = require('../../Compilers/LgdCompiler');

/** @description Removes a redundant terminal this return or retains the constructor's early exit. */
class ReplaceConstructorReturnThisFix extends DiagnosticQuickFix
{
    constructor() { super('replaceConstructorReturnThis', true); }

    /** @description Revalidates the exact constructor return before replacing only a proven this expression. */
    createProposal(context, fix)
    {
        const { source, state, snapshots } = context;
        if(fix.kind !== this.kind)
        {
            return null;
        }

        const checked = LgdCompiler.create().parse(source.text, state.externals);
        const fields = [ 'kind', 'declarationStart', 'memberStart', 'offset', 'endOffset' ];
        const diagnostic = checked.errors.find(error =>
        {
            const matchingError = error.code === 'lgd.constructor.returnValue' && error.quickFix;
            return matchingError && fields.every(field => error.quickFix[field] === fix[field]);
        });

        if(!diagnostic)
        {
            return null;
        }

        const removeStatement = diagnostic.quickFix.removeStatement;
        const title = removeStatement ? 'Remove redundant return this' : 'Replace return this with an early exit';
        return { title: title, target: source, snapshots: snapshots,
            offset: fix.offset, endOffset: fix.endOffset, newText: removeStatement ? '' : 'return;' };
    }
}

module.exports = ReplaceConstructorReturnThisFix;
