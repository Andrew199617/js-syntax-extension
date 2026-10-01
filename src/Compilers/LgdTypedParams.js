/*
 * Typed parameter parsing for LGD function initializers.
 *
 * Parses the leading parameter list of a function or arrow function initializer,
 * extracting LGD-style typed parameters like (Number value, String label = "x").
 * Offsets in the result are relative to the initializer text.
 */

/**
 * @description Skips whitespace starting at the given offset.
 * @param {string} text the text to scan.
 * @param {number} index the offset to start from.
 * @returns {number} the first non-whitespace offset at or after the start.
 */
function skipParamWhitespace(text, index)
{
    while(index < text.length && (/\s/).test(text[index]))
    {
        index++;
    }

    return index;
}

/**
 * @description Skips a keyword (async, function) when it appears as a whole word.
 * @param {string} text the text to scan.
 * @param {number} index the offset to start from.
 * @param {string} keyword the keyword to skip.
 * @returns {number} the offset past the keyword and trailing whitespace, or the start when absent.
 */
function skipParamKeyword(text, index, keyword)
{
    if(!text.startsWith(keyword, index))
    {
        return index;
    }

    const after = index + keyword.length;
    if(after < text.length && (/[\w$]/).test(text[after]))
    {
        return index;
    }

    return skipParamWhitespace(text, after);
}

/**
 * @description Finds the closing paren matching the opener, skipping string and comment contents.
 * @param {string} text the text to scan.
 * @param {number} openIndex the offset of the opening paren.
 * @returns {number} the offset of the matching close paren, or -1 when unbalanced.
 */
function findParamGroupEnd(text, openIndex)
{
    let depth = 0;
    let stringMode = null;
    for(let index = openIndex; index < text.length; index++)
    {
        const character = text[index];
        const next = index + 1 < text.length ? text[index + 1] : '';
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

        if(character === "'" || character === '"' || character === '`')
        {
            stringMode = character;
        }
        else if(character === '/' && next === '/')
        {
            const newline = text.indexOf('\n', index);
            index = newline === -1 ? text.length : newline;
        }
        else if(character === '/' && next === '*')
        {
            const close = text.indexOf('*/', index + 2);
            index = close === -1 ? text.length : close + 1;
        }
        else if(character === '(')
        {
            depth++;
        }
        else if(character === ')')
        {
            depth--;
            if(depth === 0)
            {
                return index;
            }
        }
    }

    return -1;
}

/**
 * @description Splits parameter text on top-level commas, tracking brackets and strings.
 * @param {string} inner the text between the parameter parens.
 * @param {number} baseOffset the offset of inner within the initializer text.
 * @returns {Array} the {text, start} chunks in order.
 */
function splitParamChunks(inner, baseOffset)
{
    const chunks = [];
    let depth = 0;
    let stringMode = null;
    let chunkStart = 0;
    for(let index = 0; index < inner.length; index++)
    {
        const character = inner[index];
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

        if(character === "'" || character === '"' || character === '`')
        {
            stringMode = character;
        }
        else if(character === '(' || character === '[' || character === '{')
        {
            depth++;
        }
        else if(character === ')' || character === ']' || character === '}')
        {
            depth--;
        }
        else if(character === ',' && depth === 0)
        {
            chunks.push({ text: inner.slice(chunkStart, index), start: baseOffset + chunkStart });
            chunkStart = index + 1;
        }
    }

    chunks.push({ text: inner.slice(chunkStart), start: baseOffset + chunkStart });
    return chunks;
}

/**
 * @description Reads one parameter chunk into a parameter record.
 * Unparseable chunks (destructuring, bare expressions) keep their raw text but no name.
 * @param {Object} chunk the {text, start} chunk.
 * @returns {Object} the {name, typeName, rest, defaultText, raw, typeStart, typeEnd} parameter;
 * typeStart/typeEnd are offsets in the initializer text, -1 when the parameter is untyped.
 */
