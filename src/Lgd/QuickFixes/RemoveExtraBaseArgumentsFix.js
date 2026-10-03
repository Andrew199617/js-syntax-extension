const { parseExpression } = require('@babel/parser');
const DiagnosticQuickFix = require('./DiagnosticQuickFix');

/** @description Removes only an explicitly selected extra suffix without comments or effects. */
class RemoveExtraBaseArgumentsFix extends DiagnosticQuickFix
{
    constructor() { super('removeExtraBaseArguments'); }

    /** @description Proposes a minimal argument suffix deletion without changing required arguments. */
    createProposal(context, fix)
    {
        const { source, snapshots } = context;
        if(!this.onlyDiscardableLiterals(source.text.slice(fix.offset, fix.endOffset)))
        {
            return null;
        }

        return { title: 'Remove extra arguments from base call', target: source, snapshots: snapshots,
            offset: fix.offset, endOffset: fix.endOffset, newText: '' };
    }

    /** @description Allows explicit removal of primitive literals while preserving comments and evaluation effects. */
    onlyDiscardableLiterals(text)
    {
        try
        {
            const expression = parseExpression(`[${text}]`);
            if(expression.comments?.length > 0)
            {
                return false;
            }

            const literals = new Set([ 'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral' ]);
            if(expression.elements.length === 0)
            {
                return false;
            }

            return expression.elements.every((element, index) =>
            {
                if(element === null)
                {
                    return index === 0 && text.trimStart().startsWith(',');
                }

                if(literals.has(element.type))
                {
                    return true;
                }

                if(element.type !== 'UnaryExpression' || ![ '+', '-' ].includes(element.operator))
                {
                    return false;
                }

                return element.argument.type === 'NumericLiteral' || element.operator === '-' && element.argument.type === 'BigIntLiteral';
            });
        }
        catch
        {
            return false;
        }
    }
}

module.exports = RemoveExtraBaseArgumentsFix;
