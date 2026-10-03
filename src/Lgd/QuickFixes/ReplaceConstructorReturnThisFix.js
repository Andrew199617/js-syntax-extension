const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const LgdCompiler = require('../../Compilers/LgdCompiler');

/** @description Retains a constructor's early exit without discarding an evaluated expression or a comment. */
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

        return { title: 'Replace return this with an early exit', target: source, snapshots: snapshots,
            offset: fix.offset, endOffset: fix.endOffset, newText: 'return;' };
    }
}

module.exports = ReplaceConstructorReturnThisFix;
