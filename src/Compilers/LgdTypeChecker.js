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
 * Never an error in v1: null and undefined assigned to any type (nullable Type?
 * syntax is planned), unknowable expressions (calls, member access, unbound
 * identifiers, regex literals), Object as a top type, and shadowing by non-LGD
 * bindings outside the modeled cases in checkAssignments.
 */

const { UNKNOWN, NULL, inferExpression, maskCode } = require('./LgdInfer');

/** @description The eight LGD type keywords; anything else in type position is a name or dotted type. */
const typeKeywords = [ 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'Object', 'Array', 'Function' ];

/** @description Literal kinds that can plausibly be an external or self-defined object type. */
const referenceKinds = [ 'Object', 'Array', 'Function' ];

/** @description Matches a require('spec') call so cross-file externals can type it. */
const requireCallPattern = /\brequire\(\s*(?<quote>["'])(?<spec>(?:(?!\k<quote>)[^\\]|\\.)*)\k<quote>\s*\)/g;


/** @description Characters kept before an assigned name to detect let, const, and var. */
const lookbehindWidth = 16;

/** @description Longest assigned value scanned; longer values stay Unknown. */
const maxValueLength = 500;


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
    if(typeKeywords.includes(typeName))
    {
        return { kind: 'keyword', keyword: typeName, ref: null, typeName: typeName };
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

    if(typeName === declaration.name)
    {
        return { kind: 'self', keyword: null, ref: null, typeName: typeName };
    }

    const target = scope.get(typeName);
    if(!target)
    {
        errors.push({ message: `Unknown type '${typeName}'.`, offset: declaration.typeStart });
        return { kind: 'unknown', keyword: UNKNOWN, ref: null, typeName: typeName };
    }

    return { kind: 'nominal', keyword: target.keyword, ref: typeName, typeName: typeName };
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

    if(typeKeywords.includes(typeName))
    {
        return { keyword: typeName, readonly: false, kind: 'keyword', typeName: typeName, ref: null };
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

    const target = scope.get(typeName);
    if(!target)
    {
        errors.push({ message: `Unknown type '${typeName}'.`, offset: offset });
        return { keyword: UNKNOWN, readonly: false, kind: 'unknown', typeName: typeName, ref: null };
    }

    return { keyword: target.keyword || 'Object', readonly: false, kind: 'nominal', typeName: typeName, ref: typeName };
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

function scopeWithParams(baseScope, typedFunctions, offset)
{
    const enclosing = typedFunctions.filter(typedFunction => functionEnclosesOffset(typedFunction, offset));
    if(enclosing.length === 0)
    {
        return baseScope;
    }

    enclosing.sort((left, right) => left.bodyStart - right.bodyStart);
    const scope = new Map(baseScope);
    for(const typedFunction of enclosing)
    {
        for(const param of typedFunction.params)
        {
            scope.set(param.name, param.entry);
        }
    }

    return scope;
}

/**
 * @description Tells whether the name is a typed parameter of a function enclosing the offset.
 * @param {Array} typedFunctions the {bodyStart, bodyEnd, params} records of functions with typed parameters.
 * @param {number} nameStart the offset of the name.
 * @param {string} name the name to test.
 * @returns {boolean} true when a typed parameter shadows the name at that offset.
 */
function isTypedParamAt(typedFunctions, nameStart, name)
{
    for(const typedFunction of typedFunctions)
    {
        if(functionEnclosesOffset(typedFunction, nameStart))
        {
            for(const param of typedFunction.params)
            {
                if(param.name === name)
                {
                    return true;
                }
            }
        }
    }

    return false;
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
 * @description Renders an inferred type for error messages: keyword-kind names show
 * their keyword (Cannot assign Number to String), nominal names show the name itself.
 * @param {string} inferred the inferred nominal name, keyword, Null, or Unknown.
 * @param {Map} scope declared variable names to {keyword, readonly, kind} entries.
 * @param {Map} externalsByName cross-file export names to {keyword, kind} entries.
 * @returns {string} the display text.
 */
function displayInferred(inferred, scope, externalsByName)
{
    const entry = scope.get(inferred) || externalsByName.get(inferred);
    if(entry && entry.kind === 'keyword')
    {
        return entry.keyword;
    }

    return inferred;
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
 * @description Tells whether the offset lies inside a declaration head, before its initializer.
 * @param {Array} declarations the parsed declarations in document order.
 * @param {number} offset the offset to test.
 * @returns {boolean} true when the offset is inside a head range.
 */
function isInHeadRange(declarations, offset)
{
    for(const declaration of declarations)
    {
        if(offset >= declaration.headStart && offset < declaration.initializerStart)
        {
            return true;
        }
    }

    return false;
}

/**
 * @description Tells whether the offset lies inside any of the given ranges.
 * @param {Array} ranges the {start, end} ranges.
 * @param {number} offset the offset to test.
 * @returns {boolean} true when the offset is inside a range.
 */
function isInRanges(ranges, offset)
{
    for(const range of ranges)
    {
        if(offset >= range.start && offset < range.end)
        {
            return true;
        }
    }

    return false;
}

/**
 * @description Splits a parameter list into clean names, dropping defaults and rest markers.
 * @param {string} paramsText the raw parameter text.
 * @returns {Array} the parameter names.
 */
function splitParams(paramsText)
{
    return paramsText
        .split(',')
        .map(part => part.trim().split('=')[0].trim().replace(/^\.{3}/, '').split(/\s+/).pop())
        .filter(name => (/^[$A-Z_a-z][\w$]*$/).test(name));
}

/**
 * @description Extracts the parameter names of an arrow or function expression initializer.
 * @param {string} initializerText the masked initializer text.
 * @returns {Array} the parameter names.
 */
function functionParams(initializerText)
{
    const text = initializerText.trim();
    const arrowParen = (/^(?:async\s+)?\(\s*(?<params>[^)]*?)\s*\)\s*=>/).exec(text);
    if(arrowParen)
    {
        return splitParams(arrowParen.groups.params);
    }

    const functionExpr = (/^(?:async\s+)?function(?:\s+[$A-Z_a-z][\w$]*)?\s*\(\s*(?<params>[^)]*?)\s*\)/).exec(text);
    if(functionExpr)
    {
        return splitParams(functionExpr.groups.params);
    }

    const arrowSingle = (/^(?:async\s+)?(?<name>[$A-Z_a-z][\w$]*)\s*=>/).exec(text);
    return arrowSingle ? [arrowSingle.groups.name] : [];
}

/**
 * @description Collects parameter records for Function declarations to detect shadowing.
 * @param {Array} declarations the parsed declarations in document order.
 * @param {string} masked the masked source text.
 * @returns {Array} the {start, end, params} records.
 */
function collectFunctionParams(declarations, masked)
{
    return declarations
        .filter(declaration => declaration.typeName === 'Function')
        .map(declaration => ({
            start: declaration.initializerStart,
            end: declaration.initializerEnd,
            params: functionParams(masked.slice(declaration.initializerStart, declaration.initializerEnd))
        }));
}

/**
 * @description Tells whether the name is shadowed by an enclosing LGD function parameter.
 * @param {Array} functions the {start, end, params} records of Function declarations.
 * @param {number} nameStart the offset of the assigned name.
 * @param {string} name the assigned name.
 * @returns {boolean} true when a parameter shadows the name at that offset.
 */
function isShadowedByParam(functions, nameStart, name)
{
    for(const entry of functions)
    {
        if(nameStart >= entry.start && nameStart < entry.end && entry.params.includes(name))
        {
            return true;
        }
    }

    return false;
}

/**
 * @description Tells whether the assignment is really a shadowing let, const, or var declaration.
 * @param {string} masked the masked source text.
 * @param {number} nameStart the offset of the assigned name.
 * @returns {boolean} true when let, const, or var precedes the name.
 */
function isShadowingDeclaration(masked, nameStart)
{
    const before = masked.slice(Math.max(0, nameStart - lookbehindWidth), nameStart);
    return (/(?:\blet|\bconst|\bvar)\s+$/).test(before);
}

/**
 * @description Finds the body ranges of class declarations, whose fields are own bindings.
 * @param {string} masked the masked source text.
 * @returns {Array} the {start, end} body ranges.
 */
function findClassBodies(masked)
{
    const ranges = [];
    const pattern = (/\bclass\b/g);
    let classMatch;
    while((classMatch = pattern.exec(masked)) !== null)
    {
        if(classMatch.index > 0 && (/[\w$.]/).test(masked[classMatch.index - 1]))
        {
            continue;
        }

        const open = masked.indexOf('{', classMatch.index);
        if(open === -1)
        {
            continue;
        }

        let depth = 0;
        for(let index = open; index < masked.length; index++)
        {
            if(masked[index] === '{')
            {
                depth++;
            }
            else if(masked[index] === '}')
            {
                depth--;
                if(depth === 0)
                {
                    ranges.push({ start: open, end: index + 1 });
                    break;
                }
            }
        }
    }

    return ranges;
}

/**
 * @description Skips whitespace starting at the given offset.
 * @param {string} masked the masked source text.
 * @param {number} offset the offset to start from.
 * @returns {number} the first non-whitespace offset at or after the start.
 */
function skipWhitespace(masked, offset)
{
    let index = offset;
    while(index < masked.length && (/\s/).test(masked[index]))
    {
        index++;
    }

    return index;
}

/**
 * @description Finds where an assigned value ends: the next semicolon or newline, capped.
 * @param {string} masked the masked source text.
 * @param {number} offset the offset where the value starts.
 * @returns {number} the end offset of the value.
 */
function findValueEnd(masked, offset)
{
    const limit = Math.min(masked.length, offset + maxValueLength);
    for(let index = offset; index < limit; index++)
    {
        if(masked[index] === ';' || masked[index] === '\n')
        {
            return index;
        }
    }

    return limit;
}

/**
 * @description Finds the {paramStart, paramEnd} group enclosing a parameter default assignment.
 * @param {Array} typedFunctions the {bodyStart, bodyEnd, paramStart, paramEnd, params} records.
 * @param {number} nameStart the offset of the assigned name.
 * @returns {Object|null} the enclosing group, or null when the offset is not in a parameter list.
 */
function paramGroupAt(typedFunctions, nameStart)
{
    for(const typedFunction of typedFunctions)
    {
        if(nameStart >= typedFunction.paramStart && nameStart < typedFunction.paramEnd)
        {
            return typedFunction;
        }
    }

    return null;
}

/**
 * @description Finds where a parameter default value ends: the first top-level comma, semicolon,
 * or the closing paren of the parameter group.
 * @param {string} masked the masked source text.
 * @param {number} valueStart the offset where the default value starts.
 * @param {number} groupEnd the offset just past the parameter group's closing paren.
 * @returns {number} the end offset of the default value.
 */
function findDefaultEnd(masked, valueStart, groupEnd)
{
    let depth = 0;
    let stringMode = null;
    for(let index = valueStart; index < groupEnd; index++)
    {
        const character = masked[index];
        if(stringMode)
        {
            if(character === '\\')
            {
                index++;
            }
            else if(character === stringMode)
            {
                stringMode = null;
            }

            continue;
        }

        if(character === '"' || character === "'" || character === '`')
        {
            stringMode = character;
        }
        else if(character === '(' || character === '[' || character === '{')
        {
            depth++;
        }
        else if(character === ')' || character === ']' || character === '}')
        {
            if(depth === 0)
            {
                return index;
            }

            depth--;
        }
        else if((character === ',' || character === ';') && depth === 0)
        {
            return index;
        }
    }

    return groupEnd;
}

/**
 * @description Tells whether an assignment match should be skipped as a non-assignment.
 * @param {Object} scan the {masked, declarations, functions, classBodies} scan context.
 * @param {number} nameStart the offset of the assigned name.
 * @param {string} name the assigned name.
 * @returns {boolean} true when the match is not a real assignment to the declared variable.
 */
function isSkippedAssignment(scan, nameStart, name)
{
    if(isInHeadRange(scan.declarations, nameStart))
    {
        return true;
    }

    if(isInRanges(scan.classBodies, nameStart))
    {
        return true;
    }

    if(isShadowedByParam(scan.functions, nameStart, name) && !isTypedParamAt(scan.typedFunctions, nameStart, name))
    {
        return true;
    }

    return isShadowingDeclaration(scan.masked, nameStart);
}

/**
 * @description Checks plain assignments to declared variables after their declaration.
 * @param {Object} context the assignment-check context: masked, declarations, scope,
 * errors, externalsByName, requireAt, and typedFunctions (the {bodyStart, bodyEnd,
 * params} records of functions with typed parameters).
 * @returns {void}
 */
function checkAssignments(context)
{
    const { masked, declarations, scope, errors, externalsByName, requireAt, typedFunctions = [] } = context;

    const nameSet = new Set(scope.keys());
    for(const typedFunction of typedFunctions)
    {
        for(const param of typedFunction.params)
        {
            nameSet.add(param.name);
        }
    }

    const names = Array.from(nameSet);
    if(names.length === 0)
    {
        return;
    }

    const escaped = names
        .map(name => name.replace(/\$/g, '\\$'))
        .sort((left, right) => right.length - left.length);
    const pattern = new RegExp(`(^|[^\\w$.])(${escaped.join('|')})\\s*=(?![=>])`, 'gm');
    const scan = {
        masked: masked,
        declarations: declarations,
        functions: collectFunctionParams(declarations, masked),
        typedFunctions: typedFunctions,
        classBodies: findClassBodies(masked)
    };

    let assignmentMatch;
    while((assignmentMatch = pattern.exec(masked)) !== null)
    {
        const nameStart = assignmentMatch.index + assignmentMatch[1].length;
        const name = assignmentMatch[2];
        if(isSkippedAssignment(scan, nameStart, name))
        {
            continue;
        }

        const valueStart = skipWhitespace(masked, pattern.lastIndex);
        const group = paramGroupAt(typedFunctions, nameStart);
        const valueEnd = group
            ? Math.min(findValueEnd(masked, valueStart), findDefaultEnd(masked, valueStart, group.paramEnd))
            : findValueEnd(masked, valueStart);
        const valueText = masked.slice(valueStart, valueEnd).trim();
        if(valueText === '')
        {
            continue;
        }

        const extendedScope = scopeWithParams(scope, typedFunctions, nameStart);
        const entry = extendedScope.get(name);
        if(!entry)
        {
            continue;
        }

        const required = requireAt.get(valueStart);
        const inferred = required ? required.exportName : inferExpression(valueText, extendedScope, externalsByName);
        if(entry.readonly)
        {
            errors.push({ message: `Cannot assign to readonly variable '${name}'.`, offset: nameStart });
        }
        else
        {
            const resolved = { kind: entry.kind, keyword: entry.keyword, ref: entry.ref, typeName: entry.typeName };
            if(!isAssignableTo(resolved, inferred, extendedScope, externalsByName))
            {
                const declared = resolved.kind === 'keyword' ? resolved.keyword : resolved.typeName;
                errors.push({ message: `Cannot assign ${displayInferred(inferred, extendedScope, externalsByName)} to ${declared}.`, offset: valueStart });
            }
        }
    }
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
    const masked = maskCode(content);
    const externalsByName = new Map();
    for(const info of externals.values())
    {
        if(!externalsByName.has(info.exportName))
        {
            externalsByName.set(info.exportName, { keyword: info.keyword, kind: 'external' });
        }
    }

    const requireAt = collectRequires(content, externals);
    for(const requiredName of collectRequiredNames(content))
    {
        if(!scope.has(requiredName))
        {
            scope.set(requiredName, { keyword: 'Object', readonly: false, kind: 'opaque',
                typeName: requiredName, ref: null });
        }
    }

    const typedFunctions = [];

    for(const declaration of declarations)
    {
        const extendedScope = scopeWithParams(scope, typedFunctions, declaration.headStart);
        const resolved = resolveDeclaredType(declaration, extendedScope, errors);
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

            if(!isAssignableTo(resolved, inferred, extendedScope, externalsByName))
            {
                const declared = resolved.kind === 'keyword' ? resolved.keyword : resolved.typeName;
                errors.push({ message: `Cannot assign ${displayInferred(inferred, extendedScope, externalsByName)} to ${declared}.`, offset: valueOffset });
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

        scope.set(declaration.name, {
            keyword: effectiveKeyword(resolved, inferred, scope, externalsByName),
            readonly: declaration.readonly,
            kind: resolved.kind,
            typeName: resolved.typeName,
            ref: resolved.ref
        });
    }

    checkAssignments({ masked: masked, declarations: declarations, scope: scope, errors: errors,
        externalsByName: externalsByName, requireAt: requireAt, typedFunctions: typedFunctions });
    return errors;
}

module.exports = {
    checkTypes: checkTypes
};
