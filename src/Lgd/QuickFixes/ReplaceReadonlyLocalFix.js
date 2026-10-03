const DiagnosticQuickFix = require('./DiagnosticQuickFix');

/** @description Migrates only a verified legacy variable binding modifier. */
class ReplaceReadonlyLocalFix extends DiagnosticQuickFix
{
    constructor() { super('replaceReadonlyLocal', true); }

    /** @description Replaces the readonly token without touching types, initializer values, or members. */
    createProposal(context, fix)
    {
        const { source, snapshots, state } = context;
        const declaration = state.declarations.find(candidate => candidate.headStart === fix.declarationStart);
        const matchesDeclaration = declaration?.bindingKind === 'readonly' && declaration.bindingStart === fix.offset;
        if(!matchesDeclaration || fix.endOffset !== fix.offset + 'readonly'.length || source.text.slice(fix.offset, fix.endOffset) !== 'readonly')
        {
            return null;
        }

        return { title: 'Replace readonly with const', target: source, snapshots: snapshots,
            offset: fix.offset, endOffset: fix.endOffset, newText: 'const' };
    }
}

module.exports = ReplaceReadonlyLocalFix;
