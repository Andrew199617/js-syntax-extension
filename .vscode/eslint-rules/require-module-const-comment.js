/** @import { Rule } from 'eslint' */
/** @import { VariableDeclarator } from 'estree' */

/** @description Metadata for the module-level constant documentation rule. */
export const meta = {
    type: 'suggestion',
    docs: { description: 'Require a comment immediately above module-level const declarations, except require imports.' },
    schema: [],
    messages: { missing: 'Add a descriptive comment above this module-level const declaration.' }
};

/**
 * @description Recognizes require imports, including destructuring and property access.
 * @param {VariableDeclarator} declaration Constant binding to inspect.
 * @returns {boolean} Whether the initializer imports a module or one of its properties.
 */
function isRequireImport(declaration)
{
    let initializer = declaration.init;
    while(initializer && initializer.type === 'MemberExpression')
    {
        initializer = initializer.object;
    }

    if(!initializer || initializer.type !== 'CallExpression')
    {
        return false;
    }

    const callee = initializer.callee;
    return callee.type === 'Identifier' && callee.name === 'require' && initializer.arguments.length === 1;
}

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

            if(node.declarations.every(isRequireImport))
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
