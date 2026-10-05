const LgdConstructorSignatures = require('../Compilers/LgdConstructorSignatures');
const { getContractMetadata } = require('./LgdContractEditor');
const LgdModuleBindings = require('../Compilers/LgdModuleBindings');
const { collectContractBindings } = require('../Compilers/LgdContractBindings');
const { visibleBindings } = require('../Compilers/LgdBaseChecker');
const fs = require('fs');
const vscode = require('vscode');
const LgdOutputOptions = require('../Compilers/LgdOutputOptions');
const LgdProjectIdentity = require('../Compilers/LgdProjectIdentity');
const LgdAccessibility = require('../Compilers/LgdAccessibility');
const LgdMemberTypeGraph = require('../Compilers/LgdMemberTypeGraph');
const LgdClassMemberSemantics = require('../Compilers/LgdClassMemberSemantics');
const { baseTypeName } = require('../Compilers/LgdTypeMaps');
const { getConstructorParams } = require('../Compilers/LgdBaseChecker');
const LgdOverrideChecker = require('../Compilers/LgdOverrideChecker');
const LgdContractChecker = require('../Compilers/LgdContractChecker');

/** @description Copies established source-backed export metadata for compiler and editor consumers. */
function describeExternalType(exported)
{
    const entry = { exportName: exported.name, keyword: exported.keyword };
    if(exported.keyword === 'Object')
    {
        entry.accessibility = exported.accessibility;
        entry.explicitAccessibility = exported.explicitAccessibility;
        entry.projectId = exported.projectId;
        entry.ancestry = exported.ancestry;
        entry.typeTable = exported.typeTable;
        entry.typeGraphIncomplete = exported.typeGraphIncomplete;
        entry.constructorAccessibility = exported.constructorAccessibility;
        entry.sourcePath = exported.sourcePath;
        entry.sourceText = exported.sourceText;
        entry.jsdoc = exported.jsdoc;
        entry.kind = exported.kind;
        entry.constructionKind = exported.constructionKind;
        entry.moduleKind = exported.moduleKind;
        entry.commonJsProperty = exported.commonJsProperty;
        entry.enumValueType = exported.enumValueType;
        entry.baseName = exported.baseName;
        entry.members = exported.members;
        entry.constructorParams = exported.constructorParams;
        entry.constructorSignatures = exported.constructorSignatures;
        entry.methodSignatures = exported.methodSignatures;
        entry.methodsKnown = exported.methodsKnown;
        Object.assign(entry, getContractMetadata(exported));
    }

    return entry;
}

/** @description Loads an unchanged source from cache, reading only changed on-disk files. */
async function readSourceEntry(service, sourcePath)
{
    const identity = await LgdProjectIdentity.resolve({ sourcePath: sourcePath });
    const sourceDocument = service.openStatesByPath.get(sourcePath)?.document || { uri: vscode.Uri.file(sourcePath) };
    const constructionKind = LgdOutputOptions.constructionKind(service.getOutputOptions(sourceDocument));
    let cached = service.exportCache.get(sourcePath);
    if(cached && (cached.projectId !== identity.projectId || cached.constructionKind !== constructionKind))
    {
        service.exportCache.delete(sourcePath);
        cached = null;
    }

    const sourceVersion = service.sourceVersions.get(sourcePath);
    const openState = service.openStatesByPath.get(sourcePath);
    let sourceText;
    let diskStamp;
    try
    {
        if(openState)
        {
            sourceText = openState.document.getText();
        }
        else
        {
            const stats = await fs.promises.stat(sourcePath);
            if(service.sourceVersions.get(sourcePath) !== sourceVersion || service.openStatesByPath.get(sourcePath) !== openState)
            {
                return service.readSourceEntry(sourcePath);
            }

            diskStamp = `${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}`;
            if(cached?.diskStamp === diskStamp)
            {
                return cached;
            }

            sourceText = await fs.promises.readFile(sourcePath, 'utf8');
        }
    }
    catch
    {
        if(service.sourceVersions.get(sourcePath) !== sourceVersion || service.openStatesByPath.get(sourcePath) !== openState)
        {
            return service.readSourceEntry(sourcePath);
        }

        service.exportCache.delete(sourcePath);
        return null;
    }

    if(service.sourceVersions.get(sourcePath) !== sourceVersion || service.openStatesByPath.get(sourcePath) !== openState)
    {
        return service.readSourceEntry(sourcePath);
    }

    if(cached?.sourceText === sourceText)
    {
        cached.diskStamp = diskStamp;
        return cached;
    }

    const entry = { sourceText: sourceText, diskStamp: diskStamp, projectId: identity.projectId, constructionKind: constructionKind,
        parsed: service.compiler.parse(sourceText, new Map(), identity) };
    service.exportCache.set(sourcePath, entry);
    return entry;
}

