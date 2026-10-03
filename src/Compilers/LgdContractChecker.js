const { baseTypeName, isNullableType } = require('./LgdTypeMaps');
const { maskCode } = require('./LgdInfer');
const { visibleBindings } = require('./LgdBaseChecker');
const { collectContractBindings } = require('./LgdContractBindings');
const { describeMethods } = require('./LgdOverrideChecker');

/** @description Explicit built-in annotation identities. */
const builtinTypes = new Set([ 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'Object', 'Array', 'Function', 'void' ]);

/** @description Creates lexical bindings and a memoized contract graph. */
function createContext(content, declarations, externals)
{
    const masked = maskCode(content, true);
    const bindings = collectContractBindings(content, declarations, externals);
    return {
        content: content,
        masked: masked,
        declarations: declarations,
        externals: externals,
        bindings: bindings,
        tables: new Map(),
        externalSignatures: new Set()
    };
}

/** @description Recognizes local declarations and serialized interface exports. */
function contractKind(declaration)
{
    return declaration?.contractKind || declaration?.kind || null;
}

/** @description Resolves one name at its declaring lexical scope. */
function resolveName(context, declaration, name)
{
    return visibleBindings(context.bindings, declaration.headStart ?? declaration.start ?? 0).get(name) || null;
}

/** @description Reports a contract diagnostic on a source name or explicit span. */
function addError(errors, target, message, code)
{
    errors.push({
        offset: target.nameStart ?? target.start ?? target.headStart,
        endOffset: target.nameEnd ?? target.end,
        message: message,
        code: `lgd.contract.${code}`
    });
}

/**
 * @description Classifies colon-list heritage before existing base and override validation.
 * @param {string} content the LGD document.
 * @param {Array} declarations all parsed declarations.
 * @param {Map} externals relative export metadata.
 * @returns {Array} inheritance diagnostics.
 */
function classify(content, declarations, externals = new Map())
{
    const context = createContext(content, declarations, externals);
    const errors = [];
    for(const declaration of declarations)
    {
        if(declaration.kind !== 'class' && declaration.kind !== 'interface')
        {
            continue;
        }

        const heritage = declaration.heritage || (declaration.baseName ? [{ name: declaration.baseName, start: declaration.baseStart, end: declaration.baseEnd }] : []);
        declaration.interfaceHeritage = [];
        declaration.interfaceNames = [];
        declaration.baseName = null;
        declaration.baseStart = null;
        declaration.baseEnd = null;
        const seenNames = new Set();
        const seenTargets = new Set();
        for(const entry of heritage)
        {
            const target = resolveName(context, declaration, entry.name);
            if(seenNames.has(entry.name) || target && seenTargets.has(target))
            {
                addError(errors, entry, `Duplicate inherited type '${entry.name}'.`, 'duplicateHeritage');
                continue;
            }

            seenNames.add(entry.name);
            if(target)
            {
                seenTargets.add(target);
            }

            if(!target)
            {
                if(declaration.kind === 'class' && !declaration.baseName && declaration.interfaceHeritage.length === 0)
                {
                    declaration.baseName = entry.name;
                    declaration.baseStart = entry.start;
                    declaration.baseEnd = entry.end;
                }
                else
                {
                    addError(errors, entry, `Unknown inherited type '${entry.name}'.`, 'unknownHeritage');
                }

                continue;
            }

            if(contractKind(target) === 'interface')
            {
                declaration.interfaceHeritage.push(entry);
                declaration.interfaceNames.push(entry.name);
            }
            else if(declaration.kind === 'interface')
            {
                addError(errors, entry, `Interface '${declaration.name}' can inherit only interfaces; '${entry.name}' is not an interface.`, 'invalidHeritage');
            }
            else if(declaration.baseName || declaration.interfaceHeritage.length > 0)
            {
                addError(errors, entry, 'A class can have one base class or OLOO object, before its interfaces.', 'invalidHeritage');
            }
            else
            {
                declaration.baseName = entry.name;
                declaration.baseStart = entry.start;
                declaration.baseEnd = entry.end;
            }
        }
    }

    return errors;
}

/** @description Normalizes signature parameters without serializing source offsets. */
function signatureParams(params)
{
    return (params || []).filter(parameter => parameter.name || maskCode(parameter.raw || '').trim()).map(parameter => ({
        name: parameter.name || null,
        typeName: parameter.typeName || null,
        rest: Boolean(parameter.rest),
        optional: Boolean(parameter.optional),
        defaultText: parameter.defaultText ?? null,
        known: Boolean(parameter.name)
    }));
}

