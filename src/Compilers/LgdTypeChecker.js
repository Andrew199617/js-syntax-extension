/*
 * Type checking for LGD typed declarations.
 *
 * v1 is deliberately sound-but-partial: every inference rule is either exact for
 * JavaScript semantics or yields Unknown, and Unknown never produces an error. A
 * missed bug (false negative) is acceptable; a false alarm (false positive) is not,
 * because compiler errors now suppress the .js output write on save.
 *
 * Checked: initializer expressions against the declared type keyword, later
 * assignments to declared variables, and assignments to readonly variables.
 *
 * Never an error in v1: null and undefined assigned to any type (nullable Type?
 * syntax is planned), unknowable expressions (calls, member access, unbound
 * identifiers, regex literals), Object as a top type, and shadowing by non-LGD
 * bindings outside the modeled cases in checkAssignments.
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

/** @description Characters kept before an assigned name to detect let, const, and var. */
const lookbehindWidth = 16;

/** @description Longest assigned value scanned; longer values stay Unknown. */
const maxValueLength = 500;

/** @description Widest operator scanned (===, !==, >>>). */
const maxOperatorWidth = 3;

/**
 * @description Blanks string literals, template literals, and comments while preserving offsets.
 * @param {string} text the source text to mask.
 * @returns {string} the masked text, the same length as the input.
 */
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
 * @param {string} source the masked, trimmed expression text with no top-level binary operator.
 * @param {Map} scope declared variable names to {type, readonly} entries.
 * @returns {string} an LGD type keyword, Null, or Unknown.
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
        const entry = scope.get(source);
        return entry ? entry.type : UNKNOWN;
    }

    return UNKNOWN;
}

/**
 * @description Infers the LGD type keyword of an expression, or Unknown when it cannot be known.
 * @param {string} text the masked expression text.
 * @param {Map} scope declared variable names to {type, readonly} entries.
 * @returns {string} an LGD type keyword, Null, or Unknown.
 */
function inferExpression(text, scope)
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
        return inferExpression(unwrapped, scope);
    }

    const ternary = splitTernary(normalized);
    if(ternary)
    {
        const consequent = inferExpression(ternary.consequent, scope);
        const alternate = inferExpression(ternary.alternate, scope);
        return consequent !== UNKNOWN && consequent === alternate ? consequent : UNKNOWN;
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

        const leftType = inferExpression(split.left, scope);
        const rightType = inferExpression(split.right, scope);
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

/**
 * @description Tells whether an inferred type can be assigned to a declared type.
 * @param {string} declaredKeyword the declared LGD type keyword.
 * @param {string} inferredKeyword the inferred LGD type keyword, Null, or Unknown.
 * @returns {boolean} true when the assignment is allowed.
 */
function isAssignable(declaredKeyword, inferredKeyword)
{
    if(inferredKeyword === UNKNOWN || inferredKeyword === NULL)
    {
        return true;
    }

    if(declaredKeyword === 'Object')
    {
        return true;
    }

    return declaredKeyword === inferredKeyword;
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
        .map(part => part.trim().split('=')[0].trim().replace(/^\.{3}/, ''))
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
        .filter(declaration => declaration.typeKeyword === 'Function')
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

    if(isShadowedByParam(scan.functions, nameStart, name))
    {
        return true;
    }

    return isShadowingDeclaration(scan.masked, nameStart);
}

/**
 * @description Checks plain assignments to declared variables after their declaration.
 * @param {string} masked the masked source text; offsets map 1:1 to the original.
 * @param {Array} declarations the parsed declarations in document order.
 * @param {Map} scope declared variable names to {type, readonly} entries.
 * @param {Array} errors the error list to append to.
 * @returns {void}
 */
function checkAssignments(masked, declarations, scope, errors)
{
    const names = Array.from(scope.keys());
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
        const valueText = masked.slice(valueStart, findValueEnd(masked, valueStart)).trim();
        if(valueText === '')
        {
            continue;
        }

        const entry = scope.get(name);
        const inferred = inferExpression(valueText, scope);
        if(entry.readonly)
        {
            errors.push({ message: `Cannot assign to readonly variable '${name}'.`, offset: nameStart });
        }
        else if(!isAssignable(entry.type, inferred))
        {
            errors.push({ message: `Cannot assign ${inferred} to ${entry.type}.`, offset: valueStart });
        }
    }
}

/**
 * @description Checks declarations for type mismatches and readonly violations.
 * @param {string} content the LGD source text.
 * @param {Array} declarations the parsed declarations in document order.
 * @returns {Array} errors as {message, offset} pairs; the caller attaches line numbers.
 */
function checkTypes(content, declarations)
{
    const errors = [];
    const scope = new Map();
    const masked = maskCode(content);

    for(const declaration of declarations)
    {
        const initializer = content.slice(declaration.initializerStart, declaration.initializerEnd);
        if(initializer.trim() !== '')
        {
            const maskedInitializer = masked.slice(declaration.initializerStart, declaration.initializerEnd).trim();
            const inferred = inferExpression(maskedInitializer, scope);
            if(!isAssignable(declaration.typeKeyword, inferred))
            {
                const valueOffset = declaration.initializerStart + (initializer.length - initializer.trimStart().length);
                errors.push({ message: `Cannot assign ${inferred} to ${declaration.typeKeyword}.`, offset: valueOffset });
            }
        }

        scope.set(declaration.name, { type: declaration.typeKeyword, readonly: declaration.readonly });
    }

    checkAssignments(masked, declarations, scope, errors);
    return errors;
}

module.exports = {
    checkTypes: checkTypes
};
