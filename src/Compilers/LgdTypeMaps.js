const Types = require('../Parsers/Types');

/** @description Maps each LGD type keyword to its TypeScript type, reusing the shared Types constants. */
const tsTypeMap = {
    Number: Types.NUMBER,
    String: Types.STRING,
    Boolean: Types.BOOLEAN,
    BigInt: 'bigint',
    Symbol: 'symbol',
    Object: Types.OBJECT,
    Array: Types.ANYARRAY,
    Function: Types.FUNCTION
};

/** @description Maps each LGD type keyword to its C# type. Array and Function need special handling, see CSharpBackend. */
const csharpTypeMap = {
    Number: 'double',
    String: 'string',
    Boolean: 'bool',
    BigInt: 'long',
    Symbol: 'object',
    Object: 'dynamic',
    Array: 'List<dynamic>',
    Function: 'Func<dynamic>'
};

/** @description Lowercase primitive aliases apply only to source annotations. */
const primitiveAliases = { number: 'Number', string: 'String', boolean: 'Boolean', bigint: 'BigInt', symbol: 'Symbol', object: 'Object' };

/** @description Shared identifier-token syntax used before validating an annotation or method name. */
const typeTokenPattern = String.raw`[$A-Z_a-z][\w$]*(?:\.[$A-Z_a-z][\w$]*)*(?:\[\]|\?)*`;

/** @description Shared LGD value-type syntax, including qualified names and nullable suffixes. */
const typeNamePattern = String.raw`(?:(?:[$A-Z_a-z][\w$]*\.)*[A-Z][\w$]*|number|string|boolean|bigint|symbol|object)(?:\[\]|\?)*`;

/** @description Returns whether a source annotation explicitly includes null. */
function isNullableType(typeName)
{
    return typeof typeName === 'string' && typeName.endsWith('?');
}

/** @description Builds a structural named, nullable, or array annotation while preserving source spelling and offsets. */
function readType(text, index = 0)
{
    const named = (/^[$A-Z_a-z][\w$]*(?:\.[$A-Z_a-z][\w$]*)*/).exec(text.slice(index));
    if(!named)
    {
        return null;
    }

    let end = index + named[0].length;
    let annotation = { kind: 'named', name: named[0], start: index, end: end };
    while(text[end] === '?' || text.startsWith('[]', end))
    {
        const nullable = text[end] === '?';
        if(nullable && annotation.kind === 'nullable')
        {
            return null;
        }

        end += nullable ? 1 : 2;
        annotation = { kind: nullable ? 'nullable' : 'array', element: annotation, start: index, end: end };
    }

    return { annotation: annotation, end: end, name: named[0] };
}

/** @description Renders an annotation in canonical LGD spelling without changing any runtime identifier. */
function renderType(annotation)
{
    if(annotation.kind === 'named')
    {
        return primitiveAliases[annotation.name] || annotation.name;
    }

    return `${renderType(annotation.element)}${annotation.kind === 'array' ? '[]' : '?'}`;
}

/** @description Canonicalizes primitive aliases and retains the complete container shape. */
function canonicalTypeName(typeName)
{
    if(typeof typeName !== 'string')
    {
        return typeName;
    }

    const parsed = readType(typeName);
    return parsed && parsed.end === typeName.length ? renderType(parsed.annotation) : typeName;
}

/** @description Resolves the named component of an LGD nullable annotation. */
function baseTypeName(typeName)
{
    return canonicalTypeName(isNullableType(typeName) ? typeName.slice(0, -1) : typeName);
}

/** @description Resolves the leaf name used when checking whether an annotation's named type exists. */
function rootTypeName(typeName)
{
    const parsed = typeof typeName === 'string' && readType(typeName);
    return parsed && parsed.end === typeName.length ? primitiveAliases[parsed.name] || parsed.name : typeName;
}

/** @description Reads an array's immediate element contract after removing only outer nullability. */
function elementTypeName(typeName)
{
    const parsed = typeof typeName === 'string' && readType(typeName);
    if(!parsed || parsed.end !== typeName.length)
    {
        return null;
    }

    const annotation = parsed.annotation.kind === 'nullable' ? parsed.annotation.element : parsed.annotation;
    return annotation.kind === 'array' ? renderType(annotation.element) : null;
}

/** @description Retains legacy bare rest-parameter checking while preserving explicit postfix-array element contracts. */
function restTypeName(typeName)
{
    return elementTypeName(typeName) === null ? 'Array' : `${typeName}[]`;
}

