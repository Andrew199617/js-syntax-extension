/** @import { Rule } from 'eslint' */

/** @description Keeps each module in one style: functions, a class, or an OLOO object. */
export const meta = {
    type: 'suggestion',
    docs: { description: 'Use standalone functions, one class, or one OLOO object per file without mixing these styles.' },
    schema: [],
    messages: {
        mixed: 'Do not mix standalone functions with a class or OLOO object. Prefer moving related functions into the OLOO object as methods, or keep a separate functions-only module.',
        multiple: 'Define only one class or OLOO object per file. Move this definition into its own module.'
    }
};

function isFunction(node)
{
    return node && [ 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression' ].includes(node.type);
}

function isBehaviorObject(node)
{
    if(node.type !== 'ObjectExpression')
    {
        return false;
    }

    // Export bags such as { read, write } and plain configuration objects are not OLOO definitions.
    return node.properties.some(property => property.type === 'Property' && isFunction(property.value));
}

function isCommonJsExport(node)
{
    if(node.type !== 'MemberExpression')
    {
        return false;
    }

    if(node.object.type === 'Identifier' && node.object.name === 'exports')
    {
        return true;
    }

    if(node.object.type === 'Identifier' && node.object.name === 'module')
    {
        if(node.computed)
        {
            return node.property.type === 'Literal' && node.property.value === 'exports';
        }

        return node.property.name === 'exports';
    }

    return isCommonJsExport(node.object);
}

function collectDefinitions(node, definitions)
{
    if(!node)
    {
        return;
    }

    if(node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration')
    {
        collectDefinitions(node.declaration, definitions);
        return;
    }

    if(node.type === 'VariableDeclaration')
    {
        for(const declaration of node.declarations)
        {
            collectDefinitions(declaration.init, definitions);
        }

        return;
    }

    if(node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression')
    {
        const assignment = node.expression;
        if(isCommonJsExport(assignment.left))
        {
            collectDefinitions(assignment.right, definitions);
        }

        return;
    }

    if(isFunction(node))
    {
        definitions.functions.push(node);
        return;
    }

    if(node.type === 'ClassDeclaration' || node.type === 'ClassExpression' || isBehaviorObject(node))
    {
        definitions.owners.push(node);
    }
}

/**
 * @description Checks module definitions without treating method bodies or callbacks as separate module styles.
 * @param {Rule.RuleContext} context ESLint context.
 * @returns {Rule.RuleListener} Module visitor.
 */
export function create(context)
{
    function checkModule(program)
    {
        const definitions = { functions: [], owners: [] };
        for(const statement of program.body)
        {
            collectDefinitions(statement, definitions);
        }

        if(!definitions.owners.length)
        {
            return;
        }

        for(const standaloneFunction of definitions.functions)
        {
            context.report({ node: standaloneFunction, messageId: 'mixed' });
        }

        for(const additionalOwner of definitions.owners.slice(1))
        {
            context.report({ node: additionalOwner, messageId: 'multiple' });
        }
    }

    return { Program: checkModule };
}
