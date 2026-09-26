import { Linter } from 'eslint';

/** @import { Node as AstNode } from 'estree' */
/** @import { Rule } from 'eslint' */

/** @typedef {AstNode & {parent?: ChainNode}} ChainNode */

/** @description Loads the core rules from the project's ESLint instance. */
const linter = new Linter();

/** @description Reuses ESLint's method-chain detection and diagnostics. */
const baseRule = linter.getRules().get('newline-per-chained-call');

/** @type {Rule.RuleMetaData} */
export const meta = {
    ...baseRule.meta,
    deprecated: false,
    docs: { description: 'Keep method chains entirely inline or put every subsequent call on a new line.' },
    schema: []
};

/**
 * @description Finds the complete fluent chain without entering arguments or unrelated expressions.
 * @param {ChainNode} node Reported method property.
 * @returns {ChainNode} Outermost connected chain node.
 */
function completeChain(node)
{
    let current = node.parent;
    while(current.parent)
    {
        const parent = current.parent;
        const continuesChain = parent.type === 'ChainExpression'
            || parent.type === 'MemberExpression' && parent.object === current
            || parent.type === 'CallExpression' && parent.callee === current;
        if(!continuesChain)
        {
            break;
        }

        current = parent;
    }

    return current;
}

/**
 * @description Applies the built-in per-call check only to chains that span multiple lines.
 * @param {Rule.RuleContext} context Rule context.
 * @returns {Rule.RuleListener} Method-chain listeners.
 */
export function create(context)
{
    const source = context.sourceCode;
    const newline = source.text.match(/(?<newline>\r\n|[\n\r\u2028\u2029])/u)?.groups.newline || '\n';

    /**
     * @description Reports mixed chains and supplies an indented, comment-preserving fix.
     * @param {Rule.ReportDescriptor} descriptor Built-in diagnostic.
     * @returns {void} Reports missing line breaks in multiline chains.
     */
    function reportChain(descriptor)
    {
        const chain = completeChain(descriptor.node);
        if(chain.loc.start.line === chain.loc.end.line)
        {
            return;
        }

        const offset = source.getIndexFromLoc(descriptor.loc.start);
        const token = source.getTokenByRangeStart(offset);
        const previous = source.getTokenBefore(token, { includeComments: true });
        const indentation = source.lines[chain.loc.start.line - 1].match(/^(?<indentation>[ \t]*)/u).groups.indentation;

        /**
         * @description Separates the next method without modifying tokens or comment contents.
         * @param {Rule.RuleFixer} fixer Fix builder.
         * @returns {Rule.Fix} Whitespace replacement.
         */
        function fixChain(fixer)
        {
            return fixer.replaceTextRange([ previous.range[1], offset ], `${newline}${indentation}    `);
        }

        context.report({ ...descriptor, fix: fixChain });
    }

    const chainContext = Object.create(context, {
        options: { value: [{ ignoreChainWithDepth: 1 }] },
        report: { value: reportChain }
    });

    return baseRule.create(chainContext);
}
