const vscode = require('vscode');
const { parseExpression } = require('@babel/parser');
const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const LgdCompiler = require('../../Compilers/LgdCompiler');

/** @description Replaces only proven pure instance receivers with their accessible static type reference. */
class UseStaticTypeReceiverFix extends DiagnosticQuickFix
{
    constructor() { super('useStaticTypeReceiver'); }

    /** @description Requires fresh compiler metadata, complete dependency snapshots, and a nonregressing preview. */
    async createProposal(context, fix)
    {
        const { source, document, state, languageService } = context;
        if(!this._simpleReceiver(source.text, fix))
        {
            return null;
        }

        const resolved = languageService.collectExternalTypes ? await languageService.collectExternalTypes(document) : state.externals;
        const externals = new Map(Array.from(resolved, ([ name, entry ]) => [ name, JSON.parse(JSON.stringify(entry)) ]));

        // Export descriptors do not retain authoritative inherited-source closures, so imported ancestry cannot authorize this edit.
        const incomplete = Array.from(externals.values()).some(entry => entry.kind === 'class' && (entry.baseName || !entry.methodsKnown || !entry.contractsKnown));

        if(incomplete)
        {
            return null;
        }

        const dependencies = await this._snapshotDependencyClosure(context, externals);
        if(!dependencies)
        {
            return null;
        }

        const options = await languageService.getOutputOptions(document);
        const optionSignature = JSON.stringify(options);
        const metadata = { ...fix };
        const proposal = {
            title: `Use '${fix.typeName}' to access static member '${fix.memberName}'`,
            target: source, snapshots: [ ...context.snapshots, ...dependencies ],
            offset: fix.offset, endOffset: fix.endOffset, newText: fix.typeName,

            /** @description Repeats authoritative metadata and preview checks immediately before the guarded edit. */
            validate: () =>
            {
                const currentOptions = languageService.getOutputOptions(document);
                const sameEdit = proposal.offset === metadata.offset && proposal.endOffset === metadata.endOffset && proposal.newText === metadata.typeName;
                if(!sameEdit || JSON.stringify(currentOptions) !== optionSignature)
                {
                    return false;
                }

                return this._validPreview(source.text, metadata, externals, options);
            }
        };

        return DiagnosticQuickFix.canApply(proposal) ? proposal : null;
    }

    /** @description Rejects any textual edit that could discard evaluation or change optional access semantics. */
    _simpleReceiver(source, fix)
    {
        const offsets = [ fix.offset, fix.endOffset, fix.memberOffset, fix.memberEndOffset ];
        const identifier = /^[$A-Z_a-z][\w$]*$/;
        const names = [ fix.typeName, fix.memberName, fix.receiverName ];
        const validNames = names.every(name => typeof name === 'string' && identifier.test(name));
        if(fix.kind !== this.kind || !offsets.every(Number.isInteger) || !validNames)
        {
            return false;
        }

        const text = source.slice(fix.offset, fix.endOffset);
        if(text !== fix.receiverName || !identifier.test(text) || fix.offset < 0 || fix.endOffset <= fix.offset || fix.endOffset > source.length)
        {
            return false;
        }

        try
        {
            const receiver = parseExpression(text);
            return receiver.type === 'Identifier' || receiver.type === 'ThisExpression';
        }
        catch
        {
            return false;
        }
    }