/** @description Replaces the reverse edges for executable relative imports, including missing files. */
function replaceDependencies(service, sourcePath, dependencies)
{
    for(const previous of service.dependencies.get(sourcePath) || [])
    {
        if(!dependencies.has(previous))
        {
            const consumers = service.dependents.get(previous);
            consumers?.delete(sourcePath);
            if(consumers?.size === 0)
            {
                service.dependents.delete(previous);
            }
        }
    }

    service.dependencies.set(sourcePath, dependencies);
    for(const dependency of dependencies)
    {
        if(!service.dependents.has(dependency))
        {
            service.dependents.set(dependency, new Set());
        }

        service.dependents.get(dependency).add(sourcePath);
    }
}

/** @description Compares externally visible types while ignoring source text and parameter offsets. */
function exportSignature(service, exported)
{
    if(!exported)
    {
        return 'null';
    }

    function parameterSignature(parameter)
    {
        return {
            name: parameter.name, typeName: parameter.typeName, rest: parameter.rest,
            defaultText: parameter.defaultText, optional: parameter.optional, known: parameter.known
        };
    }

    const constructors = exported.constructorParams?.map(parameterSignature);
    const methods = exported.methodSignatures?.map(method => ({
        ...method,
        params: method.params.map(parameterSignature)
    }));

    return JSON.stringify({
        name: exported.name, jsdoc: exported.jsdoc, typeName: exported.typeName, keyword: exported.keyword,
        accessibility: exported.accessibility, projectId: exported.projectId, ancestry: exported.ancestry,
        constructorAccessibility: exported.constructorAccessibility, typeTable: exported.typeTable,
        kind: exported.kind, constructionKind: exported.constructionKind, moduleKind: exported.moduleKind, commonJsProperty: exported.commonJsProperty,
        baseName: exported.baseName, abstract: exported.abstract,
        contractKind: exported.contractKind, interfaceNames: exported.interfaceNames,
        contractSignatures: exported.contractSignatures, contractsKnown: exported.contractsKnown,
        constructorParams: constructors, constructorSignatures: exported.constructorSignatures,
        members: exported.members?.map(member =>
        {
            const signature = { ...member };
            delete signature.nameStart;
            delete signature.nameEnd;
            delete signature.declaringSourcePath;
            return signature;
        }), methodSignatures: methods, methodsKnown: exported.methodsKnown
    });
}

/** @description Invalidates an externally changed or closed source and queues only its known dependents. */
function invalidateFile(service, sourcePath)
{
    const previousSignature = service.exportCache.get(sourcePath)?.signature;
    service.sourceVersions.set(sourcePath, (service.sourceVersions.get(sourcePath) || 0) + 1);
    if(!service.openStatesByPath.has(sourcePath))
    {
        service.exportCache.delete(sourcePath);
    }

    return service.queueDependencyRefresh(sourcePath, previousSignature);
}

/** @description Serializes dependency refreshes outside document-update chains to avoid import-cycle deadlocks. */
function queueDependencyRefresh(service, sourcePath, previousSignature)
{
    if(!service.dependents.get(sourcePath)?.size)
    {
        return service.pendingDependencyUpdates;
    }

    const previous = service.pendingDependencyUpdates;
    async function refresh()
    {
        await previous;
        await service.refreshDependents(sourcePath, previousSignature);
    }

    service.pendingDependencyUpdates = service.trackSettled(refresh());
    return service.pendingDependencyUpdates;
}

/** @description Invalidates the reachable signature tables before any consumer reads a diamond-shaped graph. */
function invalidateDependentExports(service, sourcePath)
{
    const signatures = new Map();
    const pending = [sourcePath];
    const visited = new Set(pending);
    for(const current of pending)
    {
        for(const dependent of service.dependents.get(current) || [])
        {
            if(visited.has(dependent))
            {
                continue;
            }

            visited.add(dependent);
            pending.push(dependent);
            const cached = service.exportCache.get(dependent);
            signatures.set(dependent, cached?.signature);
            if(cached)
            {
                cached.exported = undefined;
                cached.namedExports = undefined;
                cached.signatures = undefined;
            }
        }
    }

    return signatures;
}

