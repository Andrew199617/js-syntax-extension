const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const LgdReturnDocChecker = require('../../Compilers/LgdReturnDocChecker');
const LgdDocComment = require('../../Compilers/LgdDocComment');

/** @description Removes redundant return types while preserving descriptions and other documentation. */
class RemoveReturnDocTypeFix extends DiagnosticQuickFix
{
    constructor() { super('removeReturnDocType', true); }

    /** @description Revalidates the documented member and its current redundant types before proposing an edit. */
    createProposal(context, fix)
    {
        const { source, state, snapshots } = context;
        const fields = [ 'declarationStart', 'memberStart', 'commentStart', 'commentEnd' ];
        const migration = LgdReturnDocChecker.migrations(source.text, state.declarations)
            .find(candidate => fields.every(field => candidate[field] === fix[field]));
        if(!migration || fix.kind !== this.kind)
        {
            return null;
        }

        const tags = migration.tags.map(tag => ({ offset: tag.hasDescription ? tag.typeStart : tag.offset, endOffset: tag.endOffset }));
        const edit = LgdDocComment.edit(source.text, migration, tags);
        return { title: 'Remove redundant return-type documentation', target: source, snapshots: snapshots, ...edit };
    }
}

module.exports = RemoveReturnDocTypeFix;
