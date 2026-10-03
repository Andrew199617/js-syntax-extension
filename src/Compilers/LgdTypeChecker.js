/*
 * Type checking for LGD typed declarations.
 *
 * v1 is deliberately sound-but-partial: every inference rule is either exact for
 * JavaScript semantics or yields Unknown, and Unknown never produces an error. A
 * missed bug (false negative) is acceptable; a false alarm (false positive) is not,
 * because compiler errors now suppress the .js output write on save.
 *
 * Type names are keywords (Number), declared names used nominally
 * (GoToNextParagraph), or dotted external types (vscode.Command). A declared name
 * used as a type accepts only itself, Unknown, or Null: GoToNextParagraph x =
 * GoToLastParagraph is an error. Dotted types are opaque: they accept references,
 * calls, and reference-kind literals, but never primitive literals. Unknown type
 * names are errors, so typos like Numer are caught.
 *
 * Checked: initializer expressions against the declared type, later assignments to
 * declared variables, and assignments to readonly variables.
 *
 * Legacy declarations permit null and undefined assignments; explicit Type?
 * annotations permit null only. Unknowable values remain permissive, and Object
 * stays a top type. Assignment bindings are resolved by the emitted JavaScript
 * scope checker.
 */

const { UNKNOWN, NULL, inferExpression, maskCode } = require('./LgdInfer');
const { baseTypeName, isNullableType } = require('./LgdTypeMaps');

/** @description The eight LGD type keywords; anything else in type position is a name or dotted type. */
const typeKeywords = [ 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'Object', 'Array', 'Function' ];

/** @description Literal kinds that can plausibly be an external or self-defined object type. */
const referenceKinds = [ 'Object', 'Array', 'Function' ];

