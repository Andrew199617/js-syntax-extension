/*
 * Expression type inference for LGD.
 *
 * Masks string literals and comments, splits expressions by operator precedence,
 * and infers a nominal name, an LGD type keyword, Null, or Unknown for atomic
 * expressions. Inference is sound-but-partial: anything unknowable yields
 * Unknown, which never produces a type error.
 */

/** @description Marks an expression whose type cannot be determined; never an error. */
const UNKNOWN = 'Unknown';

/** @description Marks the null and undefined literals, assignable to every type in v1. */
const NULL = 'Null';

/** @description Splits first: the lowest-precedence binary operators. */
const precedenceCoalesce = 1;

/** @description Splits second: logical and. */
const precedenceAnd = 2;

/** @description Splits third: bitwise or. */
const precedenceBitwiseOr = 3;

/** @description Splits fourth: bitwise xor. */
const precedenceBitwiseXor = 4;

/** @description Splits fifth: bitwise and. */
const precedenceBitwiseAnd = 5;

/** @description Splits sixth: comparisons, instanceof, and in. */
const precedenceComparison = 6;

/** @description Splits seventh: bit shifts. */
const precedenceShift = 7;

/** @description Splits eighth: addition and subtraction. */
const precedenceAdditive = 8;

/** @description Splits last: multiplication, division, remainder, and exponent. */
const precedenceMultiplicative = 9;

/** @description Widest operator scanned (===, !==, >>>). */
const maxOperatorWidth = 3;


function maskCode(text)
{
    const output = [];
    let mode = 'code';
    for(let index = 0; index < text.length; index++)
    {
        const character = text[index];
        const next = index + 1 < text.length ? text[index + 1] : '';
        if(mode === 'code')
        {
            if(character === "'" || character === '"' || character === '`')
            {
                mode = character;
                output.push(character);
            }
            else if(character === '/' && next === '/')
            {
                mode = 'line';
                output.push(' ', ' ');
                index++;
            }
            else if(character === '/' && next === '*')
            {
                mode = 'block';
                output.push(' ', ' ');
                index++;
            }
            else
            {
                output.push(character);
            }
        }
        else if(mode === 'line')
        {
            if(character === '\n')
            {
                mode = 'code';
                output.push(character);
            }
            else
            {
                output.push(' ');
            }
        }
        else if(mode === 'block')
        {
            if(character === '*' && next === '/')
            {
                mode = 'code';
                output.push(' ', ' ');
                index++;
            }
            else
            {
                output.push(character === '\n' ? '\n' : ' ');
            }
        }
        else if(character === '\\')
        {
            output.push(' ', ' ');
            index++;
        }
        else if(character === mode)
        {
            mode = 'code';
            output.push(character);
        }
        else
        {
            output.push(character === '\n' ? '\n' : ' ');
        }
    }

    return output.join('');
}

/**
 * @description Strips one layer of redundant parentheses, such as ((x)) to (x).
 * @param {string} source the expression text.
 * @returns {string|null} the inner text, or null when the outer parens do not wrap everything.
 */
function unwrapParens(source)
{
    if(source[0] !== '(')
    {
        return null;
    }

    let depth = 0;
    for(let index = 0; index < source.length; index++)
    {
        if(source[index] === '(')
        {
            depth++;
        }
        else if(source[index] === ')')
        {
            depth--;
            if(depth === 0)
            {
                return index === source.length - 1 ? source.slice(1, -1) : null;
            }
        }
    }

    return null;
}

/**
 * @description Tells a ternary question mark apart from ?? and ?. at the given index.
 * @param {string} source the masked expression text.
 * @param {number} index the index of the question mark.
 * @returns {boolean} true when the mark starts a ternary.
 */
function isTernaryQuestion(source, index)
{
    return source[index + 1] !== '?' && source[index + 1] !== '.' && source[index - 1] !== '?';
}

/**
 * @description Finds the colon that matches a ternary question mark.
 * @param {string} source the masked expression text.
 * @param {number} questionIndex the index of the ternary question mark.
 * @returns {number} the colon index, or -1 when there is none.
 */
