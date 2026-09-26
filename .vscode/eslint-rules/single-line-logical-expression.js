/** @import { Rule } from 'eslint' */
/** @import { ConditionalExpression } from 'estree' */
/** @import { LogicalExpression } from 'estree' */
/** @import { Node as AstNode } from 'estree' */

/** @description Default maximum source column for boolean expressions. */
const DEFAULT_MAX_LENGTH = 180;

/** @description Maximum compound ternary length before its condition needs extraction. */
const DEFAULT_MAX_TERNARY_LENGTH = 120;

/** @description Requires readable logical expressions that fit on one line. */
export const meta = {
    type: 'suggestion',
    docs: { description: 'Extract named values instead of wrapping or exceeding the line limit with logical expressions.' },
    schema: [{
        type: 'object',
        properties: {
            maxLength: { type: 'integer', minimum: 1 },
            maxTernaryLength: { type: 'integer', minimum: 1 }
        },
        additionalProperties: false
    }],
    messages: {
        simplify: 'Keep && and || expressions on one line within the configured line limit. Extract a meaningful variable or helper to simplify this expression.',
        compoundCondition: 'This ternary exceeds the configured maxTernaryLength. Extract its compound condition into a meaningful variable or helper.'
    }
};

/**
 * @description Checks outer boolean expressions without offering a behavior-changing automatic extraction.
 * @param {Rule.RuleContext} context Rule context.
 * @returns {Rule.RuleListener} Logical expression listener.
 */
export function create(context)
{
    const maxLength = context.options[0]?.maxLength || DEFAULT_MAX_LENGTH;
    const maxTernaryLength = context.options[0]?.maxTernaryLength || DEFAULT_MAX_TERNARY_LENGTH;

    /**
     * @description Reports wrapped or overly long boolean expressions once per connected chain.
     * @param {LogicalExpression & {parent: AstNode}} node Logical expression.
     * @returns {void} Reports expressions that need simplification.
     */
    function checkExpression(node)
    {
        if(node.operator !== '&&' && node.operator !== '||')
        {
            return;
        }

        const parent = node.parent;
        if(parent.type === 'LogicalExpression' && (parent.operator === '&&' || parent.operator === '||'))
        {
            return;
        }

        if(node.loc.start.line !== node.loc.end.line || node.loc.end.column > maxLength)
        {
            context.report({ node, messageId: 'simplify' });
        }
    }

    /**
     * @description Requires a named condition when a compound ternary exceeds the configured character limit.
     * @param {ConditionalExpression} node Ternary expression.
     * @returns {void} Reports compound conditions, including negated groups.
     */
    function checkTernary(node)
    {
        if(context.sourceCode.getText(node).length <= maxTernaryLength)
        {
            return;
        }

        let condition = node.test;
        while(condition.type === 'UnaryExpression')
        {
            condition = condition.argument;
        }

        if(condition.type === 'LogicalExpression' && (condition.operator === '&&' || condition.operator === '||'))
        {
            context.report({ node: node.test, messageId: 'compoundCondition' });
        }
    }

    return { LogicalExpression: checkExpression, ConditionalExpression: checkTernary };
}
