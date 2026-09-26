/** @import { IfStatement } from 'estree' */
/** @import { SourceCode } from 'eslint' */
/** @import { Statement } from 'estree' */
/** @import { Token } from 'estree' */
/** @import { Rule } from 'eslint' */
/** @import { Node as AstNode } from 'estree' */

/** @description Requires expanded if chains for blocks and direct control-flow exits. */
export const meta = {
    type: 'layout',
    docs: { description: 'Expand every branch when an if chain contains braces or directly controls return, break, continue, or throw.' },
    fixable: 'code',
    schema: [],
    messages: { consistent: 'Use expanded braces for every branch of this if / else chain.' }
};

/**
 * @description Collects branch bodies and else keywords without entering nested branch statements.
 * @param {IfStatement} root First if statement.
 * @param {SourceCode} source Parsed source.
 * @returns {{ bodies: Statement[], alternatives: Token[] }} Chain members.
 */
function collectChain(root, source)
{
    const bodies = [];
    const alternatives = [];
    let current = root;
    while(current)
    {
        bodies.push(current.consequent);
        if(!current.alternate)
        {
            break;
        }

        alternatives.push(source.getTokenAfter(current.consequent));
        if(current.alternate.type !== 'IfStatement')
        {
            bodies.push(current.alternate);
            break;
        }

        current = current.alternate;
    }

    return { bodies, alternatives };
}

/**
 * @description Detects declarations whose scope could change when wrapped in a block.
 * @param {Statement} body Branch body.
 * @returns {boolean} Whether automatic wrapping is unsafe.
 */
function hasUnsafeDeclaration(body)
{
    if(body.type === 'FunctionDeclaration')
    {
        return true;
    }

    if(body.type === 'IfStatement')
    {
        return hasUnsafeDeclaration(body.consequent) || Boolean(body.alternate && hasUnsafeDeclaration(body.alternate));
    }

    const wrappedStatements = [
        'LabeledStatement',
        'WithStatement',
        'WhileStatement',
        'DoWhileStatement',
        'ForStatement',
        'ForInStatement',
        'ForOfStatement'
    ];
    if(wrappedStatements.includes(body.type))
    {
        return hasUnsafeDeclaration(body.body);
    }

    return false;
}

/**
 * @description Identifies branch bodies that require expanded braces throughout their chain.
 * @param {Statement} body Direct branch statement.
 * @returns {boolean} Whether the branch requires Allman braces.
 */
function requiresExpansion(body)
{
    const expandedStatements = [ 'BlockStatement', 'ReturnStatement', 'BreakStatement', 'ContinueStatement', 'ThrowStatement' ];
    return expandedStatements.includes(body.type);
}

/**
 * @description Checks each complete chain and changes only whitespace or surrounding braces.
 * @param {Rule.RuleContext} context Rule context.
 * @returns {Rule.RuleListener} Chain visitor.
 */
export function create(context)
{
    const source = context.sourceCode;
    const lineEnding = source.text.match(/(?<newline>\r\n|[\n\r\u2028\u2029])/u);
    const newline = lineEnding?.groups.newline || '\n';

    /**
     * @description Keeps same-line trailing comments attached to the wrapped statement.
     * @param {Statement} body Branch statement.
     * @returns {number} Insertion offset after the statement and its trailing comments.
     */
    function wrappingEnd(body)
    {
        let last = source.getLastToken(body);
        let next = source.getTokenAfter(last, { includeComments: true });
        while(next && (next.type === 'Line' || next.type === 'Block') && next.loc.start.line === last.loc.end.line)
        {
            last = next;
            next = source.getTokenAfter(last, { includeComments: true });
        }

        return last.range[1];
    }

    /**
     * @description Plans whitespace edits before a token without touching comments or existing line breaks.
     * @param {Token} token Token to place on a separate line.
     * @param {string} indentation Desired leading whitespace.
     * @param {Rule.Fix[]} edits Planned replacements.
     * @returns {void}
     */
    function separateToken(token, indentation, edits)
    {
        const previous = source.getTokenBefore(token, { includeComments: true });
        if(previous.loc.end.line === token.loc.start.line)
        {
            edits.push({ range: [ previous.range[1], token.range[0] ], text: newline + indentation });
        }
    }

    /**
     * @description Builds nonoverlapping boundary edits for one branch.
     * @param {Statement} body Branch statement.
     * @param {string} indentation Chain indentation.
     * @param {Rule.Fix[]} edits Planned replacements.
     * @returns {void}
     */
    function expandBody(body, indentation, edits)
    {
        if(body.type !== 'BlockStatement')
        {
            const previous = source.getTokenBefore(body, { includeComments: true });
            edits.push({ range: [ previous.range[1], body.range[0] ], text: `${newline}${indentation}{${newline}${indentation}    ` });
            const end = wrappingEnd(body);
            edits.push({ range: [ end, end ], text: `${newline}${indentation}}` });
            return;
        }

        const opening = source.getFirstToken(body);
        const closing = source.getLastToken(body);
        separateToken(opening, indentation, edits);
        const first = source.getTokenAfter(opening, { includeComments: true });
        if(first !== closing)
        {
            separateToken(first, `${indentation}    `, edits);
        }

        separateToken(closing, indentation, edits);
    }

    /**
     * @description Reports the outermost member of each inconsistent chain once.
     * @param {IfStatement & {parent: AstNode}} node If statement.
     * @returns {void}
     */
    function checkChain(node)
    {
        if(node.parent.type === 'IfStatement' && node.parent.alternate === node)
        {
            return;
        }

        const chain = collectChain(node, source);
        if(!chain.bodies.some(requiresExpansion))
        {
            return;
        }

        const indentation = source.lines[node.loc.start.line - 1].match(/^(?<indentation>\s*)/u).groups.indentation;
        const edits = [];
        for(const body of chain.bodies)
        {
            expandBody(body, indentation, edits);
        }

        for(const alternative of chain.alternatives)
        {
            separateToken(alternative, indentation, edits);
        }

        if(!edits.length)
        {
            return;
        }

        /**
         * @description Applies boundary changes unless adding scope could affect declarations.
         * @param {Rule.RuleFixer} fixer Fix builder.
         * @returns {Rule.Fix[] | null} Safe replacements.
         */
        function fixChain(fixer)
        {
            if(chain.bodies.some(hasUnsafeDeclaration))
            {
                return null;
            }

            return edits.map(edit => fixer.replaceTextRange(edit.range, edit.text));
        }

        context.report({ node, messageId: 'consistent', fix: fixChain });
    }

    return { IfStatement: checkChain };
}
