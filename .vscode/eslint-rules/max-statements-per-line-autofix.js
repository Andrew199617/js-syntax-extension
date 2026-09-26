import { Linter } from 'eslint';

/** @import { Rule } from 'eslint' */

/** @description Loads the core rules from the project's ESLint instance. */
const linter = new Linter();

/** @description Reuses ESLint's statement counting and rule options. */
const baseRule = linter.getRules().get('max-statements-per-line');

/** @type {Rule.RuleMetaData} */
export const meta = {
    ...baseRule.meta,
    deprecated: false,
    fixable: 'whitespace'
};

/**
 * @description Adds line breaks to the existing statement limit diagnostics.
 * @param {Rule.RuleContext} context ESLint rule context.
 * @returns {Rule.RuleListener} Statement validation listeners.
 */
export function create(context)
{
    const source = context.sourceCode;
    let newline = '\n';
    if(source.text.includes('\r\n'))
    {
        newline = '\r\n';
    }

    /**
     * @description Preserves the original diagnostic and separates its extra statement.
     * @param {Rule.ReportDescriptor} descriptor Original rule diagnostic.
     * @returns {void}
     */
    function reportWithFix(descriptor)
    {
        const statement = descriptor.node;
        const previous = source.getTokenBefore(statement, { includeComments: true });

        /**
         * @description Replaces only whitespace immediately before the extra statement.
         * @param {Rule.RuleFixer} fixer ESLint fix builder.
         * @returns {Rule.Fix | null} Safe line break, if needed.
         */
        function fixStatement(fixer)
        {
            if(!previous || previous.loc.end.line !== statement.loc.start.line)
            {
                return null;
            }

            const range = [ previous.range[1], statement.range[0] ];
            return fixer.replaceTextRange(range, newline);
        }

        context.report({ ...descriptor, fix: fixStatement });
    }

    const fixingContext = Object.create(context, {
        report: { value: reportWithFix }
    });
    return baseRule.create(fixingContext);
}
