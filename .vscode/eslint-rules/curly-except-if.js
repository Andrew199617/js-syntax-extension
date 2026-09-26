import { Linter } from 'eslint';

/** @import { Rule } from 'eslint' */

/** @description Loads the core rules from the project's ESLint instance. */
const linter = new Linter();

/** @description Retains the built-in brace requirement for loops. */
const baseRule = linter.getRules().get('curly');

/** @description Uses the built-in curly rule metadata and options. */
export const meta = baseRule.meta;

/**
 * @description Leaves if chains to consistent-if-chain while preserving other curly checks.
 * @param {Rule.RuleContext} context ESLint context.
 * @returns {Rule.RuleListener} Non-if curly listeners.
 */
export function create(context)
{
    const listeners = baseRule.create(context);
    delete listeners.IfStatement;
    return listeners;
}