/** @description Serializes one method or property obligation. */
function memberContract(member, declaration)
{
    return {
        name: member.name,
        kind: member.kind || 'method',
        params: signatureParams(member.params),
        paramsKnown: Array.isArray(member.params),
        returnTypeName: member.returnTypeName || null,
        propertyTypeName: member.propertyTypeName || null,
        getter: Boolean(member.getter),
        setter: Boolean(member.setter),
        abstract: true,
        async: Boolean(member.async),
        generator: Boolean(member.generator),
        declaredIn: declaration.name || declaration.exportName,
        originKind: declaration.kind
    };
}

/** @description Resolves immediate contract ancestors, keeping absent evidence explicit. */
function ancestors(declaration, context)
{
    const entries = [...declaration.interfaceHeritage || []];
    if(declaration.baseName)
    {
        entries.unshift({ name: declaration.baseName });
    }

    return entries.map(entry => ({ entry: entry, declaration: resolveName(context, declaration, entry.name) }));
}

/** @description Requires complete own contract syntax and lexically bound annotation names. */
function ownContractsKnown(declaration, context)
{
    const contractDeclaration = declaration.kind === 'interface' || declaration.abstract;
    if(contractDeclaration && declaration.contractSyntaxComplete === false)
    {
        return false;
    }

    const visible = visibleBindings(context.bindings, declaration.headStart ?? declaration.start);
    if(declaration.kind === 'interface' && (declaration.heritage || []).some(entry => contractKind(visible.get(entry.name)) !== 'interface'))
    {
        return false;
    }

    for(const member of declaration.classMembers || [])
    {
        if(declaration.kind !== 'interface' && !member.abstract)
        {
            continue;
        }

        const annotations = [ member.returnTypeName, member.propertyTypeName, ...member.params.map(parameter => parameter.typeName) ];
        if(annotations.some(typeName => typeName && !builtinTypes.has(baseTypeName(typeName)) && !visible.has(baseTypeName(typeName).split('.')[0])))
        {
            return false;
        }
    }

    return true;
}

/** @description Collects transitive interface and abstract obligations while stopping cycles. */
function contractTable(declaration, context, visiting = new Set())
{
    if(Array.isArray(declaration.contractSignatures))
    {
        if(!context.declarations.includes(declaration))
        {
            for(const signature of declaration.contractSignatures)
            {
                context.externalSignatures.add(signature);
            }
        }

        return { contractSignatures: declaration.contractSignatures, contractsKnown: declaration.contractsKnown === true, cycle: false };
    }

    if(visiting.has(declaration))
    {
        return { contractSignatures: [], contractsKnown: false, cycle: true };
    }

    if(context.tables.has(declaration))
    {
        return context.tables.get(declaration);
    }

    const local = context.declarations.includes(declaration);
    if(!local)
    {
        return { contractSignatures: [], contractsKnown: contractKind(declaration) !== 'interface' && !declaration.abstract, cycle: false };
    }

    const path = new Set(visiting);
    path.add(declaration);
    let contracts = [];
    let known = ownContractsKnown(declaration, context);
    let cycle = false;
    for(const ancestor of ancestors(declaration, context))
    {
        if(!ancestor.declaration)
        {
            continue;
        }

        const inherited = contractTable(ancestor.declaration, context, path);
        contracts.push(...inherited.contractSignatures);
        known &&= inherited.contractsKnown;
        cycle ||= inherited.cycle;
    }

    for(const member of declaration.classMembers || [])
    {
        if(!member.isConstructor && (declaration.kind === 'interface' || member.abstract))
        {
            if(declaration.kind === 'class')
            {
                contracts = contracts.filter(contract => contract.name !== member.name || contract.originKind !== 'class');
            }

            contracts.push(memberContract(member, declaration));
        }
    }

    const result = { contractSignatures: contracts, contractsKnown: known, cycle: cycle };
    context.tables.set(declaration, result);
    return result;
}