function parseParamChunk(chunk)
{
    const text = chunk.text.trim();
    const unparsed = { name: null, typeName: null, rest: false, defaultText: null, raw: text, typeStart: -1, typeEnd: -1 };
    if(text === '')
    {
        return unparsed;
    }

    const match = (/^(?<rest>\.{3})?(?:(?<typeName>(?:[$A-Z_a-z][\w$]*\.)*[A-Z][\w$]*)\s+)?(?<name>[$A-Z_a-z][\w$]*)(?:\s*=(?<default>[\S\s]*))?$/).exec(text);
    if(!match)
    {
        return unparsed;
    }

    const typeName = match.groups.typeName || null;
    const parameter = {
        name: match.groups.name,
        typeName: typeName,
        rest: Boolean(match.groups.rest),
        defaultText: match.groups.default === undefined ? null : match.groups.default.trim(),
        raw: text,
        typeStart: -1,
        typeEnd: -1
    };

    if(typeName)
    {
        const leading = chunk.text.length - chunk.text.trimStart().length;
        parameter.typeStart = chunk.start + leading + text.indexOf(typeName);
        parameter.typeEnd = parameter.typeStart + typeName.length;
    }

    return parameter;
}

/**
 * @description Parses the leading parameter list of a function or arrow function initializer,
 * extracting LGD-style typed parameters like (Number value, String label = "x").
 * @param {string} initializerText the raw initializer text.
 * @returns {Object|null} the {start, end, params, hasTypes} group, or null when the initializer
 * does not open with a parenthesized parameter list. Offsets are relative to initializerText.
 */
function parseTypedParams(initializerText)
{
    const text = initializerText;
    let index = skipParamWhitespace(text, 0);
    index = skipParamKeyword(text, index, 'async');
    index = skipParamKeyword(text, index, 'function');
    if(text[index] === '*')
    {
        index = skipParamWhitespace(text, index + 1);
    }

    const nameMatch = (/^[$A-Z_a-z][\w$]*/).exec(text.slice(index));
    if(nameMatch && text[index] !== '(')
    {
        index = skipParamWhitespace(text, index + nameMatch[0].length);
    }

    if(text[index] !== '(')
    {
        return null;
    }

    const groupStart = index;
    const groupEnd = findParamGroupEnd(text, groupStart);
    if(groupEnd === -1)
    {
        return null;
    }

    const inner = text.slice(groupStart + 1, groupEnd);
    const params = splitParamChunks(inner, groupStart + 1).map(chunk => parseParamChunk(chunk));
    return {
        start: groupStart,
        end: groupEnd + 1,
        params: params,
        hasTypes: params.some(parameter => parameter.typeName !== null)
    };
}

/**
 * @description Splits an object literal body into its top-level member chunks,
 * tracking brackets, strings, comments, and template interpolations.
 * @param {string} text the trimmed object literal text, including its braces.
 * @returns {Array} the {text, start} chunks; start is relative to text.
 */
function splitTopLevelChunks(text)
{
    const chunks = [];
    const modes = ['code'];
    const templateDepths = [];
    let depth = 0;
    let chunkStart = 0;
    let index = 0;

    function commitChunk(endIndex)
    {
        chunks.push({ text: text.slice(chunkStart, endIndex), start: chunkStart });
    }

    while(index < text.length)
    {
        const mode = modes[modes.length - 1];
        const character = text[index];
        const next = index + 1 < text.length ? text[index + 1] : '';
        if(mode === 'code')
        {
            if(character === "'" || character === '"' || character === '`')
            {
                modes.push(character);
            }
            else if(character === '/' && next === '/')
            {
                modes.push('line');
                index++;
            }
            else if(character === '/' && next === '*')
            {
                modes.push('block');
                index++;
            }
            else if(character === '{' || character === '[' || character === '(')
            {
                depth++;
                if(depth === 1)
                {
                    chunkStart = index + 1;
                }
            }
            else if(character === '}' || character === ']' || character === ')')
            {
                depth--;
                if(depth === 0)
                {
                    commitChunk(index);
                }

                if(templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === depth)
                {
                    templateDepths.pop();
                    modes.pop();
                }
            }
            else if(character === ',' && depth === 1)
            {
                commitChunk(index);
                chunkStart = index + 1;
            }
        }
        else if(mode === '`')
        {
            if(character === '\\')
            {
                index++;
            }
            else if(character === '`')
            {
                modes.pop();
            }
            else if(character === '$' && next === '{')
            {
                templateDepths.push(depth);
                depth++;
                modes.push('code');
                index++;
            }
        }
        else if(mode === "'" || mode === '"')
        {
            if(character === '\\')
            {
                index++;
            }
            else if(character === mode)
            {
                modes.pop();
            }
        }
        else if(mode === 'line')
        {
            if(character === '\n')
            {
                modes.pop();
            }
        }
        else if(mode === 'block')
        {
            if(character === '*' && next === '/')
            {
                modes.pop();
                index++;
            }
        }

        index++;
    }

    return chunks;
}

