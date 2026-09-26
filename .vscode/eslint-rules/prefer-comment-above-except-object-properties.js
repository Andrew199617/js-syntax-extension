import { Linter } from 'eslint';

/** @import { Rule } from 'eslint' */

/** @description Loads the core rules from the project's ESLint instance. */
const linter = new Linter();

/** @description Built-in comment placement rule extended with an object property exception. */
const baseRule = linter.getRules().get('line-comment-position');

/** @description ESLint metadata inherited from the underlying comment placement rule. */
export const meta = baseRule.meta;

/**
 * @description Allows trailing comments on object properties while retaining the standard comment position checks elsewhere.
 * @param {Rule.RuleContext} context ESLint rule context.
 * @returns {Rule.RuleListener} Comment validation listener.
 */
export function create(context)
{
    const source = context.sourceCode;

    /**
     * @description Reports misplaced comments unless they follow a completed object property.
     * @param {Rule.ReportDescriptor} descriptor Standard rule diagnostic.
     */
    function reportComment(descriptor)
    {
        const comment = descriptor.node;
        let previous = source.getTokenBefore(comment);
        if(previous?.value === ',')
        {
            previous = source.getTokenBefore(previous);
        }

        if(previous && previous.loc.end.line === comment.loc.start.line)
        {
            let node = source.getNodeByRangeIndex(previous.range[0]);
            while(node && node.range[1] === previous.range[1])
            {
                if((node.type === 'Property' || node.type === 'SpreadElement') && node.parent.type === 'ObjectExpression')
                {
                    return;
                }

                node = node.parent;
            }
        }

        context.report(descriptor);
    }

    const commentContext = Object.create(context, {
        report: { value: reportComment }
    });

    return baseRule.create(commentContext);
}