/** @description Coalesces compatible inherited interface accessor requirements for serialized metadata. */
function interfaceSignatures(signatures)
{
    const effective = [];
    for(const signature of signatures)
    {
        const previous = effective.find(member => member.name === signature.name && member.kind === 'property' && member.propertyTypeName === signature.propertyTypeName);
        if(signature.kind === 'property' && previous)
        {
            previous.getter ||= signature.getter;
            previous.setter ||= signature.setter;
        }
        else
        {
            effective.push({ ...signature });
        }
    }

    return effective;
}

/**
 * @description Describes effective obligations for relative CommonJS exports.
 * @param {string} content the LGD document.
 * @param {Array} declarations all parsed declarations.
 * @param {Object} declaration the exported declaration.
 * @param {Map} externals relative export metadata.
 * @returns {Object} serializable declaration identity and effective contract metadata.
 */
function describeContracts(content, declarations, declaration, externals = new Map())
{
    const table = contractTable(declaration, createContext(content, declarations, externals));
    return {
        contractKind: declaration.kind === 'interface' || declaration.kind === 'class' ? declaration.kind : null,
        abstract: Boolean(declaration.abstract || declaration.kind === 'interface'),
        interfaceNames: [...declaration.interfaceNames || []],
        contractSignatures: declaration.kind === 'interface' ? interfaceSignatures(table.contractSignatures) : table.contractSignatures,
        contractsKnown: table.contractsKnown
    };
}

/** @description Resolves local named types without guessing the identity of opaque external names. */
function typeIdentity(typeName, signature, declaration, context)
{
    if(!typeName)
    {
        return null;
    }

    typeName = baseTypeName(typeName);
    if(builtinTypes.has(typeName))
    {
        return typeName;
    }

    if(typeName.includes('.') || context.externalSignatures.has(signature))
    {
        return null;
    }

    const owner = context.declarations.find(candidate => candidate.name === signature.declaredIn) || declaration;
    const target = resolveName(context, owner, typeName);
    return target && context.declarations.includes(target) ? target : null;
}

/** @description Compares established builtin or local nominal identities. */
function differentTypes(expected, actual, evidence)
{
    const { contract, implementation, declaration, context } = evidence;
    if(!expected || !actual || expected === actual)
    {
        return false;
    }

    if(isNullableType(expected) !== isNullableType(actual))
    {
        return true;
    }

    const expectedIdentity = typeIdentity(expected, contract, declaration, context);
    const actualIdentity = typeIdentity(actual, implementation, declaration, context);
    return Boolean(expectedIdentity && actualIdentity && expectedIdentity !== actualIdentity);
}

/**
 * @description Exposes inherited abstract return contracts separately from physical source annotations.
 * @param {string} content the LGD document.
 * @param {Array} declarations all parsed declarations after heritage classification.
 * @param {Map} externals relative exports with effective contract signatures.
 * @returns {Array} semantic body signatures with real method and parameter source ranges.
 */
function bodySignatures(content, declarations, externals = new Map())
{
    const context = createContext(content, declarations, externals);
    const signatures = [];
    for(const declaration of declarations)
    {
        declaration.inheritedMethodContracts = [];
        if(declaration.kind !== 'class')
        {
            continue;
        }

        const contracts = contractTable(declaration, context).contractSignatures.filter(contract => contract.originKind === 'class');
        if(contracts.length === 0)
        {
            continue;
        }

        const effective = describeMethods(content, declarations, declaration, externals);
        const methods = new Map(effective.methodSignatures.map(member => [ member.name, member ]));
        for(const member of declaration.classMembers || [])
        {
            if(member.abstract || member.isConstructor || !member.override || member.returnTypeName || member.accessorKind === 'set')
            {
                continue;
            }

            const required = contracts.find(contract => contract.name === member.name && contract.kind === member.kind);
            const implemented = methods.get(member.name);
            const returnTypeName = member.accessorKind === 'get' ? required?.propertyTypeName : required?.returnTypeName;
            if(!returnTypeName || !implemented)
            {
                continue;
            }

            const base = declaration.initializerStart;
            const params = member.params.map((parameter, index) =>
            {
                const typeName = parameter.typeName || implemented.params[index]?.typeName || required.params[index]?.typeName || null;
                const inheritedType = parameter.typeStart === -1 && typeName;
                const opaqueType = Boolean(inheritedType && !builtinTypes.has(baseTypeName(typeName)) && !typeIdentity(typeName, required, declaration, context));
                return { ...parameter, typeName: typeName, opaqueType: opaqueType };
            });

            const group = {
                name: member.name,
                methodStart: member.start - base,
                start: member.paramStart - base,
                end: member.paramEnd - base,
                bodyStart: member.bodyStart - base,
                bodyEnd: member.bodyEnd - base,
                params: params,
                hasTypes: false,
                returnTypeName: returnTypeName,
                returnTypeStart: -1,
                returnTypeEnd: -1,
                async: member.async,
                generator: member.generator,
                accessor: member.accessor,
                inherited: true,
                opaqueReturn: !builtinTypes.has(baseTypeName(returnTypeName)) && !typeIdentity(returnTypeName, required, declaration, context),
                reportStart: member.nameStart,
                reportEnd: member.nameEnd
            };
            declaration.inheritedMethodContracts.push(group);
            signatures.push({ declaration: declaration, group: group });
        }
    }

    return signatures;
}

