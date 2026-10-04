const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const LgdCompiler = require('../../Compilers/LgdCompiler');

/** @description Removes only a currently proven redundant local reference assertion. */
class RemoveRedundantCastFix extends DiagnosticQuickFix
{
    constructor() { super('removeRedundantCast', true); }

    /** @description Rechecks the exact source contract and preserves token separation and line boundaries. */
    createProposal(context, fix)
    {
        const { source, state, snapshots } = context;
        if(fix.kind !== this.kind)
        {
            return null;
        }

        const checked = LgdCompiler.create().parse(source.text, state.externals);
        const fields = [ 'kind', 'offset', 'endOffset', 'typeName' ];
        const diagnostic = checked.errors.find(error =>
        {
            const matchingError = error.code === 'lgd.cast.redundant' && error.quickFix;
            return matchingError && fields.every(field => error.quickFix[field] === fix[field]);
        });

        if(!diagnostic)
        {
            return null;
        }

        const head = source.text.slice(fix.offset, fix.endOffset);
        return { title: 'Remove unnecessary reference cast', target: source, snapshots: snapshots,
            offset: fix.offset, endOffset: fix.endOffset, newText: head.replace(/[^\n\r]/g, '') || ' ' };
    }
}

module.exports = RemoveRedundantCastFix;
