const { maskCode } = require('./LgdInfer');
const { collectScopes, collectBindings, visibleBindings } = require('./LgdBaseChecker');
const { parseMethodHead, parseTypedParams, splitTopLevelChunks } = require('./LgdTypedParams');
const { skipTrivia } = require('./LgdMethodSignature');

/** @description Explicit built-in types whose different spellings establish a signature mismatch. */
const builtinTypes = new Set([ 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'Object', 'Array', 'Function', 'void' ]);

/**
 * @description Creates one lexical resolution context for class method contracts.
 * @param {string} content the LGD source.
 * @param {Array} declarations the parsed declarations.
 * @param {Map} externals the known relative exports.
 * @returns {Object} lexical bindings and memoized method tables.
 */
function createContext(content, declarations, externals)
{
    const masked = maskCode(content, true);
    const scopes = collectScopes(masked);
    return {
        bindings: collectBindings({ content: content, masked: masked, declarations: declarations, scopes: scopes, externals: externals }),
        tables: new Map()
    };
}

/**
 * @description Removes source offsets from parameter records used across file boundaries.
 * @param {Array} params the parsed parameter list.
 * @returns {Array} serializable signature parameters.
 */
function signatureParams(params)
{
    return (params || []).filter(parameter => parameter.name || maskCode(parameter.raw || '').trim()).map(parameter => ({
        name: parameter.name || null,
        typeName: parameter.typeName || null,
        rest: Boolean(parameter.rest),
        defaultText: parameter.defaultText ?? null,
        optional: Boolean(parameter.optional),
        known: Boolean(parameter.name)
    }));
}

/**
 * @description Converts a declared member to an exported method contract.
 * @param {Object} member the parsed member.
 * @param {Object} declaration its declaring class or object.
 * @param {Object|undefined} inherited the overridden inherited signature.
 * @returns {Object} the serializable effective signature.
 */
function methodSignature(member, declaration, inherited)
{
    const params = signatureParams(member.params);
    if(member.override && inherited && params.length === inherited.params?.length)
    {
        for(let index = 0; index < params.length; index++)
        {
            params[index].typeName ||= inherited.params[index].typeName;
        }
    }

    const returnTypeName = member.returnTypeName || member.override && inherited?.returnTypeName || null;
    return {
        name: member.name,
        kind: member.kind || 'method',
        virtual: Boolean(member.virtual || member.override && inherited?.virtual),
        override: Boolean(member.override),
        params: params,
        paramsKnown: Array.isArray(member.params),
        returnTypeName: returnTypeName,
        async: Boolean(member.async),
        generator: Boolean(member.generator),
        declaredIn: declaration.name || declaration.exportName
    };
}

/**
 * @description Resolves a class's base through its lexical bindings.
 * @param {Object} declaration the local class.
 * @param {Object} context lexical bindings and method tables.
 * @returns {Object|null} the known base declaration or export metadata.
 */
function baseDeclaration(declaration, context)
{
    const offset = declaration.headStart ?? declaration.start;
    return visibleBindings(context.bindings, offset).get(declaration.baseName) || null;
}

/**
 * @description Recognizes a virtual tag in the docblock attached to an existing OLOO method.
 * @param {string} text the object member chunk.
 * @returns {boolean} whether the nearest leading docblock declares the member virtual.
 */