/** @description Matches a require('spec') call so cross-file externals can type it. */
const requireCallPattern = /\brequire\(\s*(?<quote>["'])(?<spec>(?:(?!\k<quote>)[^\\]|\\.)*)\k<quote>\s*\)/g;


/**
 * @description Blanks string literals, template literals, and comments while preserving offsets.
 * @param {string} text the source text to mask.
 * @returns {string} the masked text, the same length as the input.
 */

/**
 * @description Resolves a declaration's type name to a checkable type descriptor.
 * Keywords check as before; a declared name checks nominally; a dotted name is an
 * opaque external type; a self-named declaration (M M = ...) defines its own type.
 * Unknown type names are reported once here.
 * @param {Object} declaration the parsed declaration with typeName, name, and typeStart.
 * @param {Map} scope declared variable names to {keyword, readonly, kind} entries.
 * @param {Array} errors the error list to append to.
 * @returns {Object} the {kind, keyword, ref, typeName} descriptor.
 */
function resolveDeclaredType(declaration, scope, errors)
{
    const typeName = declaration.typeName;
    const baseType = baseTypeName(typeName);
    if(typeKeywords.includes(baseType))
    {
        return { kind: 'keyword', keyword: baseType, ref: null, typeName: typeName };
    }

    if(typeName.includes('.'))
    {
        const head = typeName.slice(0, typeName.indexOf('.'));
        if(!scope.has(head))
        {
            errors.push({ message: `Unknown type '${typeName}'.`, offset: declaration.typeStart });
            return { kind: 'unknown', keyword: UNKNOWN, ref: null, typeName: typeName };
        }

        return { kind: 'opaque', keyword: 'Object', ref: null, typeName: typeName };
    }

    if(baseType === declaration.name)
    {
        return { kind: 'self', keyword: null, ref: null, typeName: typeName };
    }

    const target = scope.get(baseType);
    if(!target)
    {
        errors.push({ message: `Unknown type '${typeName}'.`, offset: declaration.typeStart });
        return { kind: 'unknown', keyword: UNKNOWN, ref: null, typeName: typeName };
    }

    return { kind: 'nominal', keyword: target.keyword, ref: baseType, typeName: typeName };
}

/**
 * @description Resolves a function parameter type name against the scope, mirroring declaration resolution.
 * @param {string|null} typeName the parameter type name, or null for untyped parameters.
 * @param {Map} scope declared variable names to {keyword, readonly, kind, typeName, ref} entries.
 * @param {Array} errors the error list to append to.
 * @param {number} offset the offset of the type name for error reporting.
 * @returns {Object} the {keyword, readonly, kind, typeName, ref} parameter entry.
 */
function resolveParamType(typeName, scope, errors, offset)
{
    if(!typeName)
    {
        return { keyword: UNKNOWN, readonly: false, kind: 'keyword', typeName: UNKNOWN, ref: null };
    }

    const baseType = baseTypeName(typeName);
    if(typeKeywords.includes(baseType))
    {
        return { keyword: baseType, readonly: false, kind: 'keyword', typeName: typeName, ref: null };
    }

    if(typeName.includes('.'))
    {
        const head = typeName.slice(0, typeName.indexOf('.'));
        if(!scope.has(head))
        {
            errors.push({ message: `Unknown type '${typeName}'.`, offset: offset });
            return { keyword: UNKNOWN, readonly: false, kind: 'unknown', typeName: typeName, ref: null };
        }

        return { keyword: 'Object', readonly: false, kind: 'opaque', typeName: typeName, ref: null };
    }

    const target = scope.get(baseType);
    if(!target)
    {
        errors.push({ message: `Unknown type '${typeName}'.`, offset: offset });
        return { keyword: UNKNOWN, readonly: false, kind: 'unknown', typeName: typeName, ref: null };
    }

    return { keyword: target.keyword || 'Object', readonly: false, kind: 'nominal', typeName: typeName, ref: baseType };
}

/**
 * @description Extends a scope with the typed parameters of the functions enclosing the offset, innermost last.
 * @param {Map} baseScope the scope to extend.
 * @param {Array} typedFunctions the {bodyStart, bodyEnd, params} records of functions with typed parameters.
 * @param {number} offset the offset whose enclosing functions supply parameters.
 * @returns {Map} the scope with enclosing typed parameters shadowing outer bindings.
 */
/**
 * @description Tells whether an offset lies within a typed function's parameter scope:
 * its body or its parameter list. Object method parameter defaults sit in the
 * parameter list, before the body starts, so both ranges count as enclosing.
 * @param {Object} typedFunction the {bodyStart, bodyEnd, paramStart, paramEnd} record.
 * @param {number} offset the offset to test.
 * @returns {boolean} true when the offset is in the body or the parameter list.
 */
function functionEnclosesOffset(typedFunction, offset)
{
    const inBody = offset >= typedFunction.bodyStart && offset < typedFunction.bodyEnd;
    const inParams = offset >= typedFunction.paramStart && offset < typedFunction.paramEnd;
    return inBody || inParams;
}


/**
 * @description Tells whether an inferred type can be assigned to a resolved declared type.
 * Unknown and Null are always assignable; Object stays a top type for keywords.
 * Nominal types accept only the same nominal name; opaque and self-defined types
 * accept references and reference-kind values but never primitive literals.
 * @param {Object} resolved the {kind, keyword, ref, typeName} declared type descriptor.
 * @param {string} inferred the inferred nominal name, keyword, Null, or Unknown.
 * @param {Map} scope declared variable names to {keyword, readonly, kind} entries.
 * @param {Map} externalsByName cross-file export names to {keyword, kind} entries.
 * @returns {boolean} true when the assignment is allowed.
 */
function isAssignableTo(resolved, inferred, scope, externalsByName)
{
    if(inferred === UNKNOWN || inferred === NULL || resolved.kind === 'unknown')
    {
        return true;
    }

    if(inferred === 'undefined')
    {
        return !isNullableType(resolved.typeName);
    }

    if(isNullableType(inferred))
    {
        return isAssignableTo(resolved, baseTypeName(inferred), scope, externalsByName);
    }

    const entry = scope.get(inferred) || externalsByName.get(inferred) || null;
    if(resolved.kind === 'keyword')
    {
        if(resolved.keyword === 'Object')
        {
            return true;
        }

        return (entry ? entry.keyword : inferred) === resolved.keyword;
    }

    if(resolved.kind === 'opaque' || resolved.kind === 'self')
    {
        if(inferred === baseTypeName(resolved.typeName))
        {
            return true;
        }

        if(entry)
        {
            return entry.kind !== 'keyword' || referenceKinds.includes(entry.keyword);
        }

        return referenceKinds.includes(inferred);
    }

    if(inferred === resolved.ref)
    {
        return true;
    }

    return Boolean(entry && entry.kind === 'nominal' && entry.ref === resolved.ref);
}

/**
 * @description Computes the keyword a declaration contributes to the scope for later use.
 * @param {Object} resolved the {kind, keyword, ref, typeName} declared type descriptor.
 * @param {string} inferred the inferred nominal name, keyword, Null, or Unknown.
 * @param {Map} scope declared variable names to {keyword, readonly, kind} entries.
 * @param {Map} externalsByName cross-file export names to {keyword, kind} entries.
 * @returns {string} the keyword, or Unknown when the type name was unknown.
 */
function effectiveKeyword(resolved, inferred, scope, externalsByName)
{
    if(resolved.kind === 'keyword' || resolved.kind === 'nominal' || resolved.kind === 'opaque')
    {
        return resolved.keyword;
    }

    if(resolved.kind === 'self')
    {
        const entry = scope.get(inferred) || externalsByName.get(inferred) || null;
        if(entry)
        {
            return entry.keyword;
        }

        return referenceKinds.includes(inferred) ? inferred : 'Object';
    }

    return UNKNOWN;
}

/**
 * @description Finds require('spec') calls that resolve to a known cross-file export.
 * @param {string} content the unmasked source text; offsets map 1:1 to the masked text.
 * @param {Map} externals require specs to {exportName, keyword} entries.
 * @returns {Map} require call start offsets to {end, exportName} records.
 */
function collectRequires(content, externals)
{
    const found = new Map();
    if(externals.size === 0)
    {
        return found;
    }

    requireCallPattern.lastIndex = 0;
    let match = requireCallPattern.exec(content);
    while(match)
    {
        const info = externals.get(match.groups.spec);
        if(info && !found.has(match.index))
        {
            found.set(match.index, { end: match.index + match[0].length, exportName: info.exportName });
        }

        match = requireCallPattern.exec(content);
    }

    return found;
}

/**
 * @description Collects the local names bound to require() calls. checkTypes seeds
 * the scope with these as opaque entries, so dotted types rooted at a required
 * module (vscode.TextDocument) resolve as opaque external types even though the
 * binding itself is an untyped declaration.
 * @param {string} content the LGD source text.
 * @returns {Set<string>} the required local names.
 */
function collectRequiredNames(content)
{
    const names = new Set();
    const requireBindingPattern = (/(?:^|[\n;{}])\s*(?:const|let|var)\s+(?:{(?<destructured>[^}]*)}|(?<name>[$A-Z_a-z][\w$]*))\s*=\s*require\s*\(/g);
    let match = requireBindingPattern.exec(content);
    while(match)
    {
        if(match.groups.name)
        {
            names.add(match.groups.name);
        }
        else
        {
            for(const part of match.groups.destructured.split(','))
            {
                const alias = part.includes(':') ? part.slice(part.indexOf(':') + 1) : part;
                const trimmed = alias.trim();
                if((/^[$A-Z_a-z][\w$]*$/).test(trimmed))
                {
                    names.add(trimmed);
                }
            }
        }

        match = requireBindingPattern.exec(content);
    }

    return names;
}

/**
 * @description Records brace-delimited lexical scopes from literal-masked source.
 * @param {string} masked the source with literal and comment contents hidden.
 * @returns {Array} the scopes, including a root scope for top-level bindings.
 */
function collectLexicalScopes(masked)
{
    const root = { start: -1, end: masked.length + 1 };
    const scopes = [root];
    const stack = [root];
    for(let index = 0; index < masked.length; index++)
    {
        if(masked[index] === '{')
        {
            const scope = { start: index, end: masked.length + 1 };
            scopes.push(scope);
            stack.push(scope);
        }
        else if(masked[index] === '}' && stack.length > 1)
        {
            stack.pop().end = index;
        }
    }

    return scopes;
}

/**
 * @description Associates each declaration with its innermost lexical scope.
 * @param {Array} declarations the parsed declarations.
 * @param {string} masked the source with literal and comment contents hidden.
 * @returns {Map} declarations to their enclosing scope boundaries.
 */
function collectDeclarationScopes(declarations, masked)
{
    const scopes = collectLexicalScopes(masked);
    const owners = new Map();
    for(const declaration of declarations)
    {
        let owner = scopes[0];
        for(const scope of scopes)
        {
            if(scope.start < declaration.headStart && declaration.headStart < scope.end && scope.start > owner.start)
            {
                owner = scope;
            }
        }

        owners.set(declaration, owner);
    }

    return owners;
}

/**
 * @description Resolves visible bindings at an offset, excluding closed and sibling scopes.
 * Enclosing parameters override outer declarations; nearer local declarations override parameters.
 * @param {Object} context the scope, declarations, declarationEntry, declarationScopes, and typedFunctions.
 * @param {number} offset the expression or assignment offset.
 * @returns {Map} the visible binding entries.
 */
function scopeAtOffset(context, offset)
{
    const bindings = [];
    for(const declaration of context.declarations)
    {
        const entry = context.declarationEntry.get(declaration);
        const owner = context.declarationScopes.get(declaration);
        if(entry && declaration.headStart < offset && owner.start < offset && offset < owner.end)
        {
            bindings.push({ name: declaration.name, entry: entry, start: owner.start, order: declaration.headStart });
        }
    }

    for(const typedFunction of context.typedFunctions)
    {
        if(functionEnclosesOffset(typedFunction, offset))
        {
            for(const param of typedFunction.params)
            {
                bindings.push({ name: param.name, entry: param.entry, start: typedFunction.bodyStart, order: -1 });
            }
        }
    }

    bindings.sort((left, right) => left.start - right.start || left.order - right.order);
    const scope = new Map(context.scope);
    for(const binding of bindings)
    {
        scope.set(binding.name, binding.entry);
    }

    return scope;
}

/**
 * @description Checks declarations for type mismatches and readonly violations.
 * @param {string} content the LGD source text.
 * @param {Array} declarations the parsed declarations in document order.
 * @param {Map} externals require specs to {exportName, keyword} entries for cross-file typing.
 * @returns {Array} errors as {message, offset} pairs; the caller attaches line numbers.
 */
/**
 * @description Builds a typedFunctions record for one parameter group, resolving each
 * parameter type against the scope. Used for both declaration-level typed parameters
 * and object literal method parameters.
 * @param {Object} context the {declaration, group, bodyStart, bodyEnd, scope, errors} context:
 * the parsed declaration, the {start, end, params} parameter group with param type offsets
 * relative to the declaration initializer text, the absolute offsets bounding the parameter
 * scope, the scope to resolve parameter types against, and the error list to append to.
 * @returns {Object} the {bodyStart, bodyEnd, paramStart, paramEnd, params} record.
 */
function createTypedFunctionRecord(context)
{
    const declaration = context.declaration;
    const group = context.group;
    const params = [];
    for(const param of group.params)
    {
        if(!param.name)
        {
            continue;
        }

        const typeOffset = param.typeStart === -1 ? declaration.initializerStart : declaration.initializerStart + param.typeStart;
        params.push({ name: param.name, entry: resolveParamType(param.typeName, context.scope, context.errors, typeOffset) });
    }

    return {
        bodyStart: context.bodyStart,
        bodyEnd: context.bodyEnd,
        paramStart: declaration.initializerStart + group.start,
        paramEnd: declaration.initializerStart + group.end,
        params: params
    };
}

function checkTypes(content, declarations, externals = new Map())
{
    const errors = [];
    const scope = new Map();
    const declarationEntry = new Map();
    const masked = maskCode(content, true);
    const declarationScopes = collectDeclarationScopes(declarations, masked);
    const externalsByName = new Map();
    for(const info of externals.values())
    {
        if(!externalsByName.has(info.exportName))
        {
            externalsByName.set(info.exportName, { keyword: info.keyword, kind: 'external' });
        }
    }

    const requireAt = collectRequires(content, externals);
    for(const requiredName of collectRequiredNames(masked))
    {
        if(!scope.has(requiredName))
        {
            scope.set(requiredName, { keyword: 'Object', readonly: false, kind: 'opaque',
                typeName: requiredName, ref: null });
        }
    }

    const typedFunctions = [];
    const scopeContext = { scope: scope, declarations: declarations, declarationEntry: declarationEntry,
        declarationScopes: declarationScopes, typedFunctions: typedFunctions };

    for(const declaration of declarations)
    {
        const extendedScope = scopeAtOffset(scopeContext, declaration.headStart);
        const resolved = resolveDeclaredType(declaration, extendedScope, errors);
        if(declaration.kind === 'class')
        {
            extendedScope.set(declaration.name, { keyword: 'Object', kind: 'self', typeName: declaration.name, ref: null });
        }

        const initializer = content.slice(declaration.initializerStart, declaration.initializerEnd);
        let inferred = UNKNOWN;
        let valueOffset = declaration.initializerStart;
        if(initializer.trim() !== '')
        {
            valueOffset = declaration.initializerStart + (initializer.length - initializer.trimStart().length);
            const valueEnd = declaration.initializerEnd - (initializer.length - initializer.trimEnd().length);
            const required = requireAt.get(valueOffset);
            if(required && required.end === valueEnd)
            {
                inferred = required.exportName;
            }
            else
            {
                const maskedInitializer = masked.slice(declaration.initializerStart, declaration.initializerEnd).trim();
                inferred = inferExpression(maskedInitializer, extendedScope, externalsByName);
            }
        }

        if(declaration.typedParams && declaration.typedParams.hasTypes)
        {
            typedFunctions.push(createTypedFunctionRecord({
                declaration: declaration,
                group: declaration.typedParams,
                bodyStart: declaration.initializerStart,
                bodyEnd: declaration.initializerEnd,
                scope: extendedScope,
                errors: errors
            }));
        }

        for(const methodParams of declaration.methodTypedParams || [])
        {
            if(!methodParams.hasTypes)
            {
                continue;
            }

            typedFunctions.push(createTypedFunctionRecord({
                declaration: declaration,
                group: methodParams,
                bodyStart: declaration.initializerStart + methodParams.bodyStart,
                bodyEnd: declaration.initializerStart + methodParams.bodyEnd,
                scope: extendedScope,
                errors: errors
            }));
        }

        const entry = {
            keyword: effectiveKeyword(resolved, inferred, extendedScope, externalsByName),
            readonly: declaration.readonly,
            kind: resolved.kind,
            typeName: resolved.typeName,
            ref: resolved.ref
        };
        declarationEntry.set(declaration, entry);
    }

    return errors;
}

module.exports = {
    checkTypes: checkTypes,
    resolveParamType: resolveParamType,
    isAssignableTo: isAssignableTo
};
