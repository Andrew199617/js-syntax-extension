/** @import { Rule } from 'eslint' */
/** @import { Node } from 'estree' */

/** @description Keeps module execution below function and class definitions. */
export const meta = {
    type: 'suggestion',
    docs: { description: 'Place top-level executable statements after function and class definitions. Imports, directives and variable declarations may appear above definitions.' },
    schema: [],
    messages: { misplaced: 'Place top-level executable statements after all function and class definitions.' }
};

/**
 * @description Recognizes direct function and class definitions, including variable initializers.
 * @param {Node} node Unwrapped top-level node.
 * @returns {boolean} Whether this node defines a function or class.
 */
function isDefinition(node)
{
    if(node.type === 'VariableDeclaration')
    {
        return node.declarations.some(declaration => declaration.init && isDefinition(declaration.init));
    }

    const definesFunction = node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';
    const definesClass = node.type === 'ClassDeclaration' || node.type === 'ClassExpression';
    return definesFunction || definesClass;
}

/**
 * @description Reports executable statements that precede a later top-level definition without reordering execution automatically.
 * @param {Rule.RuleContext} context ESLint rule context.
 * @returns {Rule.RuleListener} Module ordering listener.
 */
export function create(context)
{
    return {
        Program(program)
        {
            let hasLaterDefinition = false;
            for(let i = program.body.length - 1; i >= 0; i--)
            {
                const statement = program.body[i];
                let declaration = statement;
                if(statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration')
                {
                    if(!statement.declaration)
                    {
                        continue;
                    }

                    declaration = statement.declaration;
                }

                if(isDefinition(declaration))
                {
                    hasLaterDefinition = true;
                    continue;
                }

                const isModuleDeclaration = declaration.type === 'VariableDeclaration' || declaration.type === 'ImportDeclaration' || declaration.type === 'ExportAllDeclaration';
                if(isModuleDeclaration || declaration.type === 'EmptyStatement' || statement.directive)
                {
                    continue;
                }

                if(hasLaterDefinition)
                {
                    context.report({ node: statement, messageId: 'misplaced' });
                }
            }
        }
    };
}