/** @description Recognizes required signature arguments. */
function requiredParameter(parameter)
{
    return !parameter.rest && !parameter.optional && (parameter.defaultText === undefined || parameter.defaultText === null);
}

/** @description Checks method and accessor evidence against one required signature. */
function signatureMismatch(contract, implementation, declaration, context)
{
    const evidence = { contract: contract, implementation: implementation, declaration: declaration, context: context };
    if(contract.originKind === 'interface')
    {
        const getter = contract.getter && (implementation.getterAccessibility || implementation.accessibility || 'public') !== 'public';
        const setter = contract.setter && (implementation.setterAccessibility || implementation.accessibility || 'public') !== 'public';
        const method = contract.kind === 'method' && (implementation.accessibility || 'public') !== 'public';
        if(getter || setter || method)
        {
            return 'must be public';
        }
    }

    if(contract.kind !== implementation.kind)
    {
        return `must be a ${contract.kind}`;
    }

    if(contract.kind === 'property')
    {
        if(contract.getter && !implementation.getter || contract.setter && !implementation.setter)
        {
            return 'must provide the required property accessors';
        }

        if(contract.propertyTypeName && !implementation.propertyTypeName)
        {
            return `must declare property type ${contract.propertyTypeName}`;
        }

        if(differentTypes(contract.propertyTypeName, implementation.propertyTypeName, evidence))
        {
            return `must have property type ${contract.propertyTypeName}, not ${implementation.propertyTypeName}`;
        }

        if(implementation.propertyTypes?.some(typeName => !typeName))
        {
            return `must declare property type ${contract.propertyTypeName} on both accessors`;
        }

        if(implementation.propertyTypes?.some(typeName => differentTypes(contract.propertyTypeName, typeName, evidence)))
        {
            return `must use property type ${contract.propertyTypeName} for both accessors`;
        }

        return null;
    }

    if(!contract.paramsKnown || !implementation.paramsKnown || contract.params.some(parameter => !parameter.known) || implementation.params.some(parameter => !parameter.known))
    {
        return 'has unsupported or unavailable parameter signature evidence';
    }

    if(contract.params.length !== implementation.params.length)
    {
        return `must have ${contract.params.length} parameter(s), not ${implementation.params.length}`;
    }

    for(let index = 0; index < contract.params.length; index++)
    {
        const expected = contract.params[index];
        const actual = implementation.params[index];
        if(expected.rest !== actual.rest)
        {
            return `must preserve the rest parameter at position ${index + 1}`;
        }

        if(!requiredParameter(expected) && requiredParameter(actual))
        {
            return `cannot require optional parameter ${index + 1}`;
        }

        if(expected.typeName && !actual.typeName)
        {
            return `must declare parameter ${index + 1} as ${expected.typeName}`;
        }

        if(differentTypes(expected.typeName, actual.typeName, evidence))
        {
            return `parameter ${index + 1} must be ${expected.typeName}, not ${actual.typeName}`;
        }
    }

    if(contract.returnTypeName && !implementation.returnTypeName)
    {
        return `must declare return type ${contract.returnTypeName}`;
    }

    if(differentTypes(contract.returnTypeName, implementation.returnTypeName, evidence))
    {
        return `must return ${contract.returnTypeName}, not ${implementation.returnTypeName}`;
    }

    if(contract.async !== implementation.async || contract.generator !== implementation.generator)
    {
        return 'must preserve async and generator modifiers';
    }

    return null;
}