function hasVirtualDocblock(text)
{
    const prefix = text.slice(0, skipTrivia(text, 0));
    const comments = [...prefix.matchAll(/\/\*\*(?<body>[\S\s]*?)\*\//g)];
    const last = comments[comments.length - 1];
    return Boolean(last && (/(?:^|\n)\s*\*?\s*@virtual(?:\s|$)/).test(last.groups.body));
}

/**
 * @description Describes explicit OLOO members without inventing virtual methods for dynamic objects.
 * @param {Object} declaration the OLOO declaration.
 * @returns {Object} known own method signatures and whether the member set is complete.
 */
function objectMethods(declaration)
{
    const initializer = (declaration.initializerText || '').trim();
    const signatures = new Map();
    let complete = initializer.startsWith('{') && initializer.endsWith('}');
    if(complete)
    {
        for(const chunk of splitTopLevelChunks(initializer))
        {
            const text = maskCode(chunk.text, true).trim();
            if(!text)
            {
                continue;
            }

            const head = parseMethodHead(chunk.text);
            if(head)
            {
                const parameters = parseTypedParams(chunk.text.slice(head.paramStart));
                const member = { ...head, kind: 'method', params: parameters?.params, virtual: hasVirtualDocblock(chunk.text) };
                if(head.modifier === 'get' || head.modifier === 'set')
                {
                    member.kind = 'property';
                }

                signatures.set(member.name, methodSignature(member, declaration));
                continue;
            }

            const property = (/^(?<name>[$A-Z_a-z][\w$]*)\s*(?::|$)/).exec(text);
            if(property && property.groups.name !== '__proto__')
            {
                const member = { name: property.groups.name, kind: 'property' };
                signatures.set(member.name, methodSignature(member, declaration));
            }
            else
            {
                complete = false;
            }
        }
    }

    signatures.delete('create');
    return { methodSignatures: [...signatures.values()], methodsKnown: complete };
}

/**
 * @description Builds effective method contracts once per declaration and stops inheritance cycles.
 * @param {Object} declaration a local declaration or external export.
 * @param {Object} context the lexical resolution context.
 * @param {Set} visiting declarations on the current inheritance path.
 * @returns {Object} effective method contracts and ancestry completeness.
 */
function methodTable(declaration, context, visiting = new Set())
{
    if(Array.isArray(declaration.methodSignatures))
    {
        return { methodSignatures: declaration.methodSignatures, methodsKnown: declaration.methodsKnown === true };
    }

    if(visiting.has(declaration))
    {
        return { methodSignatures: [], methodsKnown: false };
    }

    if(context.tables.has(declaration))
    {
        return context.tables.get(declaration);
    }

    if(declaration.kind !== 'class')
    {
        return objectMethods(declaration);
    }

    const path = new Set(visiting);
    path.add(declaration);
    let inherited = { methodSignatures: [], methodsKnown: true };
    if(declaration.baseName)
    {
        const base = baseDeclaration(declaration, context);
        inherited = base ? methodTable(base, context, path) : { methodSignatures: [], methodsKnown: false };
    }

    const methods = new Map(inherited.methodSignatures.map(member => [ member.name, member ]));
    for(const member of declaration.classMembers || [])
    {
        if(!member.isConstructor)
        {
            methods.set(member.name, methodSignature(member, declaration, methods.get(member.name)));
        }
    }

    const result = { methodSignatures: [...methods.values()], methodsKnown: inherited.methodsKnown };
    context.tables.set(declaration, result);
    return result;
}

/**
 * @description Resolves the inherited table, preserving uncertainty for unknown bases and cycles.
 * @param {Object} declaration the class declaration.
 * @param {Object} context the lexical resolution context.
 * @param {Set} visiting declarations on the current inheritance path.
 * @returns {Object} the inherited method contracts.
 */
function inheritedMethods(declaration, context, visiting)
{
    if(!declaration.baseName)
    {
        return { methodSignatures: [], methodsKnown: true };
    }

    const base = baseDeclaration(declaration, context);
    return base ? methodTable(base, context, visiting) : { methodSignatures: [], methodsKnown: false };
}

/**
 * @description Exposes a class's effective contracts for relative CommonJS exports.
 * @param {string} content the source document.
 * @param {Array} declarations the parsed declarations.
 * @param {Object} declaration the exported declaration.
 * @param {Map} externals the known relative exports.
 * @returns {Object} serializable methodSignatures and methodsKnown metadata.
 */
function describeMethods(content, declarations, declaration, externals = new Map())
{
    return methodTable(declaration, createContext(content, declarations, externals));
}

/**
 * @description Appends a method diagnostic confined to the explicit override keyword or method name.
 * @param {Array} errors the collected diagnostics.
 * @param {Object} member the source member.
 * @param {string} message the diagnostic message.
 * @returns {void}
 */
function addError(errors, member, message)
{
    const hasOverrideSpan = member.override && Number.isInteger(member.overrideStart) && Number.isInteger(member.overrideEnd);
    errors.push({
        offset: hasOverrideSpan ? member.overrideStart : member.nameStart,
        endOffset: hasOverrideSpan ? member.overrideEnd : member.nameEnd,
        message: message
    });
}

/**
 * @description Reports definite explicit type differences while leaving opaque external types unguessed.
 * @param {string|null} baseType the base annotation.
 * @param {string|null} derivedType the derived annotation.
 * @returns {boolean} whether the annotations definitely disagree.
 */
function differentKnownTypes(baseType, derivedType)
{
    return baseType !== derivedType && builtinTypes.has(baseType) && builtinTypes.has(derivedType);
}

/**
 * @description Tests whether a signature parameter must be supplied by a caller.
 * @param {Object} parameter the normalized signature parameter.
 * @returns {boolean} whether the argument is required.
 */
function isRequiredParameter(parameter)
{
    const hasDefault = parameter.defaultText !== undefined && parameter.defaultText !== null;
    return !parameter.rest && !parameter.optional && !hasDefault;
}

/**
 * @description Checks conservative arity and explicit annotation consistency for a valid override target.
 * @param {Object} member the overriding source method.
 * @param {Object} inherited the known virtual target.
 * @param {Array} errors the collected diagnostics.
 * @returns {void}
 */
function checkSignature(member, inherited, errors)
{
    const params = signatureParams(member.params);
    const baseParams = inherited.params || [];
    const paramsKnown = inherited.paramsKnown !== false;
    if(paramsKnown && params.length !== baseParams.length)
    {
        addError(errors, member, `Override '${member.name}' must keep the base method's ${baseParams.length} parameter(s); received ${params.length}.`);
        return;
    }

    if(paramsKnown && params.every(parameter => parameter.known) && baseParams.every(parameter => parameter.known !== false))
    {
        const required = params.filter(isRequiredParameter).length;
        const baseRequired = baseParams.filter(isRequiredParameter).length;
        if(required > baseRequired)
        {
            addError(errors, member, `Override '${member.name}' cannot require more arguments than its base method.`);
        }
    }

    const sharedLength = paramsKnown ? Math.min(params.length, baseParams.length) : 0;
    for(let index = 0; index < sharedLength; index++)
    {
        const parameter = params[index];
        const baseParameter = baseParams[index];
        if(parameter.known && baseParameter.known !== false && parameter.rest !== Boolean(baseParameter.rest))
        {
            addError(errors, member, `Override '${member.name}' must preserve the rest parameter at position ${index + 1}.`);
        }
        else if(differentKnownTypes(baseParameter.typeName, parameter.typeName))
        {
            addError(errors, member, `Override '${member.name}' parameter ${index + 1} must be ${baseParameter.typeName}, not ${parameter.typeName}.`);
        }
    }

    if(differentKnownTypes(inherited.returnTypeName, member.returnTypeName))
    {
        addError(errors, member, `Override '${member.name}' must return ${inherited.returnTypeName}, not ${member.returnTypeName}.`);
    }
}

/**
 * @description Checks explicit virtual/override contracts across the known lexical inheritance graph.
 * @param {string} content the source document.
 * @param {Array} declarations all parsed declarations.
 * @param {Map} externals the known relative exports and their effective method signatures.
 * @returns {Array} precise method diagnostics.
 */
function check(content, declarations, externals = new Map())
{
    const errors = [];
    const context = createContext(content, declarations, externals);
    for(const declaration of declarations)
    {
        if(declaration.kind !== 'class')
        {
            continue;
        }

        const inherited = inheritedMethods(declaration, context, new Set([declaration]));
        const methods = new Map(inherited.methodSignatures.map(member => [ member.name, member ]));
        for(const member of declaration.classMembers || [])
        {
            if(member.isConstructor)
            {
                continue;
            }

            const baseMember = methods.get(member.name);
            if(!baseMember)
            {
                if(member.override && inherited.methodsKnown)
                {
                    addError(errors, member, `Method '${member.name}' is marked override but no inherited method has that name.`);
                }

                continue;
            }

            if(!baseMember.virtual || baseMember.kind !== 'method')
            {
                addError(errors, member, `Cannot override non-virtual inherited member '${member.name}'; declare the base method virtual first.`);
            }
            else if(!member.override)
            {
                addError(errors, member, `Method '${member.name}' overrides an inherited virtual method and requires the override keyword.`);
            }
            else
            {
                checkSignature(member, baseMember, errors);
            }
        }
    }

    return errors;
}

module.exports = { check: check, describeMethods: describeMethods };
