const SignatureTypeFix = require('./SignatureTypeFix');

/** @description Offers an explicit atomic parameter-and-return change only for a proven closed Number-to-String contract. */
class ChangeParameterAndReturnTypeFix extends SignatureTypeFix
{
    constructor() { super('changeParameterAndReturnType'); }

    /** @description Revalidates both annotations, all return paths, caller isolation, and the complete combined compiler preview. */
    async createProposal(context, fix)
    {
        const fields = [ 'kind',
            'declarationStart',
            'groupStart',
            'parameterName',
            'parameterOffset',
            'offset',
            'endOffset',
            'oldTypeName',
            'newTypeName',
            'assignmentStart',
            'assignmentEnd' ];
        const analysis = await this._analyze(context, fix, { code: 'lgd.assignment.typeMismatch',
            spanFields: [ 'assignmentStart', 'assignmentEnd' ], identityFields: fields });
        if(!analysis || analysis.group.returnTypeName !== 'Number')
        {
            return null;
        }

        const { source, snapshots, document, state, languageService } = context;
        const returnOffset = analysis.declaration.initializerStart + analysis.group.returnTypeStart;
        const returnEnd = analysis.declaration.initializerStart + analysis.group.returnTypeEnd;
        if(source.text.slice(returnOffset, returnEnd) !== 'Number')
        {
            return null;
        }

        const edit = this._signatureEdit(source.text, fix, returnOffset, returnEnd);
        const previewText = `${source.text.slice(0, edit.offset)}${edit.newText}${source.text.slice(edit.endOffset)}`;
        const preview = analysis.compiler.compileToJs(previewText, state.externals, analysis.options);
        const consistentReturns = this._stringReturns(preview, fix, previewText, state.externals);
        if(!consistentReturns || !this._validPreview(analysis, preview) || this._signatureTypeErrors(preview, analysis))
        {
            return null;
        }

        const title = this._titleWithRemaining(`Change parameter '${fix.parameterName}' and return type to String (changes signature)`, preview);
        return { title: title, target: source, snapshots: snapshots, ...edit,
            validate: () => this._isolatedDocument(document, languageService) };
    }

    /** @description Copies one minimal signature span and replaces only its two proven annotation tokens. */
    _signatureEdit(source, fix, returnOffset, returnEnd)
    {
        const offset = Math.min(returnOffset, fix.offset);
        const endOffset = Math.max(returnEnd, fix.endOffset);
        let newText = source.slice(offset, endOffset);
        const tokens = [ { start: returnOffset, end: returnEnd }, { start: fix.offset, end: fix.endOffset } ];
        for(const token of tokens.sort((first, second) => second.start - first.start))
        {
            const start = token.start - offset;
            const end = token.end - offset;
            newText = `${newText.slice(0, start)}String${newText.slice(end)}`;
        }

        return { offset: offset, endOffset: endOffset, newText: newText };
    }
}

module.exports = ChangeParameterAndReturnTypeFix;
