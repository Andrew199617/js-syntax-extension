const { maskCode } = require('./LgdInfer');

/** @description A redundant documentation type is advisory and never blocks LGD emission. */
const message = 'Return type is already declared; the JSDoc type is not required.';

/**
 * @description Finds the exclusive end of a balanced JSDoc type expression.
 * @param {string} text the docblock text.
 * @param {number} start the opening brace offset.
 * @returns {number|null} the exclusive closing brace offset, or null when incomplete.
 */
function typeEnd(text, start)
{
    let depth = 0;
    let quote = null;
    for(let index = start; index < text.length; index++)
    {
        const character = text[index];
        if(quote)
        {
            if(character === '\\')
            {
                index++;
            }
            else if(character === quote)
            {
                quote = null;
            }
        }
        else if(character === '"' || character === "'")
        {
            quote = character;
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
                return index + 1;
            }
        }
    }

    return null;
}

/**
 * @description Warns only on attached source JSDoc types redundant with explicit named return syntax.
 * @param {string} content the original LGD source.
 * @param {Array} declarations the parsed LGD declarations.
 * @returns {Array} advisory diagnostics whose ranges cover only the braced JSDoc type.
 */
function check(content, declarations)
{
    const methods = declarations.flatMap(declaration => (declaration.methodTypedParams || [])
        .filter(group => group.returnTypeName)
        .map(group => declaration.initializerStart + group.methodStart));

    if(methods.length === 0)
    {
        return [];
    }

    const comments = [];
    maskCode(content, true, comments);
    const byEnd = new Map(comments.map(comment => [ comment.end, comment ]));
    const warnings = [];
    for(const methodStart of methods)
    {
        let before = methodStart;
        while(before > 0 && (/\s/).test(content[before - 1]))
        {
            before--;
        }

        const comment = byEnd.get(before);
        if(!comment)
        {
            continue;
        }

        const text = content.slice(comment.start, comment.end);
        const tags = /@returns?\b[\t ]*(?<open>{)/g;
        for(const tag of text.matchAll(tags))
        {
            const start = tag.index + tag[0].length - 1;
            const end = typeEnd(text, start);
            if(end !== null)
            {
                warnings.push({ severity: 'warning', message: message, offset: comment.start + start, endOffset: comment.start + end });
            }
        }
    }

    return warnings;
}

module.exports = { check: check };
