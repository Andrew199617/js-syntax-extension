const SignatureTypeFix = require('./SignatureTypeFix');

/** @description Suggests one conservative parameter-contract edit after validating the exact assignment and preview. */
class ChangeParameterTypeFix extends SignatureTypeFix
{
    constructor() { super('changeParameterType'); }

    /** @description Rechecks compiler provenance, caller isolation, and all diagnostics before offering an annotation-only edit. */
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
        if(!analysis)
        {
            return null;
        }

        const { source, snapshots, document, state, languageService } = context;
        const previewText = `${source.text.slice(0, fix.offset)}String${source.text.slice(fix.endOffset)}`;
        const preview = analysis.compiler.compileToJs(previewText, state.externals, analysis.options);
        if(!this._validPreview(analysis, preview))
        {
            return null;
        }

        const title = this._titleWithRemaining(`Change parameter '${fix.parameterName}' to String (changes signature)`, preview);
        return { title: title, target: source, snapshots: snapshots,
            offset: fix.offset, endOffset: fix.endOffset, newText: 'String',
            validate: () => this._isolatedDocument(document, languageService) };
    }
}

module.exports = ChangeParameterTypeFix;
