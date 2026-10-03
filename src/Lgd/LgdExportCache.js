const fs = require('fs');
const { maskCode } = require('../Compilers/LgdInfer');
const { baseTypeName } = require('../Compilers/LgdTypeMaps');
const { getConstructorParams } = require('../Compilers/LgdBaseChecker');
const LgdOverrideChecker = require('../Compilers/LgdOverrideChecker');
const LgdContractChecker = require('../Compilers/LgdContractChecker');

/** @description Loads an unchanged source from cache, reading only changed on-disk files. */
async function readSourceEntry(service, sourcePath)
{
    const cached = service.exportCache.get(sourcePath);
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

    const entry = { sourceText: sourceText, diskStamp: diskStamp, parsed: service.compiler.parse(sourceText) };
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
        name: exported.name, typeName: exported.typeName, keyword: exported.keyword,
        kind: exported.kind, baseName: exported.baseName, abstract: exported.abstract,
        contractKind: exported.contractKind, interfaceNames: exported.interfaceNames,
        contractSignatures: exported.contractSignatures, contractsKnown: exported.contractsKnown,
        constructorParams: constructors,
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
            }
        }
    }

    return signatures;
}

/** @description Rechecks open consumers and traverses descendants only when exported signatures change. */
async function refreshDependents(service, sourcePath, previousSignature)
{
    const exported = await service.readExportDeclaration(sourcePath);
    if(service.exportSignature(exported) === previousSignature)
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
            const refreshed = await service.readExportDeclaration(current);
            if(service.exportSignature(refreshed) === previousSignatures.get(current))
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
 * Unreadable files and files without a plain `module.exports = Name` export yield null.
 * @param {Object} service the owning language service and its incremental state.
 * @param {string} sourcePath the absolute .lgd source path.
 * @param {Set} visited the source paths already being resolved, to stop circular imports.
 * @returns {Object|null} the exported type, constructor signature and source location, or null.
 */
async function readExportDeclaration(service, sourcePath, visited = new Set())
{
    if(visited.has(sourcePath))
    {
        return null;
    }

    const resolving = new Set(visited);
    resolving.add(sourcePath);
    const cached = await service.readSourceEntry(sourcePath);
    if(!cached)
    {
        return null;
    }

    if(cached.exported !== undefined)
    {
        return cached.exported;
    }

    const targetText = cached.sourceText;
    const exportMatch = (/\bmodule\.exports\s*=\s*(?<name>[$A-Z_a-z][\w$]*)\s*(?:;|$)/).exec(maskCode(targetText, true));
    if(!exportMatch)
    {
        cached.exported = null;
        cached.signature = 'null';
        return null;
    }

    const parsed = cached.parsed;
    const declaration = parsed.declarations.find(candidate => candidate.name === exportMatch.groups.name);
    if(!declaration)
    {
        return null;
    }

    const document = { uri: { fsPath: sourcePath }, getText: () => targetText };
    const hasHeritage = declaration.baseName || declaration.heritage?.length > 0;
    const externals = hasHeritage ? await service.collectExternalTypes(document, resolving) : new Map();
    if(service.exportCache.get(sourcePath) !== cached)
    {
        return service.readExportDeclaration(sourcePath, visited);
    }

    const context = { declarations: parsed.allDeclarations, externals: externals, sourceText: targetText, sourcePath: sourcePath };
    LgdContractChecker.classify(targetText, parsed.allDeclarations, externals);
    const methods = LgdOverrideChecker.describeMethods(targetText, parsed.allDeclarations, declaration, externals);
    const contracts = LgdContractChecker.describeContracts(targetText, parsed.allDeclarations, declaration, externals);
    const keywords = [ 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'Object', 'Array', 'Function' ];
    const exported = {
        name: declaration.name,
        typeName: declaration.typeName,
        keyword: keywords.includes(baseTypeName(declaration.typeName)) ? baseTypeName(declaration.typeName) : 'Object',
        kind: declaration.kind,
        enumValueType: declaration.enumValueType,
        baseName: declaration.baseName,
        constructorParams: getConstructorParams(declaration),
        methodSignatures: methods.methodSignatures,
        methodsKnown: methods.methodsKnown,
        ...contracts,
        members: service.getDeclaredMembers(declaration, context),
        sourcePath: sourcePath,
        sourceText: targetText,
        nameStart: declaration.nameStart,
        nameEnd: declaration.nameEnd
    };
    cached.signature = service.exportSignature(exported);

    // An incomplete/cyclic ancestry depends on the active resolution path, so only cache its parse.
    if(methods.methodsKnown && contracts.contractsKnown || exported.keyword !== 'Object')
    {
        cached.exported = exported;
    }

    return exported;
}

module.exports = {
    readExportDeclaration: readExportDeclaration,
    readSourceEntry: readSourceEntry,
    replaceDependencies: replaceDependencies,
    exportSignature: exportSignature,
    invalidateFile: invalidateFile,
    queueDependencyRefresh: queueDependencyRefresh,
    invalidateDependentExports: invalidateDependentExports,
    refreshDependents: refreshDependents
};
