const vscode = require('vscode');
const DiagnosticQuickFix = require('../QuickFixes/DiagnosticQuickFix');

/** @description One guarded edit plan shared by individual fixes, Fix All and save actions. */
const LgdFixPlan = {
    /** @description Deduplicates identical actions and skips conflicting actions as indivisible units. */
    create(entries)
    {
        const plan = { entries: [], edits: [], skipped: 0 };
        const identities = new Set();
        for(const entry of entries)
        {
            const edits = DiagnosticQuickFix.edits(entry.proposal);
            const identity = JSON.stringify(edits.map(edit => [ edit.target.document.uri.toString(), edit.offset, edit.endOffset, edit.newText ]));
            if(identities.has(identity))
            {
                continue;
            }

            if(!DiagnosticQuickFix.canApply(entry.proposal) || edits.some(edit => plan.edits.some(previous => this.conflicts(previous, edit))))
            {
                plan.skipped++;
                continue;
            }

            identities.add(identity);
            plan.entries.push(entry);
            plan.edits.push(...edits);
        }

        return plan;
    },

    /** @description Treats touching insertions conservatively while allowing adjacent replacements. */
    conflicts(left, right)
    {
        if(left.target.document.uri.toString() !== right.target.document.uri.toString())
        {
            return false;
        }

        if(left.offset === left.endOffset || right.offset === right.endOffset)
        {
            return left.offset <= right.endOffset && right.offset <= left.endOffset;
        }

        return left.offset < right.endOffset && right.offset < left.endOffset;
    },

    /** @description Checks every source and dependency immediately before applying the atomic plan. */
    isCurrent(plan) { return plan.entries.every(entry => DiagnosticQuickFix.canApply(entry.proposal)); },

    /** @description Converts the exact guarded ranges into a single undoable workspace edit. */
    workspaceEdit(plan)
    {
        const workspaceEdit = new vscode.WorkspaceEdit();
        for(const edit of plan.edits)
        {
            const document = edit.target.document;
            const range = new vscode.Range(document.positionAt(edit.offset), document.positionAt(edit.endOffset));
            workspaceEdit.replace(document.uri, range, edit.newText);
        }

        return workspaceEdit;
    },

    /** @description Produces immutable before/after text for the native diff viewer. */
    previews(plan)
    {
        const previews = new Map();
        for(const edit of plan.edits)
        {
            const key = edit.target.document.uri.toString();
            if(!previews.has(key))
            {
                previews.set(key, { document: edit.target.document, before: edit.target.text, edits: [] });
            }

            previews.get(key).edits.push(edit);
        }

        for(const preview of previews.values())
        {
            preview.after = preview.before;
            for(const edit of preview.edits.sort((left, right) => right.offset - left.offset))
            {
                preview.after = preview.after.slice(0, edit.offset) + edit.newText + preview.after.slice(edit.endOffset);
            }
        }

        return Array.from(previews.values());
    },

    /** @description Applies without saving documents, then refreshes affected language-service states. */
    async apply(plan, languageService)
    {
        if(!this.isCurrent(plan) || plan.edits.length === 0)
        {
            return false;
        }

        const applied = await vscode.workspace.applyEdit(this.workspaceEdit(plan));
        if(applied)
        {
            const documents = new Set(plan.edits.map(edit => edit.target.document).reverse());
            for(const document of documents)
            {
                if(languageService.getState(document.uri))
                {
                    await languageService.updateDocument(document);
                }
            }

            await languageService.pendingDependencyUpdates;
        }

        return applied;
    }
};

module.exports = LgdFixPlan;
