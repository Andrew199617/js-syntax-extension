const parser = require('@babel/parser');
const { maskCode } = require('./LgdInfer');
const { collectScopes, collectBindings } = require('./LgdBaseChecker');
const { parseTypedParams } = require('./LgdTypedParams');

/** @description Finds balanced parentheses while preserving original parameter text. */
function closingParenthesis(masked, start)
{
    let depth = 0;
    for(let index = start; index < masked.length; index++)
    {
        if(masked[index] === '(')
        {
            depth++;
        }
        else if(masked[index] === ')')
        {
            depth--;
            if(depth === 0)
            {
                return index;
            }
        }
    }

    return -1;
}

/** @description Extracts names from ordinary JavaScript parameter binding patterns. */
function parameterNames(parameter)
{
    if(parameter.name)
    {
        return [parameter.name];
    }

    let tree;
    try
    {
        tree = parser.parse(`function _(${parameter.raw || ''}) {}`);
    }
    catch
    {
        return [];
    }

    const names = [];
    const pending = [...tree.program.body[0].params];
    while(pending.length > 0)
    {
        const pattern = pending.pop();
        if(pattern?.type === 'Identifier')
        {
            names.push(pattern.name);
        }
        else if(pattern?.type === 'RestElement')
        {
            pending.push(pattern.argument);
        }
        else if(pattern?.type === 'AssignmentPattern')
        {
            pending.push(pattern.left);
        }
        else if(pattern?.type === 'ArrayPattern')
        {
            pending.push(...pattern.elements);
        }
        else if(pattern?.type === 'ObjectPattern')
        {
            const propertyBindings = pattern.properties.map(property =>
            {
                if(property.type === 'RestElement')
                {
                    return property.argument;
                }

                return property.value;
            });

            pending.push(...propertyBindings);
        }
    }

    return names;
}

/** @description Locates the beginning of an arrow parameter list in masked source. */
function arrowParameters(masked, arrowStart)
{
    const prefix = masked.slice(0, arrowStart).trimEnd();
    if(prefix.endsWith(')'))
    {
        let depth = 0;
        for(let index = prefix.length - 1; index >= 0; index--)
        {
            if(prefix[index] === ')')
            {
                depth++;
            }
            else if(prefix[index] === '(')
            {
                depth--;
                if(depth === 0)
                {
                    return { start: index, end: prefix.length, parenthesized: true };
                }
            }
        }
    }

    const identifier = (/(?<name>[$A-Z_a-z][\w$]*)$/).exec(prefix);
    return identifier ? { start: identifier.index, end: prefix.length, parenthesized: false } : null;
}