/** @description Rejects incompatible inherited interface declarations before a class implements them. */
function checkInterfaceConflicts(declaration, table, context, errors)
{
    const members = new Map();
    for(const contract of table.contractSignatures)
    {
        const previous = members.get(contract.name);
        if(previous)
        {
            const evidence = { contract: previous, implementation: contract, declaration: declaration, context: context };
            const differentArity = previous.params.length !== contract.params.length;
            const differentParameters = previous.params.some((parameter, index) =>
            {
                const actual = contract.params[index];
                const differentRest = parameter.rest !== actual?.rest;
                const differentType = differentTypes(parameter.typeName, actual?.typeName, evidence);
                return differentRest || differentType;
            });

            const differentReturn = differentTypes(previous.returnTypeName, contract.returnTypeName, evidence);
            const differentProperty = differentTypes(previous.propertyTypeName, contract.propertyTypeName, evidence);
            const incompatible = previous.kind !== contract.kind || differentArity || differentParameters || differentReturn || differentProperty;
            if(incompatible)
            {
                const target = declaration.classMembers?.find(member => member.name === contract.name) || declaration;
                addError(errors, target, `Interface '${declaration.name}' inherits incompatible declarations of '${contract.name}'.`, 'conflictingMembers');
            }
        }
        else
        {
            members.set(contract.name, contract);
        }
    }
}

