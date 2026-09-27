const { parse, parseExpression } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const Types = require('./Types');

/** @description Limit how many variables we follow when one variable refers to another. */
const MAX_ALIAS_DEPTH = 64;

/** @description Record the parameters and local variables available at each assignment. */
function createAssignmentContexts(insideFunction, parameters, parameterTypes)
{
    const prefix = `async function inferred${parameters} {`;
    const source = `${prefix}${insideFunction}}`;
    const assignmentContexts = new Map();
    let parsedFunction;
    try
    {
        parsedFunction = parse(source, { plugins: ['jsx'], allowSuperOutsideMethod: true });
    }
    catch
    {
        return assignmentContexts;
    }

    let parameterScope;
    const assignmentVisitor = {
        /** @description Remember which function owns the documented parameters. */
        FunctionDeclaration(functionPath)
        {
            if(functionPath.node === parsedFunction.program.body[0])
            {
                parameterScope = functionPath.scope;
            }
        },

        /** @description Record the variables available where this value is assigned. */
        AssignmentExpression(assignmentPath)
        {
            const expression = assignmentPath.node.right;
            const inferenceContext = {
                source: source,
                scope: assignmentPath.scope,
                expression: expression,
                position: expression.start,
                parameterScope: parameterScope,
                parameterTypes: parameterTypes,
                ancestors: new Set()
            };
            assignmentContexts.set(assignmentPath.node.start - prefix.length, inferenceContext);
        }
    };
    traverse(parsedFunction, assignmentVisitor);
    return assignmentContexts;
}

/**
 * @description Read the type written in a local variable's JSDoc comment.
 * @this {FileParserType}
 */
async function getDeclarationType(binding)
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
        await this.parseComment(`/*${comment.value}*/`, options);
    }

    if(options.type)
    {
        return this.fixType(options.type);
    }

    return null;
}

/**
 * @description Use parameter types or infer local variables from values assigned before use and never reassigned.
 * @this {FileParserType}
 */
async function inferBinding(binding)
{
    const inferenceContext = this.inferenceContext;
    if(binding.kind === 'param' && binding.scope === inferenceContext.parameterScope)
    {
        const annotation = inferenceContext.parameterTypes[binding.identifier.name];
        if(typeof annotation === 'string')
        {
            if(binding.path.isRestElement())
            {
                return this.functionParser.getRestParameterType(annotation);
            }

            return annotation;
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

    if(!initializer || initializer.end > inferenceContext.position)
    {
        return Types.ANY;
    }

    const declarationType = await getDeclarationType.call(this, binding);
    if(declarationType)
    {
        return declarationType;
    }

    const initializerContext = {
        ...inferenceContext,
        scope: binding.path.scope,
        expression: initializer,
        position: initializer.start,
        ancestors: new Set(inferenceContext.ancestors)
    };
    initializerContext.ancestors.add(binding);
    return await this.parseInitializer(initializerContext);
}

/**
 * @description Look up a name among the current function's parameters and local variables.
 * @this {FileParserType}
 */
async function inferIdentifier(value)
{
    const inferenceContext = this.inferenceContext;
    if(!inferenceContext)
    {
        return null;
    }

    let expression;
    try
    {
        expression = parseExpression(value, { plugins: ['jsx'] });
    }
    catch
    {
        return null;
    }

    if(expression.type !== 'Identifier')
    {
        return null;
    }

    const binding = inferenceContext.scope.getBinding(expression.name);
    if(!binding)
    {
        return null;
    }

    if(inferenceContext.ancestors.has(binding) || inferenceContext.ancestors.size >= MAX_ALIAS_DEPTH)
    {
        return Types.ANY;
    }

    return await inferBinding.call(this, binding);
}

module.exports = { createAssignmentContexts: createAssignmentContexts, inferIdentifier: inferIdentifier };