/** @description Adds ordinary destructured variable declarations as lexical shadows. */
function addDestructuredBindings(scan)
{
    const { content, masked, scopes, bindings } = scan;
    const variables = /\b(?:const|let|var)\s*(?<open>[[{])/g;
    for(const match of masked.matchAll(variables))
    {
        const start = match.index + match[0].length - 1;
        let cursor = start;
        let depth = 0;
        do
        {
            if(masked[cursor] === '{' || masked[cursor] === '[')
            {
                depth++;
            }
            else if(masked[cursor] === '}' || masked[cursor] === ']')
            {
                depth--;
            }

            cursor++;
        }
        while(depth > 0 && cursor < masked.length);

        if(depth !== 0)
        {
            continue;
        }

        const scope = scopes.filter(candidate => candidate.start < match.index && match.index < candidate.end)
            .sort((left, right) => right.start - left.start)[0];

        const raw = content.slice(start, cursor);
        for(const name of parameterNames({ raw: raw }))
        {
            bindings.push({ name: name, offset: match.index, scope: scope, declaration: { typeName: 'Unknown' } });
        }
    }
}

/** @description Adds parameters of methods and ordinary functions to lexical contract resolution. */
function addParameterBindings(scan)
{
    const { content, masked, declarations, scopes, bindings } = scan;
    const groups = declarations.flatMap(declaration =>
    {
        const members = (declaration.classMembers || []).filter(member => !member.abstract)
            .map(member => ({ params: member.params || [], start: member.paramStart, bodyEnd: member.bodyEnd }));

        const typed = (declaration.methodTypedParams || []).filter(group => !group.abstract)
            .map(group => ({ params: group.params || [], start: declaration.initializerStart + group.start, bodyEnd: declaration.initializerStart + group.bodyEnd }));

        return [ ...members, ...typed ];
    });

    const functions = /\bfunction\s*\*?\s*(?:[$A-Z_a-z][\w$]*\s*)?\(/g;
    for(const match of masked.matchAll(functions))
    {
        const start = match.index + match[0].length - 1;
        const end = closingParenthesis(masked, start);
        if(end === -1)
        {
            continue;
        }

        const after = masked.slice(end + 1);
        const trivia = (/^\s*/).exec(after)[0].length;
        const bodyStart = end + 1 + trivia;
        const scope = scopes.find(candidate => candidate.start === bodyStart);
        if(scope)
        {
            groups.push({ params: parseTypedParams(content.slice(start, end + 1))?.params || [], start: start, bodyStart: bodyStart, bodyEnd: scope.end });
        }
    }

    const methods = /(?<prefix>[,{])\s*(?:(?:async|get|set)\s+)?\*?\s*(?<name>[$A-Z_a-z][\w$]*)\s*\(/g;
    for(const match of masked.matchAll(methods))
    {
        const start = match.index + match[0].length - 1;
        const end = closingParenthesis(masked, start);
        if(end === -1)
        {
            continue;
        }

        const bodyStart = end + 1 + (/^\s*/).exec(masked.slice(end + 1))[0].length;
        const scope = scopes.find(candidate => candidate.start === bodyStart);
        if(scope)
        {
            groups.push({ params: parseTypedParams(content.slice(start, end + 1))?.params || [], start: start, bodyEnd: scope.end });
        }
    }

    for(const arrow of masked.matchAll(/=>/g))
    {
        const parameters = arrowParameters(masked, arrow.index);
        if(!parameters)
        {
            continue;
        }

        const parameterText = content.slice(parameters.start, parameters.end);
        const params = parseTypedParams(parameters.parenthesized ? parameterText : `(${parameterText})`)?.params || [];
        const bodyStart = arrow.index + arrow[0].length + (/^\s*/).exec(masked.slice(arrow.index + arrow[0].length))[0].length;
        const scope = scopes.find(candidate => candidate.start === bodyStart);
        const nextStatement = masked.indexOf(';', bodyStart);
        const end = nextStatement === -1 ? masked.length : nextStatement;
        groups.push({ params: params, start: parameters.start - 1, bodyEnd: scope?.end ?? end });
    }

    for(const group of groups)
    {
        for(const parameter of group.params)
        {
            for(const name of parameterNames(parameter))
            {
                bindings.push({ name: name, offset: group.start, scope: { start: group.start, end: group.bodyEnd }, declaration: { typeName: 'Unknown' } });
            }
        }
    }
}

/**
 * @description Extends shared lexical bindings with parameters and destructured JavaScript declarations.
 * @param {string} content the LGD document.
 * @param {Array} declarations all parsed declarations.
 * @param {Map} externals relative export metadata.
 * @returns {Array} lexical bindings used for contract checking.
 */
function collectContractBindings(content, declarations, externals)
{
    const masked = maskCode(content, true);
    const scopes = collectScopes(masked);
    const bindings = collectBindings({ content: content, masked: masked, declarations: declarations, scopes: scopes, externals: externals });
    addParameterBindings({ content: content, masked: masked, declarations: declarations, scopes: scopes, bindings: bindings });
    addDestructuredBindings({ content: content, masked: masked, scopes: scopes, bindings: bindings });
    return bindings;
}

module.exports = { collectContractBindings: collectContractBindings };
