/** @description Limits the supported glob language and the work required for each match. */
const limits = { pattern: 512, path: 8192 };

/**
 * @description Validates simple project-relative globs without executable or expanding syntax.
 * @param {string} pattern the configured glob.
 * @returns {boolean} whether the pattern uses the supported bounded syntax.
 */
function isValidPattern(pattern)
{
    if(typeof pattern !== 'string' || pattern.length === 0 || pattern.length > limits.pattern)
    {
        return false;
    }

    if(pattern.startsWith('/') || (/[!():[\\\]{}\p{Cc}]/u).test(pattern))
    {
        return false;
    }

    const normalized = pattern.startsWith('./') ? pattern.slice(2) : pattern;
    const segments = normalized.replace(/\/$/, '').split('/');
    return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..' && (!segment.includes('**') || segment === '**'));
}

/** @description Matches one path segment with dynamic programming, never a generated regular expression. */
function matchSegment(pattern, segment)
{
    const characters = [...segment];
    let previous = new Array(characters.length + 1).fill(false);
    previous[0] = true;
    for(const character of pattern)
    {
        const current = new Array(characters.length + 1).fill(false);
        current[0] = character === '*' && previous[0];
        for(let index = 1; index <= characters.length; index++)
        {
            if(character === '*')
            {
                current[index] = previous[index] || current[index - 1];
            }
            else
            {
                current[index] = previous[index - 1] && (character === '?' || character === characters[index - 1]);
            }
        }

        previous = current;
    }

    return previous[characters.length];
}

/**
 * @description Matches a slash-separated project path with *, ?, and full-segment ** globs.
 * @param {string} pattern the validated project-relative pattern.
 * @param {string} relativePath the slash-separated source path.
 * @returns {boolean} whether the whole source path matches.
 */
function matches(pattern, relativePath)
{
    if(!isValidPattern(pattern) || relativePath.length > limits.path)
    {
        return false;
    }

    let normalized = pattern.startsWith('./') ? pattern.slice(2) : pattern;
    if(normalized.endsWith('/'))
    {
        normalized += '**';
    }

    const segments = relativePath.split('/');
    let previous = new Array(segments.length + 1).fill(false);
    previous[0] = true;
    for(const patternSegment of normalized.split('/'))
    {
        const current = new Array(segments.length + 1).fill(false);
        current[0] = patternSegment === '**' && previous[0];
        for(let index = 1; index <= segments.length; index++)
        {
            if(patternSegment === '**')
            {
                current[index] = previous[index] || current[index - 1];
            }
            else
            {
                current[index] = previous[index - 1] && matchSegment(patternSegment, segments[index - 1]);
            }
        }

        previous = current;
    }

    return previous[segments.length];
}

module.exports = { isValidPattern: isValidPattern, matches: matches };
