const vscode = require('vscode');
const path = require('path');
const LgdProjectIdentity = require('../Compilers/LgdProjectIdentity');
const LgdExportCache = require('./LgdExportCache');
const { getTypeSummary, getContractMetadata, getTypedMembers, getInterfaceMembers, getRuntimeMembers, filterThisMembers, filterDeclaredMembers } = require('./LgdContractEditor');
const createLgdDiagnostics = require('./LgdDiagnostics');
const settleEditorUpdate = require('./LgdEditorFailures');
const LgdCompiler = require('../Compilers/LgdCompiler');
const LgdSourceMap = require('../Compilers/LgdSourceMap');
const { maskCode } = require('../Compilers/LgdInfer');
const { baseTypeName } = require('../Compilers/LgdTypeMaps');
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
     * @param {Function} getOutputOptions reads the current compiler output settings.
     * @returns {LgdLanguageServiceType}
     */
    create(diagnosticCollection, onError, getOutputOptions = () => ({}))
    {
        const service = Object.create(LgdLanguageService);
        service.diagnosticCollection = diagnosticCollection;
        service.onError = onError;
        service.getOutputOptions = getOutputOptions;
        service.compiler = LgdCompiler.create();

        /** @description Open LGD documents by uri string: { document, jsDocument, map, errors }. */
        service.states = new Map();

        /** @description Settled recompile promises by uri string, serializing updates per document. */
        service.pendingUpdates = new Map();
        service.openStatesByPath = new Map();
        service.exportCache = new Map();
        service.sourceVersions = new Map();
        service.dependencies = new Map();
        service.dependents = new Map();
        service.pendingDependencyUpdates = Promise.resolve();

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

        this.openStatesByPath.set(document.uri.fsPath, this.states.get(key));
        return this.updateDocument(document);
    },

    /**
     * @description Recompiles an LGD document after it changed, serialized per document.
     * The returned promise rejects when the recompile fails; the stored chain always settles.
     * @param {TextDocument} document the LGD document.
     * @param {boolean} refreshDependents whether its changed exports should recheck consumers.
     * @returns {Promise<Object|null>} the document state.
     */
    updateDocument(document, refreshDependents = true)
    {
        const key = document.uri.toString();
        const pending = this.pendingUpdates.get(key) || Promise.resolve();
        const next = this.applyUpdate(document, this.states.get(key), { pending: pending, refreshDependents: refreshDependents });
        this.pendingUpdates.set(key, this.trackSettled(next, document));
        return next;
    },

    /**
     * @description Waits for the previous update, then recompiles the document.
     * @param {TextDocument} document the LGD document.
     * @param {Object|undefined} state the document state captured before queuing.
     * @param {Object} update the previous promise and dependent-refresh choice.
     * @returns {Promise<Object|null>} the document state.
     */
    async applyUpdate(document, state, update)
    {
        await update.pending;
        if(!state || this.getState(document.uri) !== state)
        {
            return null;
        }

        state.document = document;
        const previousSignature = this.exportCache.get(document.uri.fsPath)?.signature;
        const result = await this.recompile(state);
        if(result && update.refreshDependents)
        {
            this.queueDependencyRefresh(document.uri.fsPath, previousSignature);
        }

        return result;
    },

    /** @description Reports rejected document or dependency updates while allowing later updates to run. */
    trackSettled(promise, document) { return settleEditorUpdate(this, promise, document); },

    /**
     * @description Drops an LGD document and clears its diagnostics.
     * @param {TextDocument} document the LGD document.
     * @returns {void}
     */
    closeDocument(document)
    {
        const key = document.uri.toString();
        this.states.delete(key);
        this.openStatesByPath.delete(document.uri.fsPath);
        this.pendingUpdates.delete(key);
        this.diagnosticCollection.delete(document.uri);
        this.invalidateFile(document.uri.fsPath);
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
        const version = state.document.version;
        const externals = await this.collectExternalTypes(state.document);
        if(this.getState(state.document.uri) !== state)
        {
            return null;
        }

        const identity = externals.sourceContext || await LgdProjectIdentity.resolve({ sourcePath: state.document.uri.fsPath });
        const result = this.compiler.compileToJs(content, externals, { ...this.getOutputOptions(state.document), ...identity });
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
        const cached = this.exportCache.get(state.document.uri.fsPath);
        if(!cached || cached.sourceText !== content)
        {
            this.exportCache.set(state.document.uri.fsPath, { sourceText: content, parsed: result, projectId: identity.projectId });
        }

        state.compiledVersion = version;
        state.compiledText = content;
        state.externals = externals;
        state.projectId = identity.projectId;
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
        this.diagnosticCollection.set(state.document.uri, createLgdDiagnostics(state.document, state.errors));
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

    refreshProjectIdentities() { return LgdExportCache.refreshProjectIdentities(this); },

    readSourceEntry(sourcePath) { return LgdExportCache.readSourceEntry(this, sourcePath); },

    replaceDependencies(sourcePath, dependencies) { return LgdExportCache.replaceDependencies(this, sourcePath, dependencies); },

    exportSignature(exported) { return LgdExportCache.exportSignature(this, exported); },

    invalidateFile(sourcePath) { return LgdExportCache.invalidateFile(this, sourcePath); },

    queueDependencyRefresh(sourcePath, previousSignature) { return LgdExportCache.queueDependencyRefresh(this, sourcePath, previousSignature); },

    invalidateDependentExports(sourcePath) { return LgdExportCache.invalidateDependentExports(this, sourcePath); },

    refreshDependents(sourcePath, previousSignature) { return LgdExportCache.refreshDependents(this, sourcePath, previousSignature); },

    readExportDeclaration(sourcePath, visited = new Set()) { return LgdExportCache.readExportDeclaration(this, sourcePath, visited); },

    /**
     * @description Builds the cross-file type map for a document's relative requires.
     * @param {TextDocument} document the LGD document.
     * @param {Set} visited the source paths already being resolved.
     * @returns {Map} require specs to exported types, members and known constructor signatures.
     */
    async collectExternalTypes(document, visited = new Set())
    {
        const externals = new Map();
        externals.sourceContext = await LgdProjectIdentity.resolve({ sourcePath: document.uri.fsPath });
        const dependencies = new Set();
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
                if(sourcePath)
                {
                    dependencies.add(sourcePath);
                }

                const exported = sourcePath ? await this.readExportDeclaration(sourcePath, resolving) : null;
                if(exported)
                {
                    const entry = { exportName: exported.name, keyword: exported.keyword };
                    if(exported.keyword === 'Object')
                    {
                        entry.accessibility = exported.accessibility;
                        entry.explicitAccessibility = exported.explicitAccessibility;
                        entry.projectId = exported.projectId;
                        entry.ancestry = exported.ancestry;
                        entry.typeTable = exported.typeTable;
                        entry.constructorAccessibility = exported.constructorAccessibility;
                        entry.sourcePath = exported.sourcePath;
                        entry.sourceText = exported.sourceText;
                        entry.kind = exported.kind;
                        entry.enumValueType = exported.enumValueType;
                        entry.baseName = exported.baseName;
                        entry.members = exported.members;
                        entry.constructorParams = exported.constructorParams;
                        entry.constructorSignatures = exported.constructorSignatures;
                        entry.methodSignatures = exported.methodSignatures;
                        entry.methodsKnown = exported.methodsKnown;
                        Object.assign(entry, getContractMetadata(exported));
                    }

                    externals.set(spec, entry);
                }
            }

            match = pattern.exec(text);
        }

        this.replaceDependencies(document.uri.fsPath, dependencies);
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

    getTypeSummary(uri, name) { return getTypeSummary(this, uri, name); },

    /** @description Collects the source and resolved imports used to describe inherited members. */
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
        if(declaration.kind === 'interface')
        {
            return getInterfaceMembers(declaration, context);
        }

        if(visited.has(declaration))
        {
            return [];
        }

        const resolving = new Set(visited);
        resolving.add(declaration);
        const members = getRuntimeMembers(declaration, context, candidate => this.getObjectMembers(candidate));
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
            const typeName = baseTypeName(declaration.typeName);
            const nominal = context.declarations.find(candidate => candidate.name === typeName && (candidate.kind === 'class' || candidate.kind === 'interface'));
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

        return filterDeclaredMembers(members, declaration, required);
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

        const members = this.getDeclaredMembers(declaration, this.getMemberContext(state));
        return filterThisMembers(members, declaration, document.offsetAt(position));
    },

    /**
     * @description Lists the own members of an object or class declaration, including
     * properties assigned to the instance by its constructor or create() method.
     * @param {Object} declaration the object literal declaration.
     * @returns {Array} the deduplicated {name, kind} members.
     */
    getObjectMembers(declaration)
    {
        const members = getTypedMembers(declaration);

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
            return member.name === name && [ 'property', 'field' ].includes(member.kind) && !member.static && hasDetail;
        });

        return found || null;
    },

    /**
     * @description Finds the detail for one base-class member at a `base.` access: the
     * member declared on the enclosing class's base, resolved locally or through imports.
     * @param {TextDocument} document the LGD document.
     * @param {Position} position the cursor position inside the member access.
     * @param {string} name the accessed member name.
     * @returns {Object|null} the {name, kind, typeName} member, or null.
     */
    getBaseMemberDetail(document, position, name)
    {
        const state = this.getState(document.uri);
        if(!state || !state.declarations)
        {
            return null;
        }

        const declaration = this.findEnclosingObjectDeclaration(state.declarations, document.offsetAt(position));
        if(!declaration || declaration.kind !== 'class' || !declaration.baseName)
        {
            return null;
        }

        const context = this.getMemberContext(state);
        const localBase = context.declarations.find(candidate => candidate.name === declaration.baseName);
        const members = localBase
            ? this.getDeclaredMembers(localBase, context)
            : this.findImportedType(declaration.baseName, context)?.members || [];

        return members.find(member => member.name === name) || null;
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

        const members = new Map();
        for(const constructor of declaration.constructorMembers || [])
        {
            const body = declaration.initializerText.slice(
                constructor.bodyStart + 1 - declaration.initializerStart,
                constructor.bodyEnd - 1 - declaration.initializerStart
            );
            for(const member of this.extractAssignedMembers(body, false, constructor.params))
            {
                const previous = members.get(member.name);
                if(previous && previous.typeName !== member.typeName)
                {
                    member.typeName = null;
                }

                members.set(member.name, previous ? { ...previous, ...member } : member);
            }
        }

        return [...members.values()];
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
                    typeName: this.findAssignmentTypeName(body, match.index) || parameter?.typeName || this.inferAssignedBooleanType(code, valueIndex),
                    properties: this.findAssignedLiteralProperties(body, match.index + match[0].length)
                });
            }

            match = pattern.exec(code);
        }

        return members;
    },

    /**
     * @description Infers a Boolean only when the complete assignment value is a boolean literal.
     * @param {string} code the masked constructor body.
     * @param {number} valueIndex the index just after the assignment operator.
     * @returns {string|null} Boolean for a true or false literal, otherwise null.
     */
    inferAssignedBooleanType(code, valueIndex)
    {
        return (/^\s*(?:true|false)\s*(?:;|$)/).test(code.slice(valueIndex)) ? 'Boolean' : null;
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
