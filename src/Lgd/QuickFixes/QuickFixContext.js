const vscode = require('vscode');
const DiagnosticQuickFix = require('./DiagnosticQuickFix');
const { maskCode } = require('../../Compilers/LgdInfer');
const { collectScopes, collectBindings, visibleBindings } = require('../../Compilers/LgdBaseChecker');

/** @description Per-request source/dependency context, isolated from fix-specific decisions. */
class QuickFixContext
{
    /** @description Captures the source document, compiled state and language service. */
    constructor(languageService, document, state)
    {
        this.languageService = languageService;
        this.document = document;
        this.state = state;
        this.source = DiagnosticQuickFix.snapshot(document);
        this.snapshots = [this.source];
    }

    /** @description Records dependencies only when their live buffers match compiled inputs. */
    async prepare()
    {
        const dependencies = await this.snapshotDependencies(this.state);
        if(!dependencies)
        {
            await this.languageService.updateDocument(this.document, false);
            return false;
        }

        this.snapshots.push(...dependencies);
        return true;
    }

    /** @description Retains imported source snapshots so changed constructor or override contracts cannot receive stale fixes. */
    async snapshotDependencies(state)
    {
        const snapshots = [];
        try
        {
            for(const entry of state.externals.values())
            {
                if(!entry.sourcePath)
                {
                    continue;
                }

                const document = await vscode.workspace.openTextDocument(vscode.Uri.file(entry.sourcePath));
                if(document.getText() !== entry.sourceText)
                {
                    return null;
                }

                snapshots.push(DiagnosticQuickFix.snapshot(document));
            }
        }
        catch
        {
            return null;
        }

        return snapshots;
    }

    /** @description Resolves only known lexical LGD bases, retaining source provenance across imports. */
    async findBaseMethod(source, declaration, search)
    {
        const { name, visited, snapshots } = search;
        const key = `${source.document.uri.toString()}:${declaration.headStart}`;
        if(visited.has(key) || !declaration.baseName)
        {
            return null;
        }

        visited.add(key);
        const content = source.document.getText();
        const masked = maskCode(content, true);
        const scopes = collectScopes(masked);
        const bindings = collectBindings({ content: content, masked: masked, declarations: source.parsed.allDeclarations,
            scopes: scopes, externals: source.externals });
        const resolvedBase = visibleBindings(bindings, declaration.headStart ?? declaration.start).get(declaration.baseName);
        let base = resolvedBase;
        if(!base)
        {
            return null;
        }

        let baseSource = source;
        if(resolvedBase.sourcePath)
        {
            baseSource = await this.openKnownSource(resolvedBase, snapshots);
            if(!baseSource)
            {
                return null;
            }

            base = baseSource.parsed.declarations.find(candidate => candidate.name === resolvedBase.exportName);
        }

        if(base?.kind !== 'class')
        {
            return null;
        }

        const member = base.classMembers.find(candidate => !candidate.isConstructor && candidate.name === name);
        if(member)
        {
            if(member.kind !== 'method' || member.accessor || member.virtual || member.override || !Number.isInteger(member.start))
            {
                return null;
            }

            const snapshot = snapshots.find(candidate => candidate.document === baseSource.document);
            return { declaration: base, member: member, snapshot: snapshot };
        }

        return this.findBaseMethod(baseSource, base, search);
    }

    /** @description Opens a known LGD export only when the live buffer still matches the compiled import. */
    async openKnownSource(entry, snapshots)
    {
        if(!entry.sourcePath.endsWith('.lgd'))
        {
            return null;
        }

        try
        {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(entry.sourcePath));
            if(document.uri.scheme !== 'file' || document.getText() !== entry.sourceText)
            {
                return null;
            }

            snapshots.push(DiagnosticQuickFix.snapshot(document));
            const externals = await this.languageService.collectExternalTypes(document);
            const dependencies = await this.snapshotDependencies({ externals: externals });
            if(!dependencies)
            {
                return null;
            }

            snapshots.push(...dependencies);
            const parsed = this.languageService.compiler.parse(document.getText(), externals);
            if(parsed.errors.some(error => error.severity !== 'warning'))
            {
                return null;
            }

            return { document: document, parsed: parsed, externals: externals };
        }
        catch
        {
            return null;
        }
    }
}

module.exports = QuickFixContext;
