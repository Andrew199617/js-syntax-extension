const vscode = require('vscode');
const LgdFixPlan = require('../../Lgd/Fixes/LgdFixPlan');

/** @description Converts editor-neutral offset plans to atomic VS Code workspace edits. */
const LgdFixEdits = {
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

    /** @description Applies without saving documents, then refreshes affected language-service states. */
    async apply(plan, languageService)
    {
        if(!LgdFixPlan.isCurrent(plan) || plan.edits.length === 0)
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

module.exports = LgdFixEdits;
