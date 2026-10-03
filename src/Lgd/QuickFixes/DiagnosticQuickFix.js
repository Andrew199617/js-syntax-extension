/** @description Shared base for diagnostic-specific LGD edit strategies and exact source guards. */
class DiagnosticQuickFix
{
    /** @description Creates a strategy with an explicit fix kind and preference. */
    constructor(kind, isPreferred = false)
    {
        this.kind = kind;
        this.isPreferred = isPreferred;
    }

    /** @description Builds and validates a minimal original-source edit from a strategy. */
    async create(context, fix)
    {
        const proposal = await this.createProposal(context, fix);
        if(!proposal || !DiagnosticQuickFix.canApply(proposal))
        {
            return null;
        }

        for(const edit of DiagnosticQuickFix.edits(proposal))
        {
            edit.expectedText = edit.target.text.slice(edit.offset, edit.endOffset);
        }

        proposal.isPreferred = this.isPreferred;
        return proposal;
    }

    /** @description Implemented by the diagnostic-specific strategy. */
    createProposal()
    {
        throw new Error('Quick-fix strategy must implement createProposal.');
    }

    /** @description Runs shared edit guards and any synchronous contract-specific currentness check. */
    static canApply(proposal)
    {
        if(!DiagnosticQuickFix.isCurrent(proposal) || !DiagnosticQuickFix.isValidEdits(proposal))
        {
            return false;
        }

        if(proposal.validate !== undefined)
        {
            return typeof proposal.validate === 'function' && proposal.validate() === true;
        }

        return true;
    }

    /** @description Lists the primary edit and any explicitly declared companion edits in one atomic action. */
    static edits(proposal)
    {
        return [ proposal, ...proposal.additionalEdits || [] ];
    }

    /** @description Requires independently guarded, nonoverlapping ranges for every document in an atomic action. */
    static isValidEdits(proposal)
    {
        if(proposal.additionalEdits !== undefined && !Array.isArray(proposal.additionalEdits))
        {
            return false;
        }

        const edits = DiagnosticQuickFix.edits(proposal);
        for(const [ index, edit ] of edits.entries())
        {
            if(!edit || edit !== proposal && edit.additionalEdits !== undefined || !DiagnosticQuickFix.isValidEdit({ ...edit, snapshots: proposal.snapshots }))
            {
                return false;
            }

            for(const previous of edits.slice(0, index))
            {
                const sameDocument = previous.target.document.uri.toString() === edit.target.document.uri.toString();
                const intersects = previous.offset <= edit.endOffset && edit.offset <= previous.endOffset;
                if(sameDocument && intersects)
                {
                    return false;
                }
            }
        }

        return true;
    }

    /** @description Captures source and version together for apply-time freshness checks. */
    static snapshot(document)
    {
        return { document: document, version: document.version, text: document.getText() };
    }

    /** @description Checks every source and dependency involved in the proposal. */
    static isCurrent(proposal)
    {
        if(!Array.isArray(proposal.snapshots) || proposal.snapshots.length === 0)
        {
            return false;
        }

        return proposal.snapshots.every(snapshot =>
        {
            const document = snapshot.document;
            return !document.isClosed && document.version === snapshot.version && document.getText() === snapshot.text;
        });
    }

    /** @description Rejects malformed ranges or edits without exact source provenance. */
    static isValidEdit(proposal)
    {
        const { target, snapshots, offset, endOffset, newText } = proposal;
        if(!target || !snapshots.includes(target) || typeof target.text !== 'string' || typeof newText !== 'string')
        {
            return false;
        }

        const integerOffsets = Number.isInteger(offset) && Number.isInteger(endOffset);
        const validRange = integerOffsets && offset >= 0 && endOffset >= offset && endOffset <= target.text.length;

        return validRange && (proposal.expectedText === undefined || target.text.slice(offset, endOffset) === proposal.expectedText);
    }
}

module.exports = DiagnosticQuickFix;