/**
 * @description Finds the closing brace matching the opener, skipping string and comment contents.
 * @param {string} text the text to scan.
 * @param {number} openIndex the offset of the opening brace.
 * @returns {number} the offset of the matching close brace, or -1 when unbalanced.
 */
function findBraceGroupEnd(text, openIndex)
{
    let depth = 0;
    let stringMode = null;
    for(let index = openIndex; index < text.length; index++)
    {
        const character = text[index];
        const next = index + 1 < text.length ? text[index + 1] : '';
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

        if(character === "'" || character === '"' || character === '`')
        {
            stringMode = character;
        }
        else if(character === '/' && next === '/')
        {
            const newline = text.indexOf('\n', index);
            index = newline === -1 ? text.length : newline;
        }
        else if(character === '/' && next === '*')
        {
            const close = text.indexOf('*/', index + 2);
            index = close === -1 ? text.length : close + 1;
        }
        else if(character === '{')
        {
            depth++;
        }
        else if(character === '}')
        {
            depth--;
            if(depth === 0)
            {
                return index;
            }
        }
    }

    return -1;
}

/**
 * @description Reads the method name heading a member chunk, if it looks like a method definition.
 * @param {string} chunkText the raw member chunk text.
 * @returns {string|null} the method name, or null for properties, getters, and shorthand.
 */
function readMethodName(chunkText)
{
    const match = (/^(?:async\s+)?\*?\s*(?<name>[$A-Z_a-z][\w$]*)\s*\(/).exec(chunkText.trimStart());
    return match ? match.groups.name : null;
}

/**
 * @description Finds the body range of a method chunk starting after its parameter list.
 * @param {string} chunkText the raw member chunk text.
 * @param {number} fromIndex the offset just past the parameter group.
 * @returns {Object|null} the {start, end} body range relative to chunkText, or null when absent.
 */
function findMethodBodyRange(chunkText, fromIndex)
{
    let index = fromIndex;
    while(index < chunkText.length)
    {
        const character = chunkText[index];
        const next = index + 1 < chunkText.length ? chunkText[index + 1] : '';
        if((/\s/).test(character))
        {
            index++;
        }
        else if(character === '/' && next === '/')
        {
            const newline = chunkText.indexOf('\n', index);
            index = newline === -1 ? chunkText.length : newline;
        }
        else if(character === '/' && next === '*')
        {
            const close = chunkText.indexOf('*/', index + 2);
            index = close === -1 ? chunkText.length : close + 1;
        }
        else
        {
            break;
        }
    }

    if(chunkText[index] !== '{')
    {
        return null;
    }

    const end = findBraceGroupEnd(chunkText, index);
    return end === -1 ? null : { start: index, end: end + 1 };
}

/**
 * @description Parses typed parameter lists of object literal methods, like
 * create(String name) inside Object o = { create(String name) {} }.
 * @param {string} initializerText the raw initializer text.
 * @returns {Array} the method parameter groups with types: {name, start, end, params,
 * hasTypes, bodyStart, bodyEnd}; offsets are relative to initializerText.
 */
function parseObjectMethodParams(initializerText)
{
    const leading = initializerText.length - initializerText.trimStart().length;
    const text = initializerText.trim();
    if(text.length < 2 || text[0] !== '{' || text[text.length - 1] !== '}')
    {
        return [];
    }

    const groups = [];
    for(const chunk of splitTopLevelChunks(text))
    {
        const name = readMethodName(chunk.text);
        if(!name)
        {
            continue;
        }

        const parsed = parseTypedParams(chunk.text);
        if(!parsed || !parsed.hasTypes)
        {
            continue;
        }

        const body = findMethodBodyRange(chunk.text, parsed.end);
        if(!body)
        {
            continue;
        }

        const chunkOffset = leading + chunk.start;
        for(const parameter of parsed.params)
        {
            if(parameter.typeStart !== -1)
            {
                parameter.typeStart += chunkOffset;
                parameter.typeEnd += chunkOffset;
            }
        }

        groups.push({
            name: name,
            start: chunkOffset + parsed.start,
            end: chunkOffset + parsed.end,
            params: parsed.params,
            hasTypes: parsed.hasTypes,
            bodyStart: chunkOffset + body.start,
            bodyEnd: chunkOffset + body.end
        });
    }

    return groups;
}

module.exports = {
    parseTypedParams: parseTypedParams,
    parseObjectMethodParams: parseObjectMethodParams,
    splitTopLevelChunks: splitTopLevelChunks
};