function findTernaryColon(source, questionIndex)
{
    let nested = 0;
    let depth = 0;
    for(let index = questionIndex + 1; index < source.length; index++)
    {
        const character = source[index];
        if(character === '(' || character === '[' || character === '{')
        {
            depth++;
        }
        else if(character === ')' || character === ']' || character === '}')
        {
            depth--;
        }
        else if(character === '?' && depth === 0 && isTernaryQuestion(source, index))
        {
            nested++;
        }
        else if(character === ':' && depth === 0)
        {
            if(nested === 0)
            {
                return index;
            }

            nested--;
        }
    }

    return -1;
}

/**
 * @description Splits a top-level ternary into its consequent and alternate branches.
 * @param {string} source the masked expression text.
 * @returns {Object|null} {consequent, alternate}, or null when there is no top-level ternary.
 */
function splitTernary(source)
{
    let depth = 0;
    for(let index = 0; index < source.length; index++)
    {
        const character = source[index];
        if(character === '(' || character === '[' || character === '{')
        {
            depth++;
        }
        else if(character === ')' || character === ']' || character === '}')
        {
            depth--;
        }
        else if(character === '?' && depth === 0 && isTernaryQuestion(source, index))
        {
            const colon = findTernaryColon(source, index);
            if(colon === -1)
            {
                return null;
            }

            return { consequent: source.slice(index + 1, colon), alternate: source.slice(colon + 1) };
        }
    }

    return null;
}

/**
 * @description Builds an operator match record; the length comes from the operator text.
 * @param {string} kind one of unknown, boolean, number, plus, arithmetic.
 * @param {string} operator the operator text.
 * @param {number} precedence the precedence rank; lower splits first.
 * @param {number} index the match index.
 * @returns {Object} the operator match record.
 */
function makeOperator(kind, operator, precedence, index)
{
    return { kind: kind, operator: operator, precedence: precedence, index: index, length: operator.length };
}

/**
 * @description Tells whether the character can be part of an identifier.
 * @param {string|undefined} character the character to test.
 * @returns {boolean} true for word characters and $.
 */
function isWordChar(character)
{
    return character !== undefined && (/[\w$]/).test(character);
}

/**
 * @description Tells whether a top-level + or - is binary rather than unary.
 * @param {string} source the masked expression text.
 * @param {number} index the index of the + or -.
 * @returns {boolean} true when the operator is binary.
 */
