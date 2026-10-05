const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const LgdCompiler = require('../../Compilers/LgdCompiler');

/** @description Removes a redundant terminal this return or retains the constructor's early exit. */
class ReplaceConstructorReturnThisFix extends DiagnosticQuickFix
{
    constructor() { super('replaceConstructorReturnThis', true); }

    /** @description Revalidates the exact constructor return before replacing only a proven this expression. */
    createProposal(context, fix)
    {
        const { source, state, snapshots } = context;
        if(fix.kind !== this.kind)
        {
            return null;
        }

        const checked = LgdCompiler.create().parse(source.text, state.externals);
        const fields = [ 'kind', 'declarationStart', 'memberStart', 'offset', 'endOffset' ];
        const diagnostic = checked.errors.find(error =>
        {
            const matchingError = error.code === 'lgd.constructor.returnValue' && error.quickFix;
            return matchingError && fields.every(field => error.quickFix[field] === fix[field]);
        });

        if(!diagnostic)
        {
            return null;
        }

        const removeStatement = diagnostic.quickFix.removeStatement;
        const title = removeStatement ? 'Remove redundant return this' : 'Replace return this with an early exit';
        let edit = { offset: fix.offset, endOffset: fix.endOffset, newText: 'return;' };
        if(removeStatement)
        {
            edit = this.removalEdit(source.text, diagnostic.quickFix, checked);
        }

        return { title: title, target: source, snapshots: snapshots, ...edit };
    }

    /** @description Cleans only the whitespace left between a removed terminal return and its own closing brace. */
    removalEdit(source, fix, checked)
    {
        const edit = { offset: fix.offset, endOffset: fix.endOffset, newText: '' };
        const declaration = checked.declarations.find(entry => entry.headStart === fix.declarationStart);
        const member = declaration?.classMembers.find(entry => entry.start === fix.memberStart);
        const closing = member?.bodyEnd - 1;
        if(source[closing] !== '}' || !(/^\s*$/u).test(source.slice(fix.endOffset, closing)))
        {
            return edit;
        }

        while(edit.offset > member.bodyStart + 1 && (/\s/u).test(source[edit.offset - 1]))
        {
            edit.offset--;
        }

        edit.endOffset = closing;
        const whitespace = source.slice(edit.offset, fix.offset) + source.slice(fix.endOffset, closing);
        const newline = whitespace.match(/\r\n|\n|\r/u)?.[0];
        if(newline)
        {
            const indentation = source.slice(fix.endOffset, closing).match(/[^\S\r\n]*$/u)[0];
            edit.newText = newline + indentation;
        }
        else
        {
            edit.newText = whitespace.length > 0 ? ' ' : '';
        }

        return edit;
    }
}

module.exports = ReplaceConstructorReturnThisFix;
