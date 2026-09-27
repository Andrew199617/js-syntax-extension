const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const Types = require('./Types');

/** @description Bound inference through chains of local aliases. */
const MAX_ALIAS_DEPTH = 64;

/** @description Associate initializer expressions with their lexical bindings. */
function createAssignmentScopes(insideFunction, parameters, parameterTypes)
{
    const prefix = `async function inferred${parameters} {`;
    const source = `${prefix}${insideFunction}}`;
    const scopes = new Map();
    let parsedFunction;
    try
    {
        parsedFunction = parse(source, { plugins: ['jsx'], allowSuperOutsideMethod: true });
    }
    catch
    {
        return scopes;
    }

    let parameterScope;
    const scopeVisitor = {
        FunctionDeclaration(functionPath)
        {
            if(functionPath.node === parsedFunction.program.body[0])
            {
                parameterScope = functionPath.scope;
            }
        },
        AssignmentExpression(assignmentPath)
        {
            const expression = assignmentPath.node.right;
            const valueScope = {
                source: source,
                scope: assignmentPath.scope,
                position: expression.start,
                parameterScope: parameterScope,
                parameterTypes: parameterTypes,
                ancestors: new Set()
            };
            scopes.set(expression.start - prefix.length, valueScope);
            if(expression.type === 'ArrayExpression')
            {
                scopes.set(expression.start - prefix.length + 1, valueScope);
            }
        }
    };
    traverse(parsedFunction, scopeVisitor);
    return scopes;
}

/** @description Read a local declaration's explicit type using the existing JSDoc parser. */
async function getDeclarationType(binding, parser)
{
    const declaration = binding.path.parentPath;
    if(!declaration.isVariableDeclaration())
    {
        return null;
    }

    const comments = declaration.node.leadingComments || [];
    const jsdoc = comments.filter(comment => comment.type === 'CommentBlock' && comment.value.startsWith('*'));
    const options = {};
    for(const comment of jsdoc)
    {
        await parser.parseComment(`/*${comment.value}*/`, options);
    }

    if(options.type)
    {
        return parser.fixType(options.type);
    }

    return null;
}

/** @description Infer only initialized, unchanged bindings that precede their use. */
async function inferBinding(binding, valueScope, parser)
{
    if(binding.kind === 'param' && binding.scope === valueScope.parameterScope)
    {
        const annotation = valueScope.parameterTypes[binding.identifier.name];
        if(typeof annotation === 'string')
        {
            if(binding.path.isRestElement())
            {
                return parser.functionParser.getRestParameterType(annotation);
            }

            return annotation;
        }
    }

    if(binding.path.isVariableDeclarator() && binding.path.node.id.type === 'Identifier')
    {
        const declarationType = await getDeclarationType(binding, parser);
        if(declarationType)
        {
            return declarationType;
        }
    }

    if(!binding.constant)
    {
        return Types.ANY;
    }

    let initializer;
    if(binding.path.isVariableDeclarator() && binding.path.node.id.type === 'Identifier')
    {
        initializer = binding.path.node.init;
    }
    else if(binding.path.isAssignmentPattern() && binding.path.node.left.type === 'Identifier')
    {
        initializer = binding.path.node.right;
    }

    if(!initializer || initializer.end > valueScope.position)
    {
        return Types.ANY;
    }

    const initializerScope = {
        ...valueScope,
        scope: binding.path.scope,
        position: initializer.start,
        ancestors: new Set(valueScope.ancestors)
    };
    initializerScope.ancestors.add(binding);
    const expression = valueScope.source.slice(initializer.start, initializer.end);
    if(initializer.type === 'ArrayExpression')
    {
        return await parser.parseArray(expression.slice(1, -1), initializerScope);
    }

    return await parser.parseValue(expression, initializerScope);
}

/** @description Resolve local names before falling back to file-level constant inference. */
async function inferIdentifier(value, valueScope, parser)
{
    const binding = valueScope?.scope.getBinding(value);
    if(!binding)
    {
        return null;
    }

    if(valueScope.ancestors.has(binding) || valueScope.ancestors.size >= MAX_ALIAS_DEPTH)
    {
        return Types.ANY;
    }

    return await inferBinding(binding, valueScope, parser);
}

module.exports = { createAssignmentScopes: createAssignmentScopes, inferIdentifier: inferIdentifier };