function isBinaryPlusMinus(source, index)
{
    let cursor = index - 1;
    while(cursor >= 0 && (/\s/).test(source[cursor]))
    {
        cursor--;
    }

    if(cursor < 0)
    {
        return false;
    }

    return (/[\w"$')\]\uE000]/).test(source[cursor]);
}

/**
 * @description Matches a binary operator at the given index of masked, depth-zero text.
 * @param {string} source the masked expression text.
 * @param {number} index the index to match at.
 * @returns {Object|null} the operator match record, or null.
 */
function matchOperator(source, index)
{
    const character = source[index];
    const two = source.slice(index, index + 2);
    const three = source.slice(index, index + maxOperatorWidth);
    if(three === '===' || three === '!==')
    {
        return makeOperator('boolean', three, precedenceComparison, index);
    }

    if(three === '>>>')
    {
        return makeOperator('number', '>>>', precedenceShift, index);
    }

    if(two === '??' || two === '||')
    {
        return makeOperator('unknown', two, precedenceCoalesce, index);
    }

    if(two === '&&')
    {
        return makeOperator('unknown', '&&', precedenceAnd, index);
    }

    if(two === '!=')
    {
        return makeOperator('boolean', '!=', precedenceComparison, index);
    }

    if(two === '==' && source[index + 2] !== '=')
    {
        return makeOperator('boolean', '==', precedenceComparison, index);
    }

    if(two === '<=' || two === '>=')
    {
        return makeOperator('boolean', two, precedenceComparison, index);
    }

    if(two === '<<' || two === '>>')
    {
        return makeOperator('number', two, precedenceShift, index);
    }

    if(two === '**')
    {
        return makeOperator('arithmetic', '**', precedenceMultiplicative, index);
    }

    if(character === 'i' && (/^instanceof(?![\w$])/).test(source.slice(index)) && !isWordChar(source[index - 1]))
    {
        return makeOperator('boolean', 'instanceof', precedenceComparison, index);
    }

    if(character === 'i' && (/^in(?![\w$])/).test(source.slice(index)) && !isWordChar(source[index - 1]))
    {
        return makeOperator('boolean', 'in', precedenceComparison, index);
    }

    if(character === '<')
    {
        return makeOperator('boolean', '<', precedenceComparison, index);
    }

    if(character === '>' && source[index - 1] !== '=')
    {
        return makeOperator('boolean', '>', precedenceComparison, index);
    }

    if(character === '*' || character === '/' || character === '%')
    {
        return makeOperator('arithmetic', character, precedenceMultiplicative, index);
    }

    if(character === '|' && source[index + 1] !== '|')
    {
        return makeOperator('number', '|', precedenceBitwiseOr, index);
    }

    if(character === '&' && source[index + 1] !== '&')
    {
        return makeOperator('number', '&', precedenceBitwiseAnd, index);
    }

    if(character === '^')
    {
        return makeOperator('number', '^', precedenceBitwiseXor, index);
    }

    if((character === '+' || character === '-') && isBinaryPlusMinus(source, index))
    {
        return makeOperator(character === '+' ? 'plus' : 'arithmetic', character, precedenceAdditive, index);
    }

    return null;
}

/**
 * @description Tells whether a found operator beats the current best split candidate.
 * @param {Object} found the new operator match record.
 * @param {Object|null} best the current best match record.
 * @returns {boolean} true when the new match should win.
 */
function isBetterSplit(found, best)
{
    if(!best)
    {
        return true;
    }

    if(found.precedence !== best.precedence)
    {
        return found.precedence < best.precedence;
    }

    return found.index > best.index;
}

/**
 * @description Finds the lowest-precedence top-level binary operator to split on.
 * @param {string} source the masked expression text.
 * @returns {Object|null} {kind, operator, left, right}, or null when there is no binary operator.
 */
function findSplit(source)
{
    let depth = 0;
    let best = null;
    let index = 0;
    while(index < source.length)
    {
        const character = source[index];
        if(character === '(' || character === '[' || character === '{')
        {
            depth++;
        }
        else if(character === ')' || character === ']' || character === '}')
        {
            depth--;
        }
        else if(depth === 0)
        {
            const found = matchOperator(source, index);
            if(found && isBetterSplit(found, best))
            {
                best = found;
            }

            if(found)
            {
                index += found.length;
                continue;
            }
        }

        index++;
    }

    if(!best)
    {
        return null;
    }

    return {
        kind: best.kind,
        operator: best.operator,
        left: source.slice(0, best.index),
        right: source.slice(best.index + best.length)
    };
}

/**
 * @description Tells whether the expression contains a top-level arrow, making it a function.
 * @param {string} source the masked expression text.
 * @returns {boolean} true when a depth-zero => is present.
 */
function hasTopLevelArrow(source)
{
    let depth = 0;
    for(let index = 0; index < source.length - 1; index++)
    {
        const character = source[index];
        if(character === '(' || character === '[' || character === '{')
        {
            depth++;
        }
        else if(character === ')' || character === ']' || character === '}')
        {
            depth--;
        }
        else if(character === '=' && source[index + 1] === '>' && depth === 0)
        {
            return true;
        }
    }

    return false;
}

/**
 * @description Infers the type of a single atomic expression: unary operators, literals, and names.
 * A bound name infers as its nominal name; keywordOf resolves it to a keyword when needed.
 * @param {string} source the masked, trimmed expression text with no top-level binary operator.
 * @param {Map} scope declared variable names to {keyword, readonly, kind} entries.
 * @returns {string} a nominal name, an LGD type keyword, Null, or Unknown.
 */
function inferAtomic(source, scope)
{
    if((/^typeof(?=[\s(])/).test(source))
    {
        return 'String';
    }

    if((/^void\b/).test(source))
    {
        return NULL;
    }

    if((/^delete\b/).test(source))
    {
        return 'Boolean';
    }

    if(source[0] === '!')
    {
        return 'Boolean';
    }

    if(source[0] === '\uE000' || source[source.length - 1] === '\uE000' || (/^[+~-]/).test(source))
    {
        return 'Number';
    }

    if((/^(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/).test(source) || (/^0[Xx][\dA-Fa-f]+$/).test(source))
    {
        return 'Number';
    }

    if((/^\d+n$/).test(source))
    {
        return 'BigInt';
    }

    if(source === 'true' || source === 'false')
    {
        return 'Boolean';
    }

    if(source === 'null' || source === 'undefined')
    {
        return NULL;
    }

    const first = source[0];
    const last = source[source.length - 1];
    const isQuoteMark = first === "'" || first === '"' || first === '`';
    if(isQuoteMark && first === last)
    {
        return 'String';
    }

    if(first === '[' && last === ']')
    {
        return 'Array';
    }

    if(first === '{' && last === '}')
    {
        return 'Object';
    }

    if((/^new\b/).test(source))
    {
        return 'Object';
    }

    if((/^Symbol\s*\(/).test(source))
    {
        return 'Symbol';
    }

    if((/^(?:async\s+)?function\b/).test(source) || (/^class\b/).test(source) || hasTopLevelArrow(source))
    {
        return 'Function';
    }

    if((/^[$A-Z_a-z][\w$]*$/).test(source))
    {
        return scope.has(source) ? source : UNKNOWN;
    }

    return UNKNOWN;
}


/**
 * @description Resolves an inferred type token to its keyword for keyword-level comparison.
 * Bound names and cross-file exports resolve through their entries; keywords, Null,
 * and Unknown pass through unchanged.
 * @param {string} inferred the inferred nominal name, keyword, Null, or Unknown.
 * @param {Map} scope declared variable names to {keyword, readonly, kind} entries.
 * @param {Map} externalsByName cross-file export names to {keyword, kind} entries.
 * @returns {string} the keyword, Null, or Unknown.
 */
function keywordOf(inferred, scope, externalsByName)
{
    if(inferred === UNKNOWN || inferred === NULL)
    {
        return inferred;
    }

    const entry = scope.get(inferred) || externalsByName.get(inferred);
    return entry ? entry.keyword : inferred;
}

/**
 * @description Infers the LGD type of an expression, or Unknown when it cannot be known.
 * Bound names infer nominally; use keywordOf to compare against keywords.
 * @param {string} text the masked expression text.
 * @param {Map} scope declared variable names to {keyword, readonly, kind} entries.
 * @param {Map} externalsByName cross-file export names to {keyword, kind} entries.
 * @returns {string} a nominal name, an LGD type keyword, Null, or Unknown.
 */
function inferExpression(text, scope, externalsByName)
{
    const normalized = text.trim().replace(/\+\+|--/g, '\uE000');
    if(normalized === '')
    {
        return UNKNOWN;
    }

    if((/^\/[^*/]/).test(normalized))
    {
        return UNKNOWN;
    }

    const unwrapped = unwrapParens(normalized);
    if(unwrapped !== null)
    {
        return inferExpression(unwrapped, scope, externalsByName);
    }

    const ternary = splitTernary(normalized);
    if(ternary)
    {
        const consequent = inferExpression(ternary.consequent, scope, externalsByName);
        const alternate = inferExpression(ternary.alternate, scope, externalsByName);
        if(consequent === alternate)
        {
            return consequent;
        }

        const consequentKeyword = keywordOf(consequent, scope, externalsByName);
        const alternateKeyword = keywordOf(alternate, scope, externalsByName);
        return consequentKeyword !== UNKNOWN && consequentKeyword === alternateKeyword ? consequentKeyword : UNKNOWN;
    }

    const split = findSplit(normalized);
    if(split)
    {
        if(split.kind === 'unknown')
        {
            return UNKNOWN;
        }

        if(split.kind === 'boolean')
        {
            return 'Boolean';
        }

        if(split.kind === 'number')
        {
            return 'Number';
        }

        const leftType = keywordOf(inferExpression(split.left, scope, externalsByName), scope, externalsByName);
        const rightType = keywordOf(inferExpression(split.right, scope, externalsByName), scope, externalsByName);
        if(split.operator === '+')
        {
            if(leftType === 'Number' && rightType === 'Number')
            {
                return 'Number';
            }

            return leftType === 'String' || rightType === 'String' ? 'String' : UNKNOWN;
        }

        return leftType === 'Number' && rightType === 'Number' ? 'Number' : UNKNOWN;
    }

    return inferAtomic(normalized, scope);
}


module.exports = {
    UNKNOWN: UNKNOWN,
    NULL: NULL,
    inferExpression: inferExpression,
    maskCode: maskCode
};
