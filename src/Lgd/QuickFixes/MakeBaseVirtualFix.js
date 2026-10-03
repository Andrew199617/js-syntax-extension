const DiagnosticQuickFix = require('./DiagnosticQuickFix');

/** @description Changes a known base only for a child that explicitly requests override. */
class MakeBaseVirtualFix extends DiagnosticQuickFix
{
    constructor() { super('makeBaseVirtual'); }

    /** @description Resolves the lexical base with original-source provenance across imports. */
    async createProposal(context, fix)
    {
        const { document, state, snapshots } = context;
        const declaration = state.declarations.find(candidate => candidate.headStart === fix.declarationStart);
        const member = declaration?.classMembers?.find(candidate => candidate.name === fix.methodName);
        if(!member?.override)
        {
            return null;
        }

        const sourceContext = { document: document, parsed: { allDeclarations: state.declarations }, externals: state.externals };
        const search = { name: fix.methodName, visited: new Set(), snapshots: snapshots };
        const origin = await context.findBaseMethod(sourceContext, declaration, search);
        if(!origin)
        {
            return null;
        }

        return { title: `Make ${origin.declaration.name}.${fix.methodName} virtual`,
            target: origin.snapshot, snapshots: snapshots,
            offset: origin.member.start, endOffset: origin.member.start, newText: 'virtual ' };
    }
}

module.exports = MakeBaseVirtualFix;
