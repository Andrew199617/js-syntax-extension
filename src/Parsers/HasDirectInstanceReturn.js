const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

/** @description Recognizes calls to the instance creation methods supported by the object parser. */
function isInstanceCreation(expression)
{
    if(expression?.type !== 'CallExpression')
    {
        return false;
    }

    const callee = expression.callee;
    if(callee.type !== 'MemberExpression' || callee.computed)
    {
        return false;
    }

    if(callee.object.type !== 'Identifier' || callee.property.type !== 'Identifier')
    {
        return false;
    }

    const supportedObject = [ 'Object', 'Oloo' ].includes(callee.object.name);
    const supportedMethod = [ 'create', 'assign', 'assignSlow', 'createSlow' ].includes(callee.property.name);
    return supportedObject && supportedMethod;
}

/**
 * @description Finds direct instance returns in the current method, excluding comments, literals, and nested functions.
 * @param {string} insideFunction The body of the create method.
 * @returns {boolean} Whether the method directly returns an instance creation call.
 */
function hasDirectInstanceReturn(insideFunction)
{
    const parseOptions = {
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        plugins: ['jsx']
    };
    let parsedBody;
    try
    {
        parsedBody = parse(insideFunction, parseOptions);
    }
    catch
    {
        return false;
    }

    let foundInstanceReturn = false;
    const returnVisitor = {
        noScope: true,
        Function(functionPath)
        {
            functionPath.skip();
        },
        ReturnStatement(returnPath)
        {
            if(isInstanceCreation(returnPath.node.argument))
            {
                foundInstanceReturn = true;
                returnPath.stop();
            }
        }
    };
    traverse(parsedBody, returnVisitor);
    return foundInstanceReturn;
}

module.exports = hasDirectInstanceReturn;
