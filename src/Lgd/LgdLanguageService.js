const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const LgdCompiler = require('../Compilers/LgdCompiler');
const LgdSourceMap = require('../Compilers/LgdSourceMap');
const { maskCode } = require('../Compilers/LgdInfer');
const { getConstructorParams } = require('../Compilers/LgdBaseChecker');
const { parseTypedParams, splitTopLevelChunks, isRegexStart, skipRegexLiteral } = require('../Compilers/LgdTypedParams');

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
        const next = this.applyUpdate(document, this.states.get(key), pending);
        this.pendingUpdates.set(key, this.trackSettled(next));
        return next;
    },

    /**
     * @description Waits for the previous update, then recompiles the document.
     * @param {TextDocument} document the LGD document.
     * @param {Object|undefined} state the document state captured before queuing.
     * @param {Promise<void>} pending the previous update.
     * @returns {Promise<Object|null>} the document state.
     */
    async applyUpdate(document, state, pending)
    {
        await pending;
        if(!state || this.getState(document.uri) !== state)
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
        if(this.getState(state.document.uri) !== state)
        {
            return null;
        }

        const result = this.compiler.compileToJs(content, externals);
        const newline = this.compiler.detectNewline(content);

        // Keep the in-memory mirror safe while giving tsserver its real module-resolution directory.
        const sourceContext = state.document.uri.scheme === 'file'
            ? `${newline}//# lgd-source=${JSON.stringify(state.document.uri.fsPath)}${newline}`
            : '';
        await this.syncMirror(state, result.code + sourceContext);
        if(this.getState(state.document.uri) !== state)
        {
            return null;
        }

        this.applyCompilation(state, result);
        state.externals = externals;
        this.publishDiagnostics(state);
        return state;
    },

    /**
     * @description Creates the JavaScript mirror on first compile, or refreshes its content.
     * Only the same open-document state may receive the result after awaiting creation;
     * closing and reopening a source must never attach an earlier mirror to the new state.
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
            const applied = await vscode.workspace.applyEdit(edit);
            if(!applied)
            {
                throw new Error('LGD: Could not update the JavaScript mirror.');
            }

            return;
        }

        const created = await vscode.workspace.openTextDocument({ language: 'javascript', content: code });
        const key = state.document.uri.toString();
        const current = this.states.get(key);
        if(current === state)
        {
            state.jsDocument = created;
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
     * @param {Set} visited the source paths already being resolved, to stop circular imports.
     * @returns {Object|null} the exported type, constructor signature and source location, or null.
     */
    async readExportDeclaration(sourcePath, visited = new Set())
    {
        if(visited.has(sourcePath))
        {
            return null;
        }

        const resolving = new Set(visited);
        resolving.add(sourcePath);
        const openState = [...this.states.values()].find(state => state.document.uri.fsPath === sourcePath);
        let targetText;
        try
        {
            targetText = openState ? openState.document.getText() : await fs.promises.readFile(sourcePath, 'utf8');
        }
        catch
        {
            return null;
        }

        const exportMatch = (/\bmodule\.exports\s*=\s*(?<name>[$A-Z_a-z][\w$]*)\s*(?:;|$)/).exec(maskCode(targetText, true));
        if(!exportMatch)
        {
            return null;
        }

        const parsed = this.compiler.parse(targetText);
        const declaration = parsed.declarations.find(candidate => candidate.name === exportMatch.groups.name);
        if(!declaration)
        {
            return null;
        }

        const document = { uri: { fsPath: sourcePath }, getText: () => targetText };
        const externals = declaration.baseName ? await this.collectExternalTypes(document, resolving) : new Map();
        const context = { declarations: parsed.allDeclarations, externals: externals, sourceText: targetText };
        const keywords = [ 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'Object', 'Array', 'Function' ];
        return {
            name: declaration.name,
            typeName: declaration.typeName,
            keyword: keywords.includes(declaration.typeName) ? declaration.typeName : 'Object',
            kind: declaration.kind,
            baseName: declaration.baseName,
            constructorParams: getConstructorParams(declaration),
            members: this.getDeclaredMembers(declaration, context),
            sourcePath: sourcePath,
            sourceText: targetText,
            nameStart: declaration.nameStart,
            nameEnd: declaration.nameEnd
        };
    },

    /**
     * @description Builds the cross-file type map for a document's relative requires.
     * @param {TextDocument} document the LGD document.
     * @param {Set} visited the source paths already being resolved.
     * @returns {Map} require specs to exported types, members and known constructor signatures.
     */
    async collectExternalTypes(document, visited = new Set())
    {
        const externals = new Map();
        const fromDir = path.dirname(document.uri.fsPath);
        const resolving = new Set(visited);
        resolving.add(document.uri.fsPath);
        const text = document.getText();
        const code = maskCode(text, true);
        const pattern = /\brequire\(\s*(?<quote>["'])(?<spec>(?:(?!\k<quote>)[^\\]|\\.)*)\k<quote>\s*\)/g;
        let match = pattern.exec(text);
        while(match)
        {
            if(!code.startsWith('require', match.index))
            {
                match = pattern.exec(text);
                continue;
            }

            const spec = match.groups.spec;
            if(!externals.has(spec))
            {
                const sourcePath = this.resolveLgdSourcePath(fromDir, spec);
                const exported = sourcePath ? await this.readExportDeclaration(sourcePath, resolving) : null;
                if(exported)
                {
                    const entry = { exportName: exported.name, keyword: exported.keyword };
                    if(exported.keyword === 'Object')
                    {
                        entry.kind = exported.kind;
                        entry.baseName = exported.baseName;
                        entry.members = exported.members;
                        entry.constructorParams = exported.constructorParams;
                    }

                    externals.set(spec, entry);
                }
            }

            match = pattern.exec(text);
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

        const context = this.getMemberContext(state);
        const declaration = state.declarations.find(candidate => candidate.name === name);
        if(!declaration)
        {
            const imported = this.findImportedType(name, context);
            return imported
                ? {
                    name: name, typeName: imported.keyword, kind: imported.kind, baseName: imported.baseName,
                    readonly: true, members: imported.members || [], params: [],
                    constructorParams: imported.constructorParams || []
                }
                : null;
        }

        let required = this.getRequiredType(declaration.initializerText || '', context.externals);
        let members = this.getDeclaredMembers(declaration, context);
        if(required || members.length === 0)
        {
            const target = await this.resolveRequireTarget(state.document, declaration);
            if(target)
            {
                members = target.members;
                required = target;
            }
        }

        const summary = {
            name: declaration.name,
            typeName: declaration.typeName,
            readonly: declaration.readonly,
            members: members,
            params: this.describeTypedParams(declaration.typedParams)
        };
        if(declaration.kind === 'class' || required?.kind === 'class')
        {
            summary.kind = 'class';
            summary.baseName = declaration.baseName || required?.baseName;
            summary.constructorParams = getConstructorParams(declaration) || required?.constructorParams || [];
        }

        return summary;
    },

    /**
     * @description Collects the source and resolved imports used to describe inherited members.
     * @param {Object} state the open document state.
     * @returns {Object} the declaration and import context.
     */
    getMemberContext(state)
    {
        return {
            declarations: state.declarations,
            externals: state.externals || new Map(),
            sourceText: state.document.getText()
        };
    },

    /**
     * @description Finds the exported type for a plain require initializer.
     * @param {string} initializer the declaration initializer.
     * @param {Map} externals the resolved relative imports.
     * @returns {Object|null} the exported type, or null.
     */
    getRequiredType(initializer, externals)
    {
        const match = (/^\s*require\(\s*(?<quote>["'])(?<spec>(?:(?!\k<quote>)[^\\]|\\.)*)\k<quote>\s*\)\s*$/).exec(initializer);
        return match ? externals.get(match.groups.spec) || null : null;
    },

    /**
     * @description Resolves an ordinary JavaScript require binding used as an LGD base.
     * @param {string} name the local binding name.
     * @param {Object} context the source and resolved imports.
     * @returns {Object|null} the exported type, or null.
     */
    findImportedType(name, context)
    {
        const code = maskCode(context.sourceText, true);
        const pattern = /\b(?<keyword>const|let|var)\s+(?<name>[$A-Z_a-z][\w$]*)\s*=\s*(?<initializer>require\(\s*(?<quote>["'])(?<spec>(?:(?!\k<quote>)[^\\]|\\.)*)\k<quote>\s*\))/g;
        for(const match of context.sourceText.matchAll(pattern))
        {
            if(match.groups.name === name && code.startsWith(match.groups.keyword, match.index))
            {
                return context.externals.get(match.groups.spec) || null;
            }
        }

        return null;
    },

    /**
     * @description Combines own and inherited object members, keeping overrides and stopping cycles.
     * @param {Object} declaration the object or LGD class declaration.
     * @param {Object} context the source declarations and resolved imports.
     * @param {Set} visited the declarations already being described.
     * @returns {Array} the visible deduplicated members.
     */
    getDeclaredMembers(declaration, context, visited = new Set())
    {
        if(visited.has(declaration))
        {
            return [];
        }

        const resolving = new Set(visited);
        resolving.add(declaration);
        const members = this.getObjectMembers(declaration);
        const required = this.getRequiredType(declaration.initializerText || '', context.externals);
        let inherited = required?.members || [];
        if(declaration.baseName)
        {
            const base = context.declarations.find(candidate => candidate.name === declaration.baseName);
            inherited = base
                ? this.getDeclaredMembers(base, context, resolving)
                : this.findImportedType(declaration.baseName, context)?.members || [];
        }

        if(!declaration.baseName && !required && declaration.kind !== 'class')
        {
            const nominal = context.declarations.find(candidate => candidate.kind === 'class' && candidate.name === declaration.typeName);
            if(nominal)
            {
                inherited = this.getDeclaredMembers(nominal, context, resolving);
            }
        }

        const seen = new Set(members.map(member => member.name));
        for(const member of inherited)
        {
            if(!seen.has(member.name))
            {
                seen.add(member.name);
                members.push(member);
            }
        }

        return members;
    },

    /**
     * @description Lists the members visible through `this` at the cursor: the own and inherited
     * members plus the properties assigned in its constructor or create() method.
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

        return this.getDeclaredMembers(declaration, this.getMemberContext(state));
    },

    /**
     * @description Lists the own members of an object or class declaration, including
     * properties assigned to the instance by its constructor or create() method.
     * @param {Object} declaration the object literal declaration.
     * @returns {Array} the deduplicated {name, kind} members.
     */
    getObjectMembers(declaration)
    {
        const members = [...declaration.members || []];
        const seen = new Set(members.map(member => member.name));
        for(const extra of this.extractConstructorMembers(declaration))
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
     * @description Finds the detail for one instance property at a `this.` access: the
     * constructor-assigned member with its declared type and literal shape.
     * @param {TextDocument} document the LGD document.
     * @param {Position} position the cursor position inside the member access.
     * @param {string} name the accessed member name.
     * @returns {Object|null} the {name, kind, typeName, properties} member, or null.
     */
    getThisMemberDetail(document, position, name)
    {
        const state = this.getState(document.uri);
        if(!state || !state.declarations)
        {
            return null;
        }

        const declaration = this.findEnclosingObjectDeclaration(state.declarations, document.offsetAt(position));
        if(!declaration)
        {
            return null;
        }

        const members = this.getDeclaredMembers(declaration, this.getMemberContext(state));
        const found = members.find(member =>
        {
            const hasDetail = member.typeName || member.properties;
            return member.name === name && member.kind === 'property' && hasDetail;
        });

        return found || null;
    },

    /**
     * @description Finds the innermost object literal or class declaration containing an offset,
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

            if(declaration.kind !== 'class' && !(declaration.initializerText || '').trimStart().startsWith('{'))
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
     * Each member carries the `@type {X}` JSDoc declared above its assignment when one
     * is present, plus the property names when the assigned value is an object literal.
     * @param {string} initializerText the object literal source text.
     * @param {Array} params the known create parameters.
     * @returns {Array} the {name, kind: 'property', typeName, properties} members assigned in create().
     */
    extractCreateMembers(initializerText, params = [])
    {
        const body = this.findCreateBody(initializerText);
        if(!body)
        {
            return [];
        }

        return this.extractAssignedMembers(body, true, params);
    },

    /**
     * @description Finds instance properties from a class constructor or an OLOO create method.
     * @param {Object} declaration the object or class declaration.
     * @returns {Array} the assigned instance properties.
     */
    extractConstructorMembers(declaration)
    {
        if(declaration.kind !== 'class')
        {
            return this.extractCreateMembers(declaration.initializerText || '', getConstructorParams(declaration) || []);
        }

        const constructor = declaration.constructorMember;
        if(!constructor)
        {
            return [];
        }

        const body = declaration.initializerText.slice(
            constructor.bodyStart + 1 - declaration.initializerStart,
            constructor.bodyEnd - 1 - declaration.initializerStart
        );

        return this.extractAssignedMembers(body, false, constructor.params);
    },

    /**
     * @description Reads this assignments and optional OLOO builder assignments from a constructor body.
     * @param {string} body the constructor body without braces.
     * @param {boolean} includeReturned whether returned local objects are also instance builders.
     * @param {Array} params the constructor parameters, when known.
     * @returns {Array} the property types and literal shapes.
     */
    extractAssignedMembers(body, includeReturned, params = [])
    {
        const code = maskCode(body, true);
        const built = new Set();
        if(includeReturned)
        {
            for(const returned of code.matchAll(/\breturn\s+(?<name>[$A-Z_a-z][\w$]*)\s*;/g))
            {
                built.add(returned.groups.name);
            }
        }

        const members = [];
        const seen = new Set();
        const pattern = /\b(?<object>this|[$A-Z_a-z][\w$]*)\.(?<property>[$A-Z_a-z][\w$]*)\s*=(?![=>])/g;
        let match = pattern.exec(code);
        while(match)
        {
            const target = match.groups.object;
            const property = match.groups.property;
            if((target === 'this' || built.has(target)) && !seen.has(property))
            {
                seen.add(property);
                const valueIndex = match.index + match[0].length;
                const assignedName = (/^\s*(?<name>[$A-Z_a-z][\w$]*)\s*(?:;|$)/).exec(code.slice(valueIndex));
                const parameter = assignedName && params.find(candidate => candidate.name === assignedName.groups.name);
                members.push({
                    name: property,
                    kind: 'property',
                    typeName: this.findAssignmentTypeName(body, match.index) || parameter?.typeName || null,
                    properties: this.findAssignedLiteralProperties(body, match.index + match[0].length)
                });
            }

            match = pattern.exec(code);
        }

        return members;
    },

    /**
     * @description Reads the `@type {X}` JSDoc tag from a docblock immediately preceding an
     * assignment, so hover can name the declared type of a create()-assigned property.
     * @param {string} body the create() method body.
     * @param {number} assignmentIndex the index where the assignment match starts.
     * @returns {string|null} the declared type name, or null when absent.
     */
    findAssignmentTypeName(body, assignmentIndex)
    {
        const before = body.slice(0, assignmentIndex);
        const docblock = before.match(/\/\*\*\s*@type\s*{(?<type>[^}]+)}\s*\*\/\s*$/);
        return docblock ? docblock.groups.type.trim() : null;
    },

    /**
     * @description Lists the top-level property names of an object literal assigned at an
     * index, so hover can show the shape of a create()-assigned property.
     * @param {string} body the create() method body.
     * @param {number} valueIndex the index just past the assignment operator.
     * @returns {Array} the property names, or an empty array when the value is not an object literal.
     */
    findAssignedLiteralProperties(body, valueIndex)
    {
        let index = valueIndex;
        while(index < body.length && (/\s/).test(body[index]))
        {
            index++;
        }

        if(body[index] !== '{')
        {
            return [];
        }

        const literal = this.extractBalancedBody(body, index);
        if(literal === null)
        {
            return [];
        }

        return this.compiler.extractMembers(`{${literal}}`).map(member => member.name);
    },

    /**
     * @description Finds the body of the create() method in an object literal, skipping
     * matches that sit inside strings or comments.
     * @param {string} initializerText the object literal source text.
     * @returns {string|null} the method body without its braces, or null when absent.
     */
    findCreateBody(initializerText)
    {
        for(const chunk of splitTopLevelChunks(initializerText.trim()))
        {
            const memberText = chunk.text.replace(/^(?:\s|\/\*[\S\s]*?\*\/|\/\/[^\n]*)+/, '');
            if(!(/^(?:async\s+)?create\s*\(/).test(memberText))
            {
                continue;
            }

            const parameters = parseTypedParams(memberText);
            if(!parameters)
            {
                continue;
            }

            const code = maskCode(memberText, true);
            const bodyStart = parameters.end + code.slice(parameters.end).search(/\S/);
            if(code[bodyStart] === '{')
            {
                return this.extractBalancedBody(memberText, bodyStart);
            }
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
                else if(character === '/' && isRegexStart(text, position))
                {
                    const regexEnd = skipRegexLiteral(text, position);
                    if(regexEnd > index)
                    {
                        return true;
                    }

                    if(regexEnd !== -1)
                    {
                        position = regexEnd - 1;
                    }
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
     * comments so their braces do not affect the depth count. Executable template
     * interpolation expressions retain their balanced braces.
     * @param {string} text the source text.
     * @param {number} openIndex the index of the opening brace.
     * @returns {string|null} the body without the outer braces, or null when unbalanced.
     */
    extractBalancedBody(text, openIndex)
    {
        const code = maskCode(text, true);
        let depth = 0;
        for(let index = openIndex; index < code.length; index++)
        {
            if(code[index] === '{')
            {
                depth++;
            }
            else if(code[index] === '}')
            {
                depth--;
                if(depth === 0)
                {
                    return text.slice(openIndex + 1, index);
                }
            }
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
