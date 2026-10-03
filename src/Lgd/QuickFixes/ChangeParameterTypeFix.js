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
        const title = this._previewTitle(analysis, preview, fix, { source: previewText, externals: state.externals });
        if(!title)
        {
            return null;
        }

        return { title: title, target: source, snapshots: snapshots,
            offset: fix.offset, endOffset: fix.endOffset, newText: 'String',
            validate: () => this._isolatedDocument(document, languageService) };
    }

    /** @description Discloses newly real return conflicts only when every result is strictly proven String and all other diagnostics are preserved. */
    _previewTitle(analysis, preview, fix, options)
    {
        const { source, externals } = options;
        const title = `Change parameter '${fix.parameterName}' to String (changes signature)`;
        if(this._validPreview(analysis, preview))
        {
            return this._titleWithRemaining(title, preview);
        }

        const group = analysis.group;
        const start = analysis.declaration.initializerStart + group.bodyStart;
        const end = analysis.declaration.initializerStart + group.bodyEnd;
        const introduced = preview.errors.filter(error =>
        {
            const ownedReturn = error.code === 'lgd.return.typeMismatch' && start <= error.offset && error.endOffset <= end;
            const stringConflict = error.message === 'Cannot return String from a Number method.';
            return ownedReturn && stringConflict && !this._preservesDiagnostics(analysis.original.errors, [error]);
        });

        const unchanged = { ...preview, errors: preview.errors.filter(error => !introduced.includes(error)) };
        const completeStringProof = group.returnTypeName === 'Number' && this._stringReturns(preview, fix, source, externals);
        if(introduced.length === 0 || !completeStringProof || !this._validPreview(analysis, unchanged))
        {
            return null;
        }

        const noun = introduced.length === 1 ? 'return diagnostic' : 'return diagnostics';
        return `${this._titleWithRemaining(title, unchanged)}; creates ${introduced.length} ${noun}`;
    }
}

module.exports = ChangeParameterTypeFix;
