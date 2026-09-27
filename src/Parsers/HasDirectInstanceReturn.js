const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

/** @description Limit retained method bodies across files and successive edits. */
const MAX_CACHE_ENTRIES = 100;

/** @description Avoid retaining unusually large method bodies in the shared cache. */
const MAX_CACHED_BODY_LENGTH = 100000;

/** @description Cache boolean results by exact method text; syntax trees are not retained. */
const instanceReturnCache = new Map();

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
function parseDirectInstanceReturn(insideFunction)
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

        /** @description Skips nested functions so their returns do not affect the enclosing method. */
        Function(functionPath)
        {
            functionPath.skip();
        },

        /** @description Stops traversal after finding a direct instance-creation return. */
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

/** @description Reuse results for unchanged method bodies, evicting the oldest entry when the cache is full. */
function hasDirectInstanceReturn(insideFunction)
{
    if(instanceReturnCache.has(insideFunction))
    {
        return instanceReturnCache.get(insideFunction);
    }

    const foundInstanceReturn = parseDirectInstanceReturn(insideFunction);
    if(insideFunction.length > MAX_CACHED_BODY_LENGTH)
    {
        return foundInstanceReturn;
    }

    if(instanceReturnCache.size >= MAX_CACHE_ENTRIES)
    {
        const oldestBody = instanceReturnCache.keys().next().value;
        instanceReturnCache.delete(oldestBody);
    }

    instanceReturnCache.set(insideFunction, foundInstanceReturn);
    return foundInstanceReturn;
}

module.exports = hasDirectInstanceReturn;
