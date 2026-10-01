const vscode = require('vscode');
const LgdCompiler = require('../Compilers/LgdCompiler');
const LgdSourceMap = require('../Compilers/LgdSourceMap');

/** @import { DiagnosticCollection, Position, Range, TextDocument, Uri } from 'vscode' */

/**
 * @description Tracks open LGD documents, keeps a compiled JavaScript mirror for each one,
 * and translates positions between LGD source and the compiled output so editor features
 * can delegate to the TypeScript language service.
 * @type {LgdLanguageServiceType}
 */
const LgdLanguageService = {
    /**
     * @description Creates a language service instance.
     * @param {DiagnosticCollection} diagnosticCollection the collection for LGD compiler diagnostics.
     * @param {Function} onError reports a failed background recompile.
     * @returns {LgdLanguageServiceType}
     */
    create(diagnosticCollection, onError)
    {
        const service = Object.create(LgdLanguageService);
        service.diagnosticCollection = diagnosticCollection;
        service.onError = onError;
        service.compiler = LgdCompiler.create();

        /** @description Open LGD documents by uri string: { document, jsDocument, map, errors }. */
        service.states = new Map();

        /** @description Settled recompile promises by uri string, serializing updates per document. */
        service.pendingUpdates = new Map();

        return service;
    },

    /**
     * @description Opens an LGD document: compiles it and creates its JavaScript mirror.
     * @param {TextDocument} document the LGD document.
     * @returns {Promise<Object|null>} the document state.
     */
    openDocument(document)
    {
        const key = document.uri.toString();
        if(!this.states.has(key))
        {
            this.states.set(key, { document: document, jsDocument: null, map: null, errors: [] });
        }

        return this.updateDocument(document);
    },

    /**
     * @description Recompiles an LGD document after it changed, serialized per document.
     * The returned promise rejects when the recompile fails; the stored chain always settles.
     * @param {TextDocument} document the LGD document.
     * @returns {Promise<Object|null>} the document state.
     */
    updateDocument(document)
    {
        const key = document.uri.toString();
        const pending = this.pendingUpdates.get(key) || Promise.resolve();
        const next = this.applyUpdate(document, key, pending);
        this.pendingUpdates.set(key, this.trackSettled(next));
        return next;
    },

    /**
     * @description Waits for the previous update, then recompiles the document.
     * @param {TextDocument} document the LGD document.
     * @param {string} key the document uri string.
     * @param {Promise<void>} pending the previous update.
     * @returns {Promise<Object|null>} the document state.
     */
    async applyUpdate(document, key, pending)
    {
        await pending;
        const state = this.states.get(key);
        if(!state)
        {
            return null;
        }

        state.document = document;
        return this.recompile(state);
    },

    /**
     * @description Observes an update promise so the serialized chain continues after failures.
     * @param {Promise<Object|null>} promise the update promise.
     * @returns {Promise<void>} always resolves.
     */
    async trackSettled(promise)
    {
        try
        {
            await promise;
        }
        catch(error)
        {
            this.onError(error);
        }
    },

    /**
     * @description Drops an LGD document and clears its diagnostics.
     * @param {TextDocument} document the LGD document.
     * @returns {void}
     */
    closeDocument(document)
    {
        const key = document.uri.toString();
        this.states.delete(key);
        this.pendingUpdates.delete(key);
        this.diagnosticCollection.delete(document.uri);
    },

    /**
     * @description Gets the state for an LGD document uri, if it is open.
     * @param {Uri} uri the LGD document uri.
     * @returns {Object|undefined} the document state.
     */
    getState(uri)
    {
        return this.states.get(uri.toString());
    },

    /**
     * @description Recompiles one LGD document and refreshes its JavaScript mirror and diagnostics.
     * @param {Object} state the document state.
     * @returns {Promise<Object>} the document state.
     */
    async recompile(state)
    {
        const content = state.document.getText();
        const result = this.compiler.compileToJs(content);
        state.map = LgdSourceMap.create(result.mappings);
        state.errors = result.errors;
        await this.syncMirror(state, result.code);
        this.publishDiagnostics(state);
        return state;
    },

    /**
     * @description Creates the JavaScript mirror on first compile, or refreshes its content.
     * The mirror document is assigned on the stored state after the await, never on a
     * reference captured before it, so concurrent readers cannot see a stale document.
     * @param {Object} state the document state.
     * @param {string} code the compiled JavaScript.
     * @returns {Promise<void>}
     */
    async syncMirror(state, code)
    {
        if(state.jsDocument)
        {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                state.jsDocument.positionAt(0),
                state.jsDocument.positionAt(state.jsDocument.getText().length)
            );
            edit.replace(state.jsDocument.uri, fullRange, code);
            await vscode.workspace.applyEdit(edit);
            return;
        }

        const created = await vscode.workspace.openTextDocument({ language: 'javascript', content: code });
        const key = state.document.uri.toString();
        const current = this.states.get(key);
        if(current)
        {
            current.jsDocument = created;
        }
    },

    /**
     * @description Publishes LGD compiler errors as editor diagnostics on the LGD document.
     * @param {Object} state the document state.
     * @returns {void}
     */
    publishDiagnostics(state)
    {
        const text = state.document.getText();
        const diagnostics = state.errors.map(error =>
        {
            const position = state.document.positionAt(Math.min(error.offset, text.length));
            const lineRange = state.document.lineAt(position.line).range;
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(position, lineRange.end),
                `LGD: ${error.message}`,
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.source = 'LGD';
            return diagnostic;
        });

        this.diagnosticCollection.set(state.document.uri, diagnostics);
    },

    /**
     * @description Translates an LGD position to the matching position in the compiled JavaScript.
     * @param {Uri} uri the LGD document uri.
     * @param {Position} position the LGD position.
     * @returns {Position|null} the JavaScript position, or null when the document is not ready.
     */
    toJsPosition(uri, position)
    {
        const state = this.getState(uri);
        if(!state || !state.map || !state.jsDocument)
        {
            return null;
        }

        const offset = state.document.offsetAt(position);
        const jsOffset = state.map.toOutput(Math.min(offset, state.document.getText().length));
        return state.jsDocument.positionAt(Math.min(jsOffset, state.jsDocument.getText().length));
    },

    /**
     * @description Translates a compiled JavaScript position back to the LGD source.
     * @param {Uri} uri the LGD document uri.
     * @param {Position} jsPosition the JavaScript position.
     * @returns {Position|null} the LGD position, or null when the document is not ready.
     */
    toLgdPosition(uri, jsPosition)
    {
        const state = this.getState(uri);
        if(!state || !state.map || !state.jsDocument)
        {
            return null;
        }

        const jsOffset = state.jsDocument.offsetAt(jsPosition);
        const offset = state.map.toSource(jsOffset);
        return state.document.positionAt(Math.min(offset, state.document.getText().length));
    },

    /**
     * @description Translates a compiled JavaScript range back to the LGD source.
     * @param {Uri} uri the LGD document uri.
     * @param {Range} jsRange the JavaScript range.
     * @returns {Range|null} the LGD range, or null when the document is not ready.
     */
    toLgdRange(uri, jsRange)
    {
        const start = this.toLgdPosition(uri, jsRange.start);
        const end = this.toLgdPosition(uri, jsRange.end);
        return start && end ? new vscode.Range(start, end) : null;
    }
};

module.exports = LgdLanguageService;