    /** @description Anchors all imported ancestry to live buffers matching the resolved compiler source closure. */
    async _snapshotDependencyClosure(context, externals)
    {
        const { languageService, document } = context;
        const expectedSources = new Map();
        const pending = [document.uri.fsPath];
        for(const entry of externals.values())
        {
            if(entry.sourcePath)
            {
                expectedSources.set(entry.sourcePath, entry.sourceText);
                pending.push(entry.sourcePath);
            }

            for(const member of entry.members || [])
            {
                if(member.declaringSourcePath && !pending.includes(member.declaringSourcePath))
                {
                    pending.push(member.declaringSourcePath);
                }
            }
        }

        const visited = new Set([document.uri.fsPath]);
        const snapshots = [];
        try
        {
            for(const sourcePath of pending)
            {
                for(const dependency of languageService.dependencies?.get(sourcePath) || [])
                {
                    if(!pending.includes(dependency))
                    {
                        pending.push(dependency);
                    }
                }

                if(visited.has(sourcePath))
                {
                    continue;
                }

                visited.add(sourcePath);
                const cached = languageService.exportCache?.get(sourcePath);
                const expected = expectedSources.get(sourcePath) ?? cached?.sourceText;
                const invalidSource = cached?.parsed?.errors.some(error => error.severity !== 'warning');
                if(typeof expected !== 'string' || invalidSource)
                {
                    return null;
                }

                const dependencyDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
                if(dependencyDocument.uri.scheme !== 'file' || dependencyDocument.getText() !== expected)
                {
                    return null;
                }

                snapshots.push(DiagnosticQuickFix.snapshot(dependencyDocument));
                if(!await this._collectDependencySources(context, dependencyDocument, expectedSources, pending))
                {
                    return null;
                }
            }
        }
        catch
        {
            return null;
        }

        return snapshots;
    }

    /** @description Discovers imports omitted from exported heritage and retains each dependency's source provenance. */
    async _collectDependencySources(context, document, expectedSources, pending)
    {
        const service = context.languageService;
        if(!service.collectExternalTypes)
        {
            return true;
        }

        const imported = await service.collectExternalTypes(document);
        for(const entry of imported.values())
        {
            if(!entry.sourcePath)
            {
                continue;
            }

            const previous = expectedSources.get(entry.sourcePath);
            if(previous !== undefined && previous !== entry.sourceText)
            {
                return false;
            }

            expectedSources.set(entry.sourcePath, entry.sourceText);
        }

        for(const dependency of service.dependencies.get(document.uri.fsPath) || [])
        {
            if(!pending.includes(dependency))
            {
                pending.push(dependency);
            }
        }

        return true;
    }

    /** @description Recompiles exact proposal evidence and suppresses fixes retaining the target or creating diagnostics. */
    _validPreview(source, fix, externals, options)
    {
        try
        {
            const compiler = LgdCompiler.create();
            const original = compiler.compileToJs(source, externals, options);
            const fields = Object.keys(fix);
            const target = original.errors.find(error =>
            {
                const sameSpan = error.offset === fix.memberOffset && error.endOffset === fix.memberEndOffset;
                const metadata = error.quickFix;
                const sameMetadata = metadata && Object.keys(metadata).length === fields.length && fields.every(field => metadata[field] === fix[field]);
                return error.code === 'lgd.member.receiverKind' && sameSpan && sameMetadata;
            });

            if(!target)
            {
                return false;
            }

            const previewText = source.slice(0, fix.offset) + fix.typeName + source.slice(fix.endOffset);
            const preview = compiler.compileToJs(previewText, externals, options);
            const delta = fix.typeName.length - (fix.endOffset - fix.offset);
            const remainingTarget = preview.errors.some(error =>
            {
                const sameSpan = error.offset === target.offset + delta && error.endOffset === target.endOffset + delta;
                return error.code === target.code && sameSpan;
            });

            return !remainingTarget && this._preservesDiagnostics(original.errors.filter(error => error !== target), preview.errors, fix, delta);
        }
        catch
        {
            return false;
        }
    }

    /** @description Compares unchanged diagnostic identities after translating offsets past the receiver-only edit. */
    _preservesDiagnostics(original, preview, fix, delta)
    {
        const remaining = original.slice();
        function shifted(offset)
        {
            return offset >= fix.endOffset ? offset + delta : offset;
        }

        for(const error of preview)
        {
            const index = remaining.findIndex(previous =>
            {
                const sameSpan = shifted(previous.offset) === error.offset && shifted(previous.endOffset) === error.endOffset;
                const sameIdentity = previous.code === error.code && previous.message === error.message && previous.severity === error.severity;
                return sameSpan && sameIdentity;
            });

            if(index === -1)
            {
                return false;
            }

            remaining.splice(index, 1);
        }

        return true;
    }
}

module.exports = UseStaticTypeReceiverFix;