/** @description Maps one structural annotation to TypeScript, parenthesizing nullable array elements. */
function renderTsType(annotation)
{
    if(annotation.kind === 'named')
    {
        const name = primitiveAliases[annotation.name] || annotation.name;
        return tsTypeMap[name] || name;
    }

    const element = renderTsType(annotation.element);
    if(annotation.kind === 'nullable')
    {
        return `${element} | null`;
    }

    return annotation.element.kind === 'nullable' ? `(${element})[]` : `${element}[]`;
}

/** @description Maps an LGD annotation to TypeScript or JSDoc without erasing element types or nullability. */
function toTsType(typeName)
{
    const parsed = typeof typeName === 'string' && readType(typeName);
    return parsed && parsed.end === typeName.length ? renderTsType(parsed.annotation) : typeName;
}

/**
 * @description Reads one LGD type token without consuming comments, whitespace, or the following binding.
 * @param {string} text the source containing the token.
 * @param {number} index the token start.
 * @param {Object} options allows void or an uncapitalized first token when parsing method heads.
 * @returns {Object|null} the annotation and exact source span, or null for an invalid token.
 */
function parseTypeName(text, index = 0, options = {})
{
    const parsed = readType(text, index);
    if(!parsed)
    {
        return null;
    }

    const { annotation, end, name } = parsed;
    const typeName = text.slice(index, end);
    const malformed = (/[\w$&.<>?[\]|]/).test(text[end] || '');
    const invalidVoid = name === 'void' && (!options.allowVoid || annotation.kind !== 'named');
    const capitalized = (/(?:^|\.)[A-Z][\w$]*$/).test(name);
    const primitive = Object.hasOwn(primitiveAliases, name);
    if(malformed || invalidVoid || !capitalized && !primitive && !options.allowUncapitalized && !(options.allowVoid && name === 'void'))
    {
        return null;
    }

    return { typeName: typeName, baseTypeName: baseTypeName(typeName), nullable: isNullableType(typeName),
        annotation: annotation, start: index, end: end };
}

/**
 * @description Traverses the reusable annotation tree, including future named type arguments.
 * @param {Object} annotation the parsed type node.
 * @param {Function} visit the callback receiving each node.
 */
function visitType(annotation, visit)
{
    visit(annotation);
    const children = annotation.kind === 'named' ? annotation.typeArguments || [] : [annotation.element];
    for(const child of children)
    {
        visitType(child, visit);
    }
}

/** @description Compares annotation wrappers independently of leaf identity. */
function sameTypeShape(first, second)
{
    const left = typeof first === 'string' && readType(first);
    const right = typeof second === 'string' && readType(second);
    if(!left || !right || left.end !== first.length || right.end !== second.length)
    {
        return first === second;
    }

    let leftNode = left.annotation;
    let rightNode = right.annotation;
    while(leftNode.kind === rightNode.kind)
    {
        if(leftNode.kind === 'named')
        {
            return true;
        }

        leftNode = leftNode.element;
        rightNode = rightNode.element;
    }

    return false;
}

/**
 * @description Compares array contracts, retaining legacy unknown-element arrays and invariant mutable element types.
 * @param {string} expected the assignment contract.
 * @param {string} inferred the inferred array or value type.
 * @param {Function} compatible the existing scalar or nominal compatibility operation.
 * @param {boolean} fresh whether the value is a newly constructed literal with no shared mutable alias.
 * @returns {boolean|null} the array compatibility result, or null when neither side is an array.
 */
function arrayCompatibility(expected, inferred, compatible, fresh = false)
{
    const expectedElement = elementTypeName(expected);
    const actualElement = elementTypeName(inferred);
    if(expectedElement === null && actualElement === null)
    {
        return null;
    }

    if(baseTypeName(expected) === 'Array' || expectedElement !== null && inferred === 'Array')
    {
        return true;
    }

    if(expectedElement === null || actualElement === null)
    {
        return false;
    }

    if(actualElement === 'Unknown')
    {
        return true;
    }

    if(!fresh && !sameTypeShape(expectedElement, actualElement))
    {
        return false;
    }

    return compatible(expectedElement, actualElement) && (fresh || compatible(actualElement, expectedElement));
}

module.exports = {
    typeNamePattern: typeNamePattern,
    typeTokenPattern: typeTokenPattern,
    parseTypeName: parseTypeName,
    canonicalTypeName: canonicalTypeName,
    visitType: visitType,
    sameTypeShape: sameTypeShape,
    arrayCompatibility: arrayCompatibility,
    rootTypeName: rootTypeName,
    elementTypeName: elementTypeName,
    restTypeName: restTypeName,
    baseTypeName: baseTypeName,
    isNullableType: isNullableType,
    toTsType: toTsType,
    tsTypeMap: tsTypeMap,
    csharpTypeMap: csharpTypeMap
};