/** @description Refreshes every explicit export signature so named imports participate in incremental invalidation. */
async function readModuleSignature(service, sourcePath)
{
    const cached = await service.readSourceEntry(sourcePath);
    if(!cached)
    {
        return 'null';
    }

    const names = new Set([ 'default', ...LgdModuleBindings.exports(cached.sourceText, cached.parsed.declarations).keys() ]);
    for(const name of names)
    {
        await service.readExportDeclaration(sourcePath, new Set(), name);
    }

    return service.exportCache.get(sourcePath)?.signature || 'null';
}

/** @description Records each selector separately while preserving a stable whole-module signature. */
function recordSignature(service, cached, exportName, exported)
{
    cached.signatures ||= new Map();
    cached.signatures.set(exportName, service.exportSignature(exported));
    cached.signature = JSON.stringify([...cached.signatures].sort(([left], [right]) => left.localeCompare(right)));
}

/** @description Rechecks open consumers and traverses descendants only when exported signatures change. */
async function refreshDependents(service, sourcePath, previousSignature)
{
    const signature = await readModuleSignature(service, sourcePath);
    if(signature === previousSignature)
    {
        return;
    }

    const previousSignatures = service.invalidateDependentExports(sourcePath);
    const queue = [sourcePath];
    const visited = new Set(queue);
    for(const current of queue)
    {
        if(current !== sourcePath)
        {
            const refreshed = await readModuleSignature(service, current);
            if(refreshed === previousSignatures.get(current))
            {
                continue;
            }
        }

        for(const dependent of [...service.dependents.get(current) || []])
        {
            if(visited.has(dependent))
            {
                continue;
            }

            visited.add(dependent);
            const state = service.openStatesByPath.get(dependent);
            if(state)
            {
                await service.updateDocument(state.document, false);
            }

            queue.push(dependent);
        }
    }
}

/**
 * @description Reads a sibling .lgd file and finds the declaration it exports.
 * Unreadable files and unsupported or absent explicit exports yield null.
 * @param {Object} service the owning language service and its incremental state.
 * @param {string} sourcePath the absolute .lgd source path.
 * @param {Set} visited the source paths already being resolved, to stop circular imports.
 * @param {string} exportName the explicit export selector, defaulting to CommonJS or ESM default.
 * @returns {Object|null} the exported type, constructor signature and source location, or null.
 */
