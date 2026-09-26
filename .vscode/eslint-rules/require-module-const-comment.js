/** @import { Rule } from 'eslint' */

/** @description Metadata for the module-level constant documentation rule. */
export const meta = {
    type: 'suggestion',
    docs: { description: 'Require a comment immediately above every module-level const declaration.' },
    schema: [],
    messages: { missing: 'Add a descriptive comment above this module-level const declaration.' }
};

/**
 * @description Checks documentation on module-level constants, including exported declarations.
 * @param {Rule.RuleContext} context ESLint rule context.
 * @returns {Rule.RuleListener} Constant validation listener.
 */
export function create(context)
{
    const source = context.sourceCode;
    return {
        VariableDeclaration(node)
        {
            if(node.kind !== 'const')
            {
                return;
            }

            let declaration = node;
            if(node.parent.type === 'ExportNamedDeclaration')
            {
                declaration = node.parent;
            }

            if(declaration.parent.type !== 'Program')
            {
                return;
            }

            const comment = source.getTokenBefore(declaration, { includeComments: true });
            if(comment && (comment.type === 'Line' || comment.type === 'Block'))
            {
                const text = comment.value.replace(/\*/g, '').trim();
                const prefix = source.lines[comment.loc.start.line - 1].slice(0, comment.loc.start.column);
                const isDirective = (/^(?:eslint(?:-|\s|$)|global(?:s)?(?:\s|$)|exported(?:\s|$))/).test(text);
                if(text && !isDirective && !prefix.trim() && comment.loc.end.line === declaration.loc.start.line - 1)
                {
                    return;
                }
            }

            context.report({ node, messageId: 'missing' });
        }
    };
}
