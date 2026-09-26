/** @import { Rule } from 'eslint' */
/** @import { Comment } from 'estree' */

/** @description Requires JSDoc type imports to use top-level import declarations. */
export const meta = {
    type: 'suggestion',
    docs: { description: 'Use top-level JSDoc @import declarations instead of inline import() types.' },
    schema: [],
    messages: { inline: 'Use a top-level JSDoc @import declaration instead of an inline import() type.' }
};

/**
 * @description Finds import expressions inside balanced JSDoc type braces, excluding quoted literal types.
 * @param {Comment} comment JSDoc block to inspect.
 * @returns {number[]} Import offsets relative to the comment contents.
 */
function findInlineImports(comment)
{
    const imports = [];
    const typeTags = /@(?:param|arg|argument|returns?|type|typedef|property|prop|extends|augments|implements|this|throws|exception|enum|satisfies|template|yields?)\b[\s*]*\{/gu;
    for(const tag of comment.value.matchAll(typeTags))
    {
        const tokens = /(?<literal>'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`)|(?<opening>\{)|(?<closing>\})|(?<import>\bimport[\s*]*\()(?=[\s*]*['"])/gu;
        tokens.lastIndex = tag.index + tag[0].length;
        let depth = 1;
        let token;
        while(depth > 0 && (token = tokens.exec(comment.value)))
        {
            if(token.groups.opening)
            {
                depth++;
            }
            else if(token.groups.closing)
            {
                depth--;
            }
            else if(token.groups.import)
            {
                imports.push(token.index);
            }
        }
    }

    return imports;
}

/**
 * @description Reports inline type imports without changing runtime dynamic imports or examples in prose.
 * @param {Rule.RuleContext} context ESLint rule context.
 * @returns {Rule.RuleListener} JSDoc validation listener.
 */
export function create(context)
{
    const source = context.sourceCode;

    /** @description Checks type-bearing tags in every JSDoc block. */
    function checkComments()
    {
        for(const comment of source.getAllComments())
        {
            if(comment.type !== 'Block' || !comment.value.startsWith('*'))
            {
                continue;
            }

            const contentStart = comment.range[0] + '/*'.length;
            for(const offset of findInlineImports(comment))
            {
                const start = source.getLocFromIndex(contentStart + offset);
                const end = source.getLocFromIndex(contentStart + offset + 'import'.length);
                context.report({ loc: { start, end }, messageId: 'inline' });
            }
        }
    }

    return { 'Program:exit': checkComments };
}
