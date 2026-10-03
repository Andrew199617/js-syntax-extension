const LgdDocComment = require('../../Compilers/LgdDocComment');
const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const LgdVirtualDocChecker = require('../../Compilers/LgdVirtualDocChecker');

/** @description Migrates legacy virtual documentation with a single guarded, source-preserving edit. */
class MoveVirtualModifierFix extends DiagnosticQuickFix
{
    constructor() { super('moveVirtualModifier', true); }

    /** @description Revalidates the attached tag and supported method before changing documentation or syntax. */
    createProposal(context, fix)
    {
        const { source, state, snapshots } = context;
        const fields = [ 'declarationStart', 'memberStart', 'commentStart', 'commentEnd' ];
        const migration = LgdVirtualDocChecker.migrations(source.text, state.declarations)
            .find(candidate => fields.every(field => candidate[field] === fix[field]));
        if(!migration || fix.kind !== this.kind)
        {
            return null;
        }

        const edit = LgdDocComment.edit(source.text, migration, migration.tags);
        if(!migration.virtual)
        {
            edit.newText += 'virtual ';
        }

        return { title: migration.virtual ? 'Remove redundant @virtual JSDoc tag' : 'Move @virtual to the method declaration',
            target: source, snapshots: snapshots, ...edit };
    }
}

module.exports = MoveVirtualModifierFix;
