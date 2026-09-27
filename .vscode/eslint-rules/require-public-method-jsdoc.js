import { parse } from 'comment-parser';

/** @import { Rule } from 'eslint' */
/** @import { Block, Spec } from 'comment-parser' */
/** @import { MethodDefinition, Property, PropertyDefinition, Pattern } from 'estree' */

/** @description Requires descriptions and all-or-none parameter documentation on public methods. */
export const meta = {
    type: 'suggestion',
    docs: { description: 'Require multiline public methods to have JSDoc with a description and either all parameter tags or none.' },
    schema: [],
    messages: {
        missing: 'Add JSDoc with a description to this public method.',
        description: 'Add a nonempty description to this public method\'s JSDoc.',
        parameters: 'Document every parameter with a matching @param tag, or omit all @param tags.'
    }
};

/**
 * @description Recognizes private member syntax, underscore names, and explicit JSDoc access markers.
 * @param {MethodDefinition | Property | PropertyDefinition} node Method or function-valued property.
 * @param {Block | undefined} documentation Parsed JSDoc.
 */
function isPrivateMethod(node, documentation)
{
    if(node.key.type === 'PrivateIdentifier')
    {
        return true;
    }

    let name;
    if(!node.computed && node.key.type === 'Identifier')
    {
        name = node.key.name;
    }
    else if(node.key.type === 'Literal' && typeof node.key.value === 'string')
    {
        name = node.key.value;
    }

    if(name?.startsWith('_'))
    {
        return true;
    }

    return documentation?.tags.some(tag =>
    {
        if(tag.tag === 'access')
        {
            return tag.name === 'private' || tag.name === 'protected';
        }

        return tag.tag === 'private' || tag.tag === 'protected';
    });
}

/**
 * @description Accepts introductory prose or an explicit description tag.
 * @param {Block} documentation Parsed JSDoc.
 */
function hasDescription(documentation)
{
    if(documentation.description.trim())
    {
        return true;
    }

    return documentation.tags.some(tag =>
    {
        const isDescription = tag.tag === 'description' || tag.tag === 'desc';
        return isDescription && `${tag.name} ${tag.description}`.trim();
    });
}

/**
 * @description Reads named, defaulted, and rest parameters; destructuring uses a documented root name.
 * @param {Pattern} parameter Parameter binding.
 */
function getParameterName(parameter)
{
    if(parameter.type === 'AssignmentPattern')
    {
        return getParameterName(parameter.left);
    }

    if(parameter.type === 'RestElement')
    {
        return getParameterName(parameter.argument);
    }

    if(parameter.type === 'Identifier')
    {
        return parameter.name;
    }

    return null;
}

/**
 * @description Checks root parameter tags without counting optional property documentation as extra parameters.
 * @param {Pattern[]} parameters Method parameters.
 * @param {Spec[]} tags JSDoc tags.
 */
function hasCompleteParameters(parameters, tags)
{
    const parameterTags = tags.filter(tag => tag.tag === 'param' || tag.tag === 'arg' || tag.tag === 'argument');
    if(parameterTags.length === 0)
    {
        return true;
    }

    if(parameters.length === 0 || parameterTags.some(tag => !tag.name || tag.problems.length > 0))
    {
        return false;
    }

    const names = parameterTags.map(tag => tag.name.replace(/^\.\.\./u, ''));
    const rootNames = names.filter(name => !name.includes('.') && !name.includes('['));
    if(rootNames.length !== parameters.length || new Set(rootNames).size !== rootNames.length)
    {
        return false;
    }

    const hasDocumentedRoots = names.every(name =>
    {
        const [objectName] = name.split('.');
        const [rootName] = objectName.split('[');
        return rootNames.includes(rootName);
    });

    if(!hasDocumentedRoots)
    {
        return false;
    }

    return parameters.every(parameter =>
    {
        const name = getParameterName(parameter);
        return name === null || rootNames.includes(name);
    });
}

/**
 * @description Checks class methods, accessors, and function-valued class or object properties.
 * @param {Rule.RuleContext} context ESLint rule context.
 */
export function create(context)
{
    const source = context.sourceCode;

    /**
     * @description Validates the JSDoc attached to a public method without inventing documentation in an autofix.
     * @param {MethodDefinition | Property | PropertyDefinition} node Candidate member.
     */
    function checkMethod(node)
    {
        if(!node.value || node.value.type !== 'FunctionExpression' && node.value.type !== 'ArrowFunctionExpression')
        {
            return;
        }

        const comment = source.getTokenBefore(node, { includeComments: true });
        let documentation;
        if(comment?.type === 'Block' && comment.value.startsWith('*'))
        {
            [documentation] = parse(source.getText(comment));
        }

        if(isPrivateMethod(node, documentation))
        {
            return;
        }

        if(!documentation)
        {
            if(node.value.loc.start.line !== node.value.loc.end.line)
            {
                context.report({ node: node.key, messageId: 'missing' });
            }

            return;
        }

        if(!hasDescription(documentation))
        {
            context.report({ node: comment, messageId: 'description' });
        }

        if(!hasCompleteParameters(node.value.params, documentation.tags))
        {
            context.report({ node: comment, messageId: 'parameters' });
        }
    }

    return {
        MethodDefinition: checkMethod,
        PropertyDefinition: checkMethod,
        'ObjectExpression > Property': checkMethod
    };
}