/** @description Allows compile-only interface identifiers in declarations, type annotations and CommonJS exports. */
function interfaceTypePosition(context, offset, name)
{
    for(const declaration of context.declarations)
    {
        if(declaration.kind === 'interface' && declaration.start <= offset && offset < declaration.end)
        {
            return true;
        }

        const spans = [ { start: declaration.typeStart, end: declaration.typeEnd },
            { start: declaration.nameStart, end: declaration.nameEnd },
            ...declaration.heritage || [] ];
        for(const member of declaration.classMembers || [])
        {
            spans.push({ start: member.nameStart, end: member.nameEnd });
            spans.push({ start: declaration.initializerStart + member.returnTypeStart, end: declaration.initializerStart + member.returnTypeEnd });
            spans.push({ start: declaration.initializerStart + member.propertyTypeStart, end: declaration.initializerStart + member.propertyTypeEnd });
        }

        for(const group of [ ...declaration.methodTypedParams || [], ...declaration.typedParams ? [declaration.typedParams] : [] ])
        {
            for(const parameter of group.params || [])
            {
                spans.push({ start: declaration.initializerStart + parameter.typeStart, end: declaration.initializerStart + parameter.typeEnd });
            }
        }

        if(spans.some(span => span.start <= offset && offset < span.end))
        {
            return true;
        }
    }

    const before = context.masked.slice(0, offset);
    const after = context.masked.slice(offset + name.length);
    const exported = (/\bmodule\s*\.\s*exports\s*=\s*$/).test(before);
    const imported = (/\b(?:const|let|var)\s*$/).test(before) && (/^\s*=\s*require\s*\(/).test(after);
    return exported || imported;
}

/** @description Rejects runtime reads of erased interface names while ignoring member keys and lexical shadows. */
function checkInterfaceValues(context, errors)
{
    const names = /(?<![\w$.])(?<name>[$A-Z_a-z][\w$]*)\b/g;
    for(const match of context.masked.matchAll(names))
    {
        const name = match.groups.name;
        const target = visibleBindings(context.bindings, match.index).get(name);
        if(contractKind(target) !== 'interface' || interfaceTypePosition(context, match.index, name))
        {
            continue;
        }

        const after = context.masked.slice(match.index + name.length);
        if((/^\s*:/).test(after) || errors.some(error => error.offset === match.index && error.code === 'lgd.contract.instantiation'))
        {
            continue;
        }

        addError(errors, { start: match.index, end: match.index + name.length }, `Interface '${name}' is compile-time only and cannot be used as a runtime value.`, 'runtimeInterface');
    }
}

/** @description Finds instantiation calls while honoring lexical shadowing and masked comments. */
function checkInstantiation(context, errors)
{
    const pattern = /\bnew\s+(?<constructed>[$A-Z_a-z][\w$]*)\b|(?<![\w$.])(?<factory>[$A-Z_a-z][\w$]*)\s*\.\s*create\s*\(/g;
    for(const match of context.masked.matchAll(pattern))
    {
        const name = match.groups.constructed || match.groups.factory;
        const target = visibleBindings(context.bindings, match.index).get(name);
        if(target && (contractKind(target) === 'interface' || target.abstract))
        {
            const start = match.index + match[0].indexOf(name);
            addError(errors, { start: start, end: start + name.length }, `Cannot instantiate ${contractKind(target) === 'interface' ? 'interface' : 'abstract class'} '${name}'.`, 'instantiation');
        }
    }
}

/** @description Validates the declared types of erased contracts, which have no method bodies to typecheck. */
function checkContractTypes(declaration, context, errors)
{
    const visible = visibleBindings(context.bindings, declaration.headStart ?? declaration.start);
    for(const member of declaration.classMembers || [])
    {
        if(!member.abstract && declaration.kind !== 'interface')
        {
            continue;
        }

        const annotations = (member.params || []).map(parameter => ({
            name: parameter.typeName,
            start: declaration.initializerStart + parameter.typeStart,
            end: declaration.initializerStart + parameter.typeEnd
        }));

        annotations.push({ name: member.returnTypeName,
            start: declaration.initializerStart + member.returnTypeStart, end: declaration.initializerStart + member.returnTypeEnd });

        annotations.push({ name: member.propertyTypeName,
            start: declaration.initializerStart + member.propertyTypeStart, end: declaration.initializerStart + member.propertyTypeEnd });
        for(const annotation of annotations)
        {
            if(annotation.name && !builtinTypes.has(baseTypeName(annotation.name)) && !visible.has(baseTypeName(annotation.name).split('.')[0]))
            {
                addError(errors, annotation, `Unknown contract type '${annotation.name}'.`, 'unknownType');
            }
        }
    }
}

/**
 * @description Validates interface implementations and inherited abstract obligations.
 * @param {string} content the LGD document.
 * @param {Array} declarations all parsed declarations after heritage classification.
 * @param {Map} externals relative exports with effective contracts.
 * @returns {Array} precise contract and instantiation diagnostics.
 */
function check(content, declarations, externals = new Map())
{
    const context = createContext(content, declarations, externals);
    const errors = [];
    for(const declaration of declarations)
    {
        if(declaration.kind !== 'class' && declaration.kind !== 'interface')
        {
            continue;
        }

        checkContractTypes(declaration, context, errors);
        const table = contractTable(declaration, context);
        if(table.cycle && declaration.kind === 'interface')
        {
            addError(errors, declaration.interfaceHeritage[0] || declaration, `Interface '${declaration.name}' has a circular interface inheritance chain.`, 'inheritanceCycle');
            continue;
        }

        if(declaration.kind === 'interface')
        {
            checkInterfaceConflicts(declaration, table, context, errors);
            continue;
        }

        if(!table.contractsKnown)
        {
            addError(errors, declaration, `Cannot validate contracts for '${declaration.name}': inherited contract metadata is unavailable or circular.`, 'unavailable');
            continue;
        }

        const methods = describeMethods(content, declarations, declaration, externals);
        const implementations = new Map(methods.methodSignatures.filter(member => !member.static).map(member => [ member.name, member ]));
        const seen = new Set();
        for(const contract of table.contractSignatures)
        {
            const implementation = implementations.get(contract.name);
            const member = declaration.classMembers?.find(candidate => candidate.name === contract.name) || declaration;
            let mismatch;
            if(!implementation || implementation.abstract && !declaration.abstract)
            {
                if(declaration.abstract)
                {
                    continue;
                }

                mismatch = `must implement ${contract.kind} '${contract.name}' required by '${contract.declaredIn}'`;
            }
            else
            {
                const details = signatureMismatch(contract, implementation, declaration, context);
                mismatch = details ? `member '${contract.name}' ${details} to satisfy '${contract.declaredIn}'` : null;
            }

            const diagnosticKey = !implementation || implementation.abstract ? contract.name : mismatch;
            if(mismatch && !seen.has(diagnosticKey))
            {
                addError(errors, member, `Class '${declaration.name}' ${mismatch}.`, !implementation || implementation.abstract ? 'missingMember' : 'signatureMismatch');
                seen.add(diagnosticKey);
            }
        }
    }

    checkInstantiation(context, errors);
    checkInterfaceValues(context, errors);
    return errors;
}

module.exports = { classify: classify, check: check, describeContracts: describeContracts, bodySignatures: bodySignatures };
