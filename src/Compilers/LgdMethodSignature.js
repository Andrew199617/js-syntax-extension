const { parseTypeName, isNullableType } = require('./LgdTypeMaps');

/**
 * @description Skips leading whitespace and comments, returning the offset of the first code character.
 * Object members often carry JSDoc blocks; the method name and parameter list follow them.
 * @param {string} text the text to scan.
 * @param {number} index the offset to start from.
 * @returns {number} the first offset at or after the start that is not whitespace or a comment.
 */
function skipTrivia(text, index)
{
    while(index < text.length)
    {
        const character = text[index];
        const next = index + 1 < text.length ? text[index + 1] : '';
        if((/\s/).test(character))
        {
            index++;
        }
        else if(character === '/' && next === '/')
        {
            const newline = text.indexOf('\n', index);
            index = newline === -1 ? text.length : newline + 1;
        }
        else if(character === '/' && next === '*')
        {
            const close = text.indexOf('*/', index + 2);
            index = close === -1 ? text.length : close + 2;
        }
        else
        {
            break;
        }
    }

    return index;
}

/**
 * @description Reads a named method head with an optional return type, preserving token offsets.
 * @param {string} text the method source.
 * @returns {Object|null} the signature head, or null when this is not a named method.
 */
function parseMethodHead(text)
{
    let index = skipTrivia(text, 0);
    let modifier = null;
    const modifierMatch = (/^(?:async|get|set)\b/).exec(text.slice(index));
    if(modifierMatch)
    {
        const after = skipTrivia(text, index + modifierMatch[0].length);
        if(text[after] !== '(')
        {
            modifier = modifierMatch[0];
            index = after;
        }
    }

    const generator = text[index] === '*';
    if(generator)
    {
        index = skipTrivia(text, index + 1);
    }

    const firstStart = index;
    const first = parseTypeName(text, index, { allowVoid: true, allowUncapitalized: true });
    if(!first)
    {
        return null;
    }

    let name = first.typeName;
    let nameStart = index;
    let returnTypeName = null;
    index = skipTrivia(text, index + name.length);
    if(text[index] !== '(')
    {
        const second = (/^[$A-Z_a-z][\w$]*/).exec(text.slice(index));
        if(!second)
        {
            return null;
        }

        returnTypeName = name;
        name = second[0];
        nameStart = index;
        index = skipTrivia(text, index + name.length);
    }

    if(text[index] !== '(' || name.includes('.') || name.includes('[') || isNullableType(name))
    {
        return null;
    }

    return {
        name: name,
        nameStart: nameStart,
        nameEnd: nameStart + name.length,
        paramStart: index,
        modifier: modifier,
        async: modifier === 'async',
        generator: generator,
        returnTypeName: returnTypeName,
        returnTypeStart: returnTypeName ? firstStart : -1,
        returnTypeEnd: returnTypeName ? firstStart + returnTypeName.length : -1
    };
}

module.exports = { skipTrivia: skipTrivia, parseMethodHead: parseMethodHead };
