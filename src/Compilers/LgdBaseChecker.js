const { UNKNOWN, NULL, inferExpression, maskCode } = require('./LgdInfer');
const { parseTypedParams, splitTopLevelChunks } = require('./LgdTypedParams');

/** @description Primitive LGD keywords that cannot supply an OLOO base object. */
const primitiveTypes = [ 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', NULL ];

/** @description Built-in type names checked without nominal identity. */
const typeKeywords = [ ...primitiveTypes, 'Object', 'Array', 'Function' ];

/** @description Reads a complete require expression while preserving the module specifier. */
const requirePattern = /^\s*require\(\s*(?<quote>["'])(?<specifier>[^"'\\]*)\k<quote>\s*\)\s*$/;

/**
 * @description Skips leading comments and whitespace without erasing regex literal arguments.
 * @param {string} text the parameter or argument text.
 * @returns {number} the first nontrivia offset.
 */
function valueStart(text)
{
    return (/^(?:\s|\/\*[\S\s]*?\*\/|\/\/[^\n\r]*)*/).exec(text)[0].length;
}

/**
 * @description Removes empty parameter chunks while preserving unrecognized nonempty parameters.
 * @param {Array} params the parsed parameter records.
 * @returns {Array} the actual parameters.
 */
function actualParams(params)
{
    return params.filter(parameter => parameter.name || valueStart(parameter.raw || '') < (parameter.raw || '').length).map(parameter =>
    {
        if(parameter.name)
        {
            return parameter;
        }

        const raw = maskCode(parameter.raw || '').trim();
        const optional = (/^(?:{[\S\s]*}|\[[\S\s]*])\s*=/).test(raw);
        return { ...parameter, optional: parameter.optional || optional, rest: parameter.rest || raw.startsWith('...') };
    });
}

/**
 * @description Returns a known class constructor or OLOO create signature, otherwise null.
 * @param {Object} declaration the local declaration or external export metadata.
 * @returns {Array|null} parameter records, including an empty implicit class constructor.
 */
function getConstructorParams(declaration)
{
    if(Array.isArray(declaration.constructorParams))
    {
        return actualParams(declaration.constructorParams);
    }

    if(declaration.kind === 'class')
    {
        return actualParams(declaration.constructorMember?.params || []);
    }

    const typedCreate = declaration.methodTypedParams?.find(group => group.name === 'create');
    if(typedCreate)
    {
        return actualParams(typedCreate.params);
    }

    const initializer = declaration.initializerText?.trim() || '';
    if(!initializer.startsWith('{') || !initializer.endsWith('}'))
    {
        return null;
    }

    for(const chunk of splitTopLevelChunks(initializer))
    {
        const masked = maskCode(chunk.text);
        const method = (/^\s*(?:async\s+)?create\s*\(/).exec(masked);
        const property = (/^\s*create\s*:\s*/).exec(masked);
        let functionText = null;
        if(method)
        {
            functionText = chunk.text.slice(masked.indexOf('create'));
        }
        else if(property)
        {
            functionText = chunk.text.slice(property[0].length);
        }

        if(functionText !== null)
        {
            const parsed = parseTypedParams(functionText);
            return parsed ? actualParams(parsed.params) : null;
        }
    }

    return null;
}

/**
 * @description Collects brace ranges for conservative lexical binding visibility.
 * @param {string} masked the masked document.
 * @returns {Array} containing brace ranges, including the document scope.
 */
function collectScopes(masked)
{
    const scopes = [{ start: -1, end: masked.length }];
    const stack = [scopes[0]];
    for(let index = 0; index < masked.length; index++)
    {
        if(masked[index] === '{')
        {
            const scope = { start: index, end: masked.length };
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
 * @description Finds the innermost brace range enclosing an offset.
 * @param {Array} scopes document brace ranges.
 * @param {number} offset the source offset.
 * @returns {Object} the enclosing scope.
 */
function scopeAt(scopes, offset)
{
    let owner = scopes[0];
    for(const scope of scopes)
    {
        if(scope.start < offset && offset < scope.end && scope.start > owner.start)
        {
            owner = scope;
        }
    }

    return owner;
}

/**
 * @description Resolves known external signatures from complete require initializers.
 * @param {Object} declaration a local declaration.
 * @param {Map} externals module specifiers to export metadata.
 * @returns {Object} metadata used for base validation.
 */
function resolveExternal(declaration, externals)
{
    const required = requirePattern.exec(declaration.initializerText || '');
    return required && externals.has(required.groups.specifier) ? externals.get(required.groups.specifier) : declaration;
}

/**
 * @description Collects declarations and simple JavaScript bindings without treating unknown imports as absent.
 * @param {string} content the original document.
 * @param {string} masked the masked document.
 * @param {Array} declarations LGD declaration records.
 * @param {Array} scopes document brace ranges.
 * @param {Map} externals module specifiers to export metadata.
 * @returns {Array} named bindings and their lexical scopes.
 */
function collectBindings(context)
{
    const { content, masked, declarations, scopes, externals } = context;
    const bindings = declarations.map(declaration => ({
        name: declaration.name,
        offset: declaration.nameStart,
        scope: scopeAt(scopes, declaration.headStart ?? declaration.start),
        declaration: resolveExternal(declaration, externals)
    }));

    const variablePattern = (/\b(?:const|let|var)\s+(?<name>[$A-Z_a-z][\w$]*)\s*(?:=\s*(?<initializer>[^\n\r;]*))?/g);
    for(const match of masked.matchAll(variablePattern))
    {
        const declaration = { name: match.groups.name, typeName: UNKNOWN };
        if(match.groups.initializer !== undefined)
        {
            const initializerStart = match.index + match[0].length - match.groups.initializer.length;
            declaration.initializerText = content.slice(initializerStart, match.index + match[0].length);
        }

        bindings.push({ name: declaration.name, offset: match.index, scope: scopeAt(scopes, match.index),
            declaration: resolveExternal(declaration, externals) });
    }

    const otherPattern = (/\b(?:function\s*\*?\s*|class\s+)(?<name>[$A-Z_a-z][\w$]*)|\bimport\s+(?<imports>[^\n\r;]*?)\s+from\b/g);
    for(const match of masked.matchAll(otherPattern))
    {
        const names = match.groups.name ? [match.groups.name] : match.groups.imports.match(/[$A-Z_a-z][\w$]*/g) || [];
        for(const name of names)
        {
            if(!bindings.some(binding => binding.name === name && binding.offset >= match.index && binding.offset < match.index + match[0].length))
            {
                bindings.push({ name: name, offset: match.index, scope: scopeAt(scopes, match.index), declaration: { typeName: UNKNOWN } });
            }
        }
    }

    return bindings;
}

/**
 * @description Collects visible bindings, with closer lexical scopes overriding outer ones.
 * @param {Array} bindings the declarations and JavaScript bindings.
 * @param {number} offset the source offset to inspect.
 * @returns {Map} visible names to declaration metadata.
 */
function visibleBindings(bindings, offset)
{
    const visible = new Map();
    const ordered = bindings.filter(binding => binding.scope.start < offset && offset < binding.scope.end)
        .sort((left, right) => left.scope.start - right.scope.start || left.offset - right.offset);
    for(const binding of ordered)
    {
        visible.set(binding.name, binding.declaration);
    }

    return visible;
}

/**
 * @description Creates a conservative inference entry for a binding or parameter.
 * @param {Object} declaration the declaration or parameter.
 * @returns {Object} the inference entry.
 */
function inferenceEntry(declaration)
{
    if(declaration.rest)
    {
        return { keyword: 'Array', typeName: 'Array' };
    }

    if(declaration.kind === 'class')
    {
        return { keyword: 'Object', typeName: declaration.name || declaration.exportName, baseName: declaration.baseName };
    }

    const typeName = declaration.typeName || declaration.keyword || UNKNOWN;
    const keyword = typeKeywords.includes(typeName) || typeName === UNKNOWN ? typeName : 'Object';
    return { keyword: keyword, typeName: typeName };
}

/**
 * @description Extends expression inference with constructor parameters and enclosing typed function parameters.
 * @param {Map} visible visible declaration metadata.
 * @param {Array} declarations LGD declarations.
 * @param {Object} derived the derived class.
 * @returns {Map} names to inference entries.
 */
function argumentScope(visible, declarations, derived)
{
    const scope = new Map();
    for(const [ name, declaration ] of visible)
    {
        scope.set(name, inferenceEntry(declaration));
    }

    for(const declaration of declarations)
    {
        const groups = [...declaration.methodTypedParams || []];
        if(declaration.typedParams)
        {
            groups.push({ ...declaration.typedParams, bodyStart: 0, bodyEnd: declaration.initializerEnd - declaration.initializerStart });
        }

        for(const group of groups)
        {
            const start = declaration.initializerStart + group.bodyStart;
            const end = declaration.initializerStart + group.bodyEnd;
            if(start > derived.headStart || derived.headStart >= end)
            {
                continue;
            }

            for(const parameter of group.params.filter(item => item.name))
            {
                scope.set(parameter.name, inferenceEntry(parameter));
            }
        }
    }

    for(const parameter of derived.constructorMember?.params || [])
    {
        if(parameter.name)
        {
            scope.set(parameter.name, inferenceEntry(parameter));
        }
    }

    return scope;
}

/**
 * @description Compares only established keyword or nominal types and permits unknown expressions.
 * @param {string} expected the parameter type name.
 * @param {string} inferred the expression's inferred name or keyword.
 * @param {Map} scope argument inference bindings.
 * @returns {boolean} whether a mismatch is established.
 */
function isTypeMismatch(expected, inferred, scope)
{
    const entry = scope.get(inferred);
    const actual = entry ? entry.keyword : inferred;
    if(!expected || expected === 'Object' || actual === UNKNOWN || actual === NULL)
    {
        return false;
    }

    if(typeKeywords.includes(expected))
    {
        return actual !== expected;
    }

    if(primitiveTypes.includes(actual))
    {
        return true;
    }

    if(!entry || entry.typeName === 'Object' || entry.typeName === expected || entry.typeName === UNKNOWN)
    {
        return false;
    }

    const visited = new Set();
    let ancestor = entry.typeName;
    while(ancestor && !visited.has(ancestor))
    {
        if(ancestor === expected)
        {
            return false;
        }

        visited.add(ancestor);
        ancestor = scope.get(ancestor)?.baseName;
    }

    return true;
}

/**
 * @description Splits base arguments using the shared literal-aware scanner and keeps source offsets.
 * @param {string} content the original document.
 * @param {Object} derived the derived class.
 * @returns {Array} argument text and absolute source offsets.
 */
function baseArguments(content, derived)
{
    const constructor = derived.constructorMember;
    if(!constructor || !Number.isInteger(constructor.baseArgumentsStart) || constructor.baseArgumentsStart < 0)
    {
        return [];
    }

    const start = constructor.baseArgumentsStart;
    const source = content.slice(start, constructor.baseArgumentsEnd);
    return splitTopLevelChunks(`(${source})`).filter(chunk => valueStart(chunk.text) < chunk.text.length).map(chunk => ({
        text: chunk.text,
        offset: start + chunk.start - 1 + valueStart(chunk.text),
        endOffset: start + chunk.start - 1 + maskCode(chunk.text).trimEnd().length
    }));
}

/**
 * @description Checks established argument counts and types for one known base signature.
 * @param {Object} context the content, derived class, params, inference scope, and errors.
 */
function checkArguments(context)
{
    const { content, derived, params, scope, errors } = context;
    const args = baseArguments(content, derived);
    const spread = args.findIndex(argument => maskCode(argument.text).trim().startsWith('...'));
    const rest = params.findIndex(parameter => parameter.rest);
    let minimum = 0;
    for(let index = 0; index < params.length; index++)
    {
        const parameter = params[index];
        if(!parameter.rest && !parameter.optional && (parameter.defaultText === null || parameter.defaultText === undefined))
        {
            minimum = index + 1;
        }
    }

    const maximum = rest === -1 ? params.length : Infinity;
    if(spread === -1 && (args.length < minimum || args.length > maximum))
    {
        let expected = `${minimum}`;
        if(maximum === Infinity)
        {
            expected = `at least ${minimum}`;
        }
        else if(minimum !== maximum)
        {
            expected = `${minimum} to ${maximum}`;
        }

        const offset = derived.constructorMember?.baseArgumentsStart;
        const explicitBaseCall = Number.isInteger(offset) && offset >= 0;
        errors.push({ offset: explicitBaseCall ? offset : derived.baseStart,
            endOffset: explicitBaseCall ? derived.constructorMember.baseArgumentsEnd : derived.baseEnd,
            message: `Base '${derived.baseName}' expects ${expected} argument(s), but received ${args.length}.` });
    }

    const limit = spread === -1 ? args.length : spread;
    for(let index = 0; index < limit; index++)
    {
        const parameter = params[index] || (rest === -1 ? null : params[rest]);
        if(!parameter?.typeName)
        {
            continue;
        }

        const inferred = inferExpression(maskCode(args[index].text), scope, new Map());
        if(isTypeMismatch(parameter.typeName, inferred, scope))
        {
            const actual = scope.get(inferred)?.typeName || inferred;
            errors.push({ offset: args[index].offset, endOffset: args[index].endOffset,
                message: `Base '${derived.baseName}' argument ${index + 1} must be ${parameter.typeName}, but received ${actual}.` });
        }
    }
}

/**
 * @description Recognizes local plain object literals that definitely omit a create factory.
 * @param {Object} base the known local declaration.
 * @param {Object} derived the derived class using the base.
 * @param {string} masked the masked document used to detect intervening object references.
 * @returns {boolean} whether no own or potentially inherited create factory can be found.
 */
function isFactoryDefinitelyMissing(base, derived, masked)
{
    if(base.kind === 'class' || !Number.isInteger(base.initializerEnd))
    {
        return false;
    }

    const initializer = base.initializerText?.trim() || '';
    if(!initializer.startsWith('{') || !initializer.endsWith('}'))
    {
        return false;
    }

    const escapedName = base.name.replace(/\$/g, '\\$');
    const reference = new RegExp(`(?:^|[^\\w$])${escapedName}(?![\\w$])`);
    if(reference.test(masked.slice(base.initializerEnd, derived.headStart)))
    {
        return false;
    }

    for(const chunk of splitTopLevelChunks(initializer))
    {
        const head = maskCode(chunk.text).trim();
        if(head === '')
        {
            continue;
        }

        const key = (/^(?:(?:get|set|async)\s+)?\*?\s*(?<name>[$A-Z_a-z][\w$]*)\s*(?:[(:]|$)/).exec(head);
        if(!key || key.groups.name === 'create' || key.groups.name === '__proto__')
        {
            return false;
        }
    }

    return true;
}

/**
 * @description Detects cycles among locally declared classes using each class's lexical base binding.
 * @param {Object} derived the class being checked.
 * @param {Array} bindings declaration bindings and scopes.
 * @returns {boolean} whether the known local inheritance chain cycles.
 */
function hasInheritanceCycle(derived, bindings)
{
    const visited = new Set([derived]);
    let current = derived;
    while(current.baseName && Number.isInteger(current.headStart))
    {
        const visible = visibleBindings(bindings, current.headStart);
        const base = visible.get(current.baseName);
        if(!base || base.kind !== 'class')
        {
            return false;
        }

        if(visited.has(base))
        {
            return true;
        }

        visited.add(base);
        current = base;
    }

    return false;
}

/**
 * @description Validates known base constructor signatures without guessing unknown expression types.
 * @param {string} content the original LGD document.
 * @param {Array} declarations parsed LGD declarations, including class records.
 * @param {Map} externals module specifiers to export metadata with optional constructorParams.
 * @returns {Array} diagnostics as offset and message pairs.
 */
function check(content, declarations, externals = new Map())
{
    const errors = [];
    const masked = maskCode(content, true);
    const scopes = collectScopes(masked);
    const bindings = collectBindings({ content: content, masked: masked, declarations: declarations, scopes: scopes, externals: externals });
    for(const derived of declarations)
    {
        if(derived.kind !== 'class' || !derived.baseName)
        {
            continue;
        }

        const visible = visibleBindings(bindings, derived.headStart ?? derived.start);
        const base = visible.get(derived.baseName);
        if(!base)
        {
            const root = derived.baseName.split('.')[0];
            if(!visible.has(root))
            {
                errors.push({ offset: derived.baseStart, message: `Unknown base '${derived.baseName}'.` });
            }

            continue;
        }

        if(base === derived)
        {
            errors.push({ offset: derived.baseStart, message: `Class '${derived.name}' cannot inherit from itself.` });
            continue;
        }

        if(hasInheritanceCycle(derived, bindings))
        {
            errors.push({ offset: derived.baseStart, message: `Class '${derived.name}' has a circular base inheritance chain.` });
            continue;
        }

        const scope = argumentScope(visible, declarations, derived);
        const inferred = inferExpression(maskCode(base.initializerText || ''), scope, new Map());
        const keyword = base.keyword || base.typeName;
        if(primitiveTypes.includes(keyword) || primitiveTypes.includes(inferred))
        {
            errors.push({ offset: derived.baseStart, message: `Base '${derived.baseName}' must be a class or OLOO object.` });
            continue;
        }

        if(isFactoryDefinitelyMissing(base, derived, masked))
        {
            errors.push({ offset: derived.baseStart, message: `Base '${derived.baseName}' must provide a create(...) factory.` });
            continue;
        }

        const params = getConstructorParams(base);
        if(params !== null)
        {
            checkArguments({ content: content, derived: derived, params: params, scope: scope, errors: errors });
        }
    }

    return errors;
}

module.exports = {
    check: check,
    getConstructorParams: getConstructorParams,
    collectScopes: collectScopes,
    collectBindings: collectBindings,
    visibleBindings: visibleBindings
};
