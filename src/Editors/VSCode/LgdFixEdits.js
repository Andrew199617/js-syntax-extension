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

        for(const preview of LgdFixPlan.previews(plan))
        {
            const endOfLine = this.endOfLine(preview);
            if(endOfLine !== null)
            {
                const uri = preview.document.uri;
                workspaceEdit.set(uri, [ ...workspaceEdit.get(uri), vscode.TextEdit.setEndOfLine(endOfLine) ]);
            }
        }

        return workspaceEdit;
    },

    /** @description Changes document EOL only if normalization exactly matches the authorized complete preview. */
    endOfLine(preview)
    {
        const requested = new Set(preview.edits.filter(edit => edit.ruleIds?.includes('lgd.format.whitespace.endOfLine')).map(edit => edit.endOfLine));
        if(requested.size !== 1)
        {
            return null;
        }

        const [mode] = requested;
        if(!vscode.EndOfLine || ![ 'lf', 'crlf' ].includes(mode) || ![ vscode.EndOfLine.LF, vscode.EndOfLine.CRLF ].includes(preview.document.eol))
        {
            return null;
        }

        const ending = mode === 'crlf' ? '\r\n' : '\n';
        const target = mode === 'crlf' ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF;
        const normalized = preview.after.replace(/\r\n|\r|\n/gu, ending);
        if(preview.document.eol === target || normalized !== preview.after || !preview.after.includes(ending))
        {
            return null;
        }

        return target;
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
