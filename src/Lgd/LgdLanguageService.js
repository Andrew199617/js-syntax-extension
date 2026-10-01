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
     * LGD sources require the compiled './Foo.js' spelling, which maps back to ./Foo.lgd.
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

        if(candidate.endsWith('.js'))
        {
            return `${candidate.slice(0, -'.js'.length)}.lgd`;
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
     * @description Lists the members visible through `this` at the cursor: the own members
     * of the enclosing object literal plus the properties its create() method assigns.
     * @param {TextDocument} document the LGD document.
     * @param {Position} position the cursor position just past `this.`.
     * @returns {Array} the {name, kind} members, or an empty array outside an object literal.
     */
    getThisMembers(document, position)
    {
        const state = this.getState(document.uri);
        if(!state || !state.declarations)
        {
            return [];
        }

        const declaration = this.findEnclosingObjectDeclaration(state.declarations, document.offsetAt(position));
        if(!declaration)
        {
            return [];
        }

        const members = [...declaration.members || []];
        const seen = new Set(members.map(member => member.name));
        for(const extra of this.extractCreateMembers(declaration.initializerText || ''))
        {
            if(!seen.has(extra.name))
            {
                seen.add(extra.name);
                members.push(extra);
            }
        }

        return members;
    },

    /**
     * @description Finds the innermost object literal declaration containing an offset,
     * so `this` inside a nested literal resolves to that literal.
     * @param {Array} declarations the flat parsed declarations.
     * @param {number} offset the cursor offset.
     * @returns {Object|null} the enclosing object literal declaration, or null.
     */
    findEnclosingObjectDeclaration(declarations, offset)
    {
        let best = null;
        for(const declaration of declarations)
        {
            if(typeof declaration.start !== 'number' || typeof declaration.end !== 'number')
            {
                continue;
            }

            if(offset < declaration.start || offset > declaration.end)
            {
                continue;
            }

            if(!(declaration.initializerText || '').trimStart().startsWith('{'))
            {
                continue;
            }

            if(!best || declaration.end - declaration.start < best.end - best.start)
            {
                best = declaration;
            }
        }

        return best;
    },

    /**
     * @description Collects the instance properties a create() method assigns, either on
     * `this` directly or on the local variable it returns (the OLOO builder pattern).
     * @param {string} initializerText the object literal source text.
     * @returns {Array} the {name, kind: 'property'} members assigned in create().
     */
    extractCreateMembers(initializerText)
    {
        const body = this.findCreateBody(initializerText);
        if(!body)
        {
            return [];
        }

        const built = new Set();
        for(const returned of body.matchAll(/\breturn\s+(?<name>[$A-Z_a-z][\w$]*)\s*;/g))
        {
            built.add(returned.groups.name);
        }

        const members = [];
        const seen = new Set();
        const pattern = /\b(?<object>this|[$A-Z_a-z][\w$]*)\.(?<property>[$A-Z_a-z][\w$]*)\s*=(?![=>])/g;
        let match = pattern.exec(body);
        while(match)
        {
            const target = match.groups.object;
            const property = match.groups.property;
            if((target === 'this' || built.has(target)) && !seen.has(property))
            {
                seen.add(property);
                members.push({ name: property, kind: 'property' });
            }

            match = pattern.exec(body);
        }

        return members;
    },

    /**
     * @description Finds the body of the create() method in an object literal, skipping
     * matches that sit inside strings or comments.
     * @param {string} initializerText the object literal source text.
     * @returns {string|null} the method body without its braces, or null when absent.
     */
    findCreateBody(initializerText)
    {
        const pattern = /(?:^|[\s,;{])(?:async\s+)?create\s*\([^)]*\)\s*{/g;
        let match = pattern.exec(initializerText);
        while(match)
        {
            if(!this.isInsideStringOrComment(initializerText, match.index))
            {
                const openIndex = match.index + match[0].lastIndexOf('{');
                return this.extractBalancedBody(initializerText, openIndex);
            }

            match = pattern.exec(initializerText);
        }

        return null;
    },

    /**
     * @description Reports whether an index sits inside a string literal or comment.
     * @param {string} text the source text.
     * @param {number} index the index to test.
     * @returns {boolean} true inside a string or comment.
     */
    isInsideStringOrComment(text, index)
    {
        let mode = 'code';
        let quote = '';
        let position = 0;
        while(position < index)
        {
            const character = text[position];
            const next = position + 1 < text.length ? text[position + 1] : '';
            if(mode === 'code')
            {
                if(character === "'" || character === '"' || character === '`')
                {
                    mode = 'string';
                    quote = character;
                }
                else if(character === '/' && next === '/')
                {
                    mode = 'line';
                    position++;
                }
                else if(character === '/' && next === '*')
                {
                    mode = 'block';
                    position++;
                }
            }
            else if(mode === 'string')
            {
                if(character === '\\')
                {
                    position++;
                }
                else if(character === quote)
                {
                    mode = 'code';
                }
            }
            else if(mode === 'line')
            {
                if(character === '\n')
                {
                    mode = 'code';
                }
            }
            else if(mode === 'block')
            {
                if(character === '*' && next === '/')
                {
                    mode = 'code';
                    position++;
                }
            }

            position++;
        }

        return mode !== 'code';
    },

    /**
     * @description Extracts the body between a brace pair, skipping string literals and
     * comments so their braces do not affect the depth count. Template literals are
     * treated as opaque strings; `${}` interpolation inside them is not parsed.
     * @param {string} text the source text.
     * @param {number} openIndex the index of the opening brace.
     * @returns {string|null} the body without the outer braces, or null when unbalanced.
     */
    extractBalancedBody(text, openIndex)
    {
        let depth = 0;
        let index = openIndex;
        let mode = 'code';
        let quote = '';
        while(index < text.length)
        {
            const character = text[index];
            const next = index + 1 < text.length ? text[index + 1] : '';
            if(mode === 'code')
            {
                if(character === "'" || character === '"' || character === '`')
                {
                    mode = 'string';
                    quote = character;
                }
                else if(character === '/' && next === '/')
                {
                    mode = 'line';
                    index++;
                }
                else if(character === '/' && next === '*')
                {
                    mode = 'block';
                    index++;
                }
                else if(character === '{')
                {
                    depth++;
                }
                else if(character === '}')
                {
                    depth--;
                    if(depth === 0)
                    {
                        return text.slice(openIndex + 1, index);
                    }
                }
            }
            else if(mode === 'string')
            {
                if(character === '\\')
                {
                    index++;
                }
                else if(character === quote)
                {
                    mode = 'code';
                }
            }
            else if(mode === 'line')
            {
                if(character === '\n')
                {
                    mode = 'code';
                }
            }
            else if(mode === 'block')
            {
                if(character === '*' && next === '/')
                {
                    mode = 'code';
                    index++;
                }
            }

            index++;
        }

        return null;
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
