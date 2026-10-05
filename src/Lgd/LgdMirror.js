const vscode = require('vscode');

/** @description Maintains generated JavaScript mirrors without taking ownership of saved or edited previews. */
const LgdMirror = {
    /**
     * @description Updates a reusable mirror or creates a fresh JavaScript document when its preview was retired.
     * @param {Object} service the owning language service.
     * @param {Object} state the LGD document state.
     * @param {string} code the compiled JavaScript.
     * @returns {Promise<void>}
     */
    async sync(service, state, code)
    {
        const mirror = state.jsDocument;
        if(this.canUpdate(mirror, state.generatedMirrorText))
        {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(mirror.positionAt(0), mirror.positionAt(mirror.getText().length));
            edit.replace(mirror.uri, fullRange, code);
            const newline = mirror.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
            const expectedText = code.replace(/\r?\n/g, newline);
            const applied = await vscode.workspace.applyEdit(edit);
            if(applied && this.canUpdate(mirror, expectedText))
            {
                this.attach(service, state, mirror, mirror.getText());
                return;
            }

            if(!applied && this.canUpdate(mirror, state.generatedMirrorText))
            {
                throw new Error('LGD: Could not update the JavaScript mirror.');
            }
        }

        const created = await vscode.workspace.openTextDocument({ language: 'javascript', content: code });
        this.attach(service, state, created, created.getText());
    },

    /**
     * @description Reuses only an open JavaScript Untitled mirror that still contains its generated text.
     * @param {Object|null} document the mirror document.
     * @param {string|undefined} generatedText the last generated content.
     * @returns {boolean} whether replacement preserves user-owned content.
     */
    canUpdate(document, generatedText)
    {
        if(!document || document.isClosed || document.uri.scheme !== 'untitled')
        {
            return false;
        }

        return document.languageId === 'javascript' && document.getText() === generatedText;
    },

    /**
     * @description Attaches a mirror only to its original source state, never to a source closed and reopened while awaiting an edit.
     * @param {Object} service the owning language service.
     * @param {Object} state the original LGD document state.
     * @param {Object} document the mirror document.
     * @param {string} generatedText its generated content.
     * @returns {void}
     */
    attach(service, state, document, generatedText)
    {
        if(service.getState(state.document.uri) === state)
        {
            state.jsDocument = document;
            state.generatedMirrorText = generatedText;
        }
    }
};

module.exports = LgdMirror;
