const SignatureTypeFix = require('./SignatureTypeFix');

/** @description Offers a separate explicit return-contract correction for a closed method already returning only String. */
class ChangeReturnTypeFix extends SignatureTypeFix
{
    constructor() { super('changeReturnType'); }

    /** @description Requires fresh return provenance, a closed owner, strict result proof, and a nonregressing compiler preview. */
    async createProposal(context, fix)
    {
        const fields = [ 'kind',
            'declarationStart',
            'groupStart',
            'methodName',
            'offset',
            'endOffset',
            'oldTypeName',
            'newTypeName',
            'returnStart',
            'returnEnd' ];
        const analysis = await this._analyze(context, fix, { code: 'lgd.return.typeMismatch',
            spanFields: [ 'returnStart', 'returnEnd' ], identityFields: fields });
        if(!analysis)
        {
            return null;
        }

        const { source, snapshots, document, state, languageService } = context;
        const previewText = `${source.text.slice(0, fix.offset)}String${source.text.slice(fix.endOffset)}`;
        const preview = analysis.compiler.compileToJs(previewText, state.externals, analysis.options);
        const consistentReturns = this._stringReturns(preview, fix, previewText, state.externals);
        if(!consistentReturns || !this._validPreview(analysis, preview) || this._signatureTypeErrors(preview, analysis))
        {
            return null;
        }

        const title = this._titleWithRemaining(`Change return type of '${fix.methodName}' to String (changes signature)`, preview);
        return { title: title, target: source, snapshots: snapshots,
            offset: fix.offset, endOffset: fix.endOffset, newText: 'String',
            validate: () => this._isolatedDocument(document, languageService) };
    }
}

module.exports = ChangeReturnTypeFix;