async function readExportDeclaration(service, sourcePath, visited = new Set(), exportName = 'default')
{
    const resolving = new Set(visited);
    resolving.add(sourcePath);
    const cached = await service.readSourceEntry(sourcePath);
    if(!cached)
    {
        return null;
    }

    const previous = exportName === 'default' ? cached.exported : cached.namedExports?.get(exportName);
    if(previous !== undefined)
    {
        return previous;
    }

    const targetText = cached.sourceText;
    const parsed = cached.parsed;
    const reference = LgdModuleBindings.exports(targetText, parsed.declarations).get(exportName);
    const moduleKind = LgdModuleBindings.moduleKind(targetText, parsed.declarations);
    if(!reference)
    {
        recordSignature(service, cached, exportName, null);
        return null;
    }

    const declaration = !reference.spec && parsed.declarations.find(candidate => candidate.name === reference.name);
    if(visited.has(sourcePath) && !declaration)
    {
        return null;
    }

    if(visited.has(sourcePath))
    {
        // Preserve the nominal identity at an import back-edge. Its full member
        // record replaces this reference when that defining source completes.
        if(declaration?.kind !== 'class')
        {
            return null;
        }

        return { name: declaration.name, typeName: declaration.typeName, kind: 'class', keyword: 'Object', constructionKind: cached.constructionKind, moduleKind: moduleKind, commonJsProperty: reference.commonJsProperty,
            sourcePath: declaration.sourceIdentityPath || sourcePath, nameStart: declaration.nameStart,
            nameEnd: declaration.nameEnd, projectId: cached.projectId, members: [], methodSignatures: [],
            methodsKnown: false, contractsKnown: false, typeGraphIncomplete: true };
    }

    const document = { uri: { fsPath: sourcePath }, getText: () => targetText };
    const externals = await service.collectExternalTypes(document, resolving);
    if(service.exportCache.get(sourcePath) !== cached)
    {
        return service.readExportDeclaration(sourcePath, visited, exportName);
    }

    if(!declaration)
    {
        const imported = reference.spec
            ? LgdModuleBindings.external(externals, reference.spec, reference.name)
            : visibleBindings(collectContractBindings(targetText, parsed.allDeclarations, externals), targetText.length - 1).get(reference.name);
        const exported = imported?.sourcePath
            ? { ...imported, name: imported.name || imported.exportName, moduleKind: moduleKind, commonJsProperty: reference.commonJsProperty }
            : null;
        recordSignature(service, cached, exportName, exported);
        return exported;
    }

    const context = { declarations: parsed.allDeclarations, externals: externals, sourceText: targetText, sourcePath: declaration.sourceIdentityPath || sourcePath };
    LgdContractChecker.classify(targetText, parsed.allDeclarations, externals);
    const methods = LgdOverrideChecker.describeMethods(targetText, parsed.allDeclarations, declaration, externals);
    const contracts = LgdContractChecker.describeContracts(targetText, parsed.allDeclarations, declaration, externals);
    const keywords = [ 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'Object', 'Array', 'Function' ];
    const registry = LgdClassMemberSemantics.create({ content: targetText, declarations: parsed.allDeclarations, externals: externals });
    const exported = {
        name: declaration.name,
        jsdoc: declaration.jsdoc,
        typeName: declaration.typeName,
        keyword: keywords.includes(baseTypeName(declaration.typeName)) ? baseTypeName(declaration.typeName) : 'Object',
        kind: declaration.kind,
        constructionKind: declaration.kind === 'class' ? cached.constructionKind : null,
        moduleKind: moduleKind,
        commonJsProperty: reference.commonJsProperty,
        accessibility: declaration.accessibility || 'public',
        explicitAccessibility: declaration.accessibilityStart !== null,
        projectId: cached.projectId,
        constructorAccessibility: declaration.constructorMember?.accessibility || 'public',
        ancestry: LgdAccessibility.ancestry(declaration, registry),
        typeTable: LgdMemberTypeGraph.describe(registry),
        enumValueType: declaration.enumValueType,
        baseName: declaration.baseName,
        constructorParams: getConstructorParams(declaration),
        constructorSignatures: declaration.kind === 'class' ? LgdConstructorSignatures.describeAll(declaration) : undefined,
        methodSignatures: methods.methodSignatures,
        methodsKnown: methods.methodsKnown,
        ...contracts,
        members: service.getDeclaredMembers(declaration, context),
        sourcePath: declaration.sourceIdentityPath || sourcePath,
        sourceText: targetText,
        nameStart: declaration.nameStart,
        nameEnd: declaration.nameEnd
    };
    recordSignature(service, cached, exportName, exported);

    // Incomplete ancestry and unresolved import back-edges depend on the active
    // resolution path. Cache only once every referenced type record is complete.
    const completeTypes = !exported.typeTable.some(type => type.typeGraphIncomplete);
    if(completeTypes && (methods.methodsKnown && contracts.contractsKnown || exported.keyword !== 'Object'))
    {
        if(exportName === 'default')
        {
            cached.exported = exported;
        }
        else
        {
            cached.namedExports ||= new Map();
            cached.namedExports.set(exportName, exported);
        }
    }

    return exported;
}

/** @description Rechecks open sources after a manifest boundary changes, clearing inherited export identities first. */
async function refreshProjectIdentities(service)
{
    service.exportCache.clear();
    for(const state of [...service.states.values()])
    {
        await service.updateDocument(state.document);
    }
}

module.exports = {
    describeExternalType: describeExternalType,
    refreshProjectIdentities: refreshProjectIdentities,
    readExportDeclaration: readExportDeclaration,
    readSourceEntry: readSourceEntry,
    replaceDependencies: replaceDependencies,
    exportSignature: exportSignature,
    invalidateFile: invalidateFile,
    queueDependencyRefresh: queueDependencyRefresh,
    invalidateDependentExports: invalidateDependentExports,
    refreshDependents: refreshDependents
};
