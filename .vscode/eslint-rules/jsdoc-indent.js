/** @import { Rule } from 'eslint' */

/** @type {Rule.RuleMetaData} */
export const meta = {
    type: 'layout',
    docs: { description: 'Align standalone JSDoc comments with the code they document.' },
    fixable: 'whitespace',
    schema: [],
    messages: { alignment: 'Indent this JSDoc comment to match the following declaration.' }
};

/**
 * @description Checks standalone documentation indentation without changing inline type annotations.
 * @param {Rule.RuleContext} context ESLint rule context.
 * @returns {Rule.RuleListener} Comment validation listener.
 */
export function create(context)
{
    const source = context.sourceCode;
    return {
        'Program:exit'()
        {
            for(const comment of source.getAllComments())
            {
                if(comment.type !== 'Block' || !comment.value.startsWith('*'))
                {
                    continue;
                }

                const next = source.getTokenAfter(comment);
                const line = source.lines[comment.loc.start.line - 1];
                const indentation = line.slice(0, comment.loc.start.column);
                if(!next || next.loc.start.line <= comment.loc.end.line || (/\S/).test(indentation) || next.value === '}')
                {
                    continue;
                }

                const expected = source.lines[next.loc.start.line - 1].slice(0, next.loc.start.column);
                if((/\S/).test(expected) || indentation === expected)
                {
                    continue;
                }

                const range = [ comment.range[0] - indentation.length, comment.range[1] ];
                const original = source.text.slice(range[0], range[1]);
                const replacement = original.split('\n').map(lineText =>
                {
                    if(lineText.startsWith(indentation))
                    {
                        return expected + lineText.slice(indentation.length);
                    }

                    return lineText;
                })
                    .join('\n');
                context.report({ node: comment, messageId: 'alignment', fix: fixer => fixer.replaceTextRange(range, replacement) });
            }
        }
    };
}
