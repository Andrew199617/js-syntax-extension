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

/** @description Shared identifier-token syntax used before validating an annotation or method name. */
const typeTokenPattern = String.raw`[$A-Z_a-z][\w$]*(?:\.[$A-Z_a-z][\w$]*)*\??`;

/** @description Shared LGD value-type syntax, including qualified names and nullable suffixes. */
const typeNamePattern = String.raw`(?:[$A-Z_a-z][\w$]*\.)*[A-Z][\w$]*\??`;

/** @description Returns whether a source annotation explicitly includes null. */
function isNullableType(typeName)
{
    return typeof typeName === 'string' && typeName.endsWith('?');
}

/** @description Resolves the named component of an LGD nullable annotation. */
function baseTypeName(typeName)
{
    return isNullableType(typeName) ? typeName.slice(0, -1) : typeName;
}

/** @description Maps an LGD annotation to a TypeScript or JSDoc type, preserving null separately. */
function toTsType(typeName)
{
    const base = baseTypeName(typeName);
    const type = tsTypeMap[base] || base;
    return isNullableType(typeName) ? `${type} | null` : type;
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
    const match = new RegExp(`^${typeTokenPattern}`).exec(text.slice(index));
    if(!match)
    {
        return null;
    }

    const typeName = match[0];
    const end = index + typeName.length;
    const base = baseTypeName(typeName);
    if((/[\w$.?]/).test(text[end] || '') || base === 'void' && (!options.allowVoid || isNullableType(typeName)))
    {
        return null;
    }

    const capitalized = (/(?:^|\.)[A-Z][\w$]*$/).test(base);
    if(!capitalized && !options.allowUncapitalized && !(options.allowVoid && base === 'void'))
    {
        return null;
    }

    return { typeName: typeName, baseTypeName: base, nullable: isNullableType(typeName), start: index, end: end };
}

module.exports = {
    typeNamePattern: typeNamePattern,
    typeTokenPattern: typeTokenPattern,
    parseTypeName: parseTypeName,
    baseTypeName: baseTypeName,
    isNullableType: isNullableType,
    toTsType: toTsType,
    tsTypeMap: tsTypeMap,
    csharpTypeMap: csharpTypeMap
};
