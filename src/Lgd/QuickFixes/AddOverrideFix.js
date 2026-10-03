const DiagnosticQuickFix = require('./DiagnosticQuickFix');

/** @description Repairs an explicitly diagnosed missing override modifier. */
class AddOverrideFix extends DiagnosticQuickFix
{
    constructor() { super('addOverride', true); }

    /** @description Inserts override or replaces only the existing virtual token. */
    createProposal(context, fix)
    {
        const { source, snapshots } = context;
        const replaceVirtual = source.text.slice(fix.offset, fix.endOffset) === 'virtual';
        if(fix.offset !== fix.endOffset && !replaceVirtual)
        {
            return null;
        }

        let title = 'Add override keyword';
        let newText = 'override ';
        if(replaceVirtual)
        {
            title = 'Replace virtual with override';
            newText = 'override';
        }

        return { title: title, target: source, snapshots: snapshots,
            offset: fix.offset, endOffset: fix.endOffset, newText: newText };
    }
}

module.exports = AddOverrideFix;
