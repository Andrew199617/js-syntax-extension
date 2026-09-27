/** @import { Rule } from 'eslint' */
/** @import { Node as AstNode } from 'estree' */

/** @type {Rule.RuleMetaData} */
export const meta = {
    type: 'layout',
    docs: { description: 'Separate expressions and variable declarations containing multiline callback arguments with one blank line.' },
    fixable: 'whitespace',
    schema: [],
    messages: { spacing: 'Expected exactly one blank line after a statement containing a multiline callback argument.' }
};

/**
 * @description Identifies inline function arguments that occupy more than one source line.
 * @param {AstNode} node Possible callback argument.
 * @returns {boolean} Whether the argument is a multiline function.
 */
function isMultilineCallback(node)
{
    if(node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression')
    {
        return false;
    }

    return node.loc.start.line !== node.loc.end.line;
}

/**
 * @description Checks callback calls within expressions and independently within nested statement lists.
 * @param {Rule.RuleContext} context ESLint rule context.
 * @returns {Rule.RuleListener} Statement list listeners.
 */
export function create(context)
{
    const source = context.sourceCode;
    const lineEnding = source.text.match(/(?<newline>\r\n|[\n\r\u2028\u2029])/u);
    const newline = lineEnding?.groups.newline || '\n';

    /**
     * @description Searches expression children without crossing into separate function or class bodies.
     * @param {AstNode} node Expression subtree.
     * @returns {boolean} Whether the expression contains a call with a multiline function argument.
     */
    function containsCallbackCall(node)
    {
        if(!node || node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression' || node.type === 'ClassExpression')
        {
            return false;
        }

        if(node.type === 'CallExpression' && node.arguments.some(isMultilineCallback))
        {
            return true;
        }

        for(const key of source.visitorKeys[node.type] || [])
        {
            const child = node[key];
            if(Array.isArray(child))
            {
                if(child.some(containsCallbackCall))
                {
                    return true;
                }
            }
            else if(child && containsCallbackCall(child))
            {
                return true;
            }
        }

        return false;
    }

    /**
     * @description Describes whitespace boundaries without including any comment text in a replacement.
     * @param {AstNode} statement Statement containing a callback.
     * @param {AstNode} following Next statement in the same list.
     * @returns {object[]} Whitespace gaps around intervening comments.
     */
    function statementGaps(statement, following)
    {
        const comments = source.getTokensBetween(statement, following, { includeComments: true });
        const boundaries = [ statement, ...comments, following ];
        const gaps = [];
        for(let i = 1; i < boundaries.length; i++)
        {
            const previous = boundaries[i - 1];
            const next = boundaries[i];
            const range = [ previous.range[1], next.range[0] ];
            const lineCount = next.loc.start.line - previous.loc.end.line;
            let indentation = source.text.slice(range[0], range[1]).match(/(?<indent>[ \t]*)$/u).groups.indent;
            if(lineCount === 0)
            {
                indentation = source.lines[next.loc.start.line - 1].match(/^(?<indent>[ \t]*)/u).groups.indent;
            }

            gaps.push({ range, lineCount, indentation });
        }

        return gaps;
    }

    /**
     * @description Reuses existing separation or adds it after the statement's trailing comments.
     * @param {AstNode} statement Statement containing a callback.
     * @param {AstNode} following Next statement in the same list.
     * @returns {void} Reports whitespace changes while retaining every comment.
     */
    function checkSpacing(statement, following)
    {
        const gaps = statementGaps(statement, following);
        let separator = gaps.find(gap => gap.lineCount > 1);
        if(!separator)
        {
            separator = gaps.find(gap => gap.lineCount > 0) || gaps.at(-1);
        }

        const replacements = [];
        for(const gap of gaps)
        {
            let expectedLines = gap.lineCount;
            if(gap === separator)
            {
                expectedLines = 2;
            }
            else if(gap.lineCount > 1)
            {
                expectedLines = 1;
            }

            if(gap.lineCount !== expectedLines)
            {
                replacements.push({ range: gap.range, text: newline.repeat(expectedLines) + gap.indentation });
            }
        }

        if(replacements.length === 0)
        {
            return;
        }

        /**
         * @description Adjusts only the whitespace between complete syntax nodes and comments.
         * @param {Rule.RuleFixer} fixer ESLint fix builder.
         * @returns {Rule.Fix[]} Nonoverlapping whitespace replacements.
         */
        function fixSpacing(fixer)
        {
            return replacements.map(replacement => fixer.replaceTextRange(replacement.range, replacement.text));
        }

        context.report({ node: following, messageId: 'spacing', fix: fixSpacing });
    }

    /**
     * @description Checks expression statements and variable initializers, including exported declarations.
     * @param {AstNode} statement Statement to inspect.
     * @returns {boolean} Whether the statement requires callback spacing.
     */
    function needsCallbackSpacing(statement)
    {
        if(statement.type === 'ExpressionStatement')
        {
            return containsCallbackCall(statement.expression);
        }

        let declaration = statement;
        if(statement.type === 'ExportNamedDeclaration')
        {
            declaration = statement.declaration;
        }

        return declaration?.type === 'VariableDeclaration' && declaration.declarations.some(variable => containsCallbackCall(variable.init));
    }

    /**
     * @description Checks adjacent statements without crossing block, switch case or class boundaries.
     * @param {AstNode} container Owner of a statement list.
     * @returns {void} Reports callback statements that need separation.
     */
    function checkStatementList(container)
    {
        let statements = container.body;
        if(container.type === 'SwitchCase')
        {
            statements = container.consequent;
        }

        for(let i = 0; i < statements.length - 1; i++)
        {
            const statement = statements[i];
            if(needsCallbackSpacing(statement))
            {
                checkSpacing(statement, statements[i + 1]);
            }
        }
    }

    return {
        'Program:exit': checkStatementList,
        'BlockStatement:exit': checkStatementList,
        'SwitchCase:exit': checkStatementList,
        'StaticBlock:exit': checkStatementList
    };
}
