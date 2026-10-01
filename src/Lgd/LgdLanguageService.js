const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
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
            this.states.set(key, { document: document, jsDocument: null, map: null, errors: [], declarations: [] });
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
     * @description Applies a compilation result to a document state.
     * @param {Object} state the document state.
     * @param {Object} result the {mappings, errors, allDeclarations} compilation result.
     * @returns {void}
     */
    applyCompilation(state, result)
    {
        state.map = LgdSourceMap.create(result.mappings);
        state.errors = result.errors;
        state.declarations = result.allDeclarations;
    },

    /**
     * @description Recompiles one LGD document and refreshes its JavaScript mirror and diagnostics.
     * @param {Object} state the document state.
     * @returns {Promise<Object>} the document state.
     */

    async recompile(state)
    {
        const content = state.document.getText();
        const externals = await this.collectExternalTypes(state.document);
        const result = this.compiler.compileToJs(content, externals);
        this.applyCompilation(state, result);
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
            const severity = error.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(position, lineRange.end),
                `LGD: ${error.message}`,
                severity
            );
            diagnostic.source = 'LGD';
            return diagnostic;
        });

        this.diagnosticCollection.set(state.document.uri, diagnostics);
    },

    /**
     * @description Maps a require spec to the sibling .lgd source it was compiled from.
     * Compiled output is required with its dotted name (./Foo.lgd.js), so the source
     * is the same path without the trailing .js; a bare ./Foo also maps to ./Foo.lgd.
     * @param {string} fromDir the directory of the requiring document.
     * @param {string} spec the require spec as written.
     * @returns {string|null} the absolute .lgd source path, or null for bare imports.
     */
    resolveLgdSourcePath(fromDir, spec)
    {
        if(!spec.startsWith('.'))
        {
            return null;
        }

        const candidate = path.resolve(fromDir, spec);
        if(candidate.endsWith('.lgd.js'))
        {
            return candidate.slice(0, -'.js'.length);
        }

        if(candidate.endsWith('.lgd'))
        {
            return candidate;
        }

        return `${candidate}.lgd`;
    },

    /**
     * @description Reads a sibling .lgd file and finds the declaration it exports.
     * Unreadable files and files without a plain `module.exports = Name` export yield null.
     * @param {string} sourcePath the absolute .lgd source path.
     * @returns {Object|null} the {name, typeName, keyword, members} export, or null.
     */
    async readExportDeclaration(sourcePath)
    {
        let targetText;
        try
        {
            targetText = await fs.promises.readFile(sourcePath, 'utf8');
        }
        catch
        {
            return null;
        }

        const exportMatch = (/module\.exports\s*=\s*(?<name>[$A-Z_a-z][\w$]*)/).exec(targetText);
        if(!exportMatch)
        {
            return null;
        }

        const parsed = this.compiler.parse(targetText);
        const declaration = parsed.allDeclarations.find(candidate => candidate.name === exportMatch[1]);
        if(!declaration)
        {
            return null;
        }

        const keywords = [ 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'Object', 'Array', 'Function' ];
        return {
            name: declaration.name,
            typeName: declaration.typeName,
            keyword: keywords.includes(declaration.typeName) ? declaration.typeName : 'Object',
            members: declaration.members || []
        };
    },

    /**
     * @description Builds the cross-file type map for a document's relative requires.
     * @param {TextDocument} document the LGD document.
     * @returns {Map} require specs to {exportName, keyword} entries.
     */
    async collectExternalTypes(document)
    {
        const externals = new Map();
        const fromDir = path.dirname(document.uri.fsPath);
        const pattern = /\brequire\(\s*(?<quote>["'])(?<spec>(?:(?!\k<quote>)[^\\]|\\.)*)\k<quote>\s*\)/g;
        let match = pattern.exec(document.getText());
        while(match)
        {
            const spec = match.groups.spec;
            if(!externals.has(spec))
            {
                const sourcePath = this.resolveLgdSourcePath(fromDir, spec);
                const exported = sourcePath ? await this.readExportDeclaration(sourcePath) : null;
                if(exported)
                {
                    externals.set(spec, { exportName: exported.name, keyword: exported.keyword });
                }
            }

            match = pattern.exec(document.getText());
        }

        return externals;
    },

    /**
     * @description Follows a require initializer to the exported declaration of a sibling .lgd file.
     * @param {TextDocument} document the LGD document holding the declaration.
     * @param {Object} declaration the parsed declaration whose initializer may be a require call.
     * @returns {Object|null} the {name, typeName, keyword, members} export, or null.
     */
    async resolveRequireTarget(document, declaration)
    {
        const initializer = document.getText().slice(declaration.initializerStart, declaration.initializerEnd).trim();
        const match = (/^require\(\s*(?<quote>["'])(?<spec>(?:(?!\k<quote>)[^\\]|\\.)*)\k<quote>\s*\)$/).exec(initializer);
        if(!match)
        {
            return null;
        }

        const sourcePath = this.resolveLgdSourcePath(path.dirname(document.uri.fsPath), match.groups.spec);
        if(!sourcePath)
        {
            return null;
        }

        const exported = await this.readExportDeclaration(sourcePath);
        return exported;
    },

    /**
     * @description Describes a declared name for hover and completions: its type and members.
     * Require initializers are followed into the sibling .lgd file they load.
     * @param {Uri} uri the LGD document uri.
     * @param {string} name the hovered or completed name.
     * @returns {Promise<Object|null>} the {name, typeName, readonly, members, params} summary, or null.
     */
    async getTypeSummary(uri, name)
    {
        const state = this.getState(uri);
        if(!state || !state.declarations)
        {
            return null;
        }

        const declaration = state.declarations.find(candidate => candidate.name === name);
        if(!declaration)
        {
            return null;
        }

        let members = declaration.members || [];
        if(members.length === 0)
        {
            const target = await this.resolveRequireTarget(state.document, declaration);
            if(target)
            {
                members = target.members;
            }
        }

        const params = this.describeTypedParams(declaration.typedParams);

        return { name: declaration.name, typeName: declaration.typeName, readonly: declaration.readonly, members: members, params: params };
    },

    /**
     * @description Describes the typed parameters of a declaration for hover and completions.
     * @param {Object|undefined} typedParams the parsed {hasTypes, params} parameter info.
     * @returns {Array} the {name, typeName} parameter summaries, or an empty array.
     */
    describeTypedParams(typedParams)
    {
        if(!typedParams || !typedParams.hasTypes)
        {
            return [];
        }

        return typedParams.params
            .filter(parameter => parameter.name)
            .map(parameter => ({ name: parameter.name, typeName: parameter.typeName }));
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
