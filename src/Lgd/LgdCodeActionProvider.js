const vscode = require('vscode');
const { parseExpression } = require('@babel/parser');
const { maskCode } = require('../Compilers/LgdInfer');
const { collectScopes, collectBindings, visibleBindings } = require('../Compilers/LgdBaseChecker');

/** @description Internal command shared by native diagnostic quick fixes. */
const APPLY_FIX_COMMAND = 'lgd.applyDiagnosticQuickFix';

/** @description Bounds retained proposals from repeated editor requests. */
const MAX_PENDING_FIXES = 100;

/** @description Brief status feedback when an already offered action becomes stale. */
const STALE_FIX_STATUS_MS = 3000;

/** @description Provides conservative, diagnostic-linked fixes on original LGD source documents. */
const LgdCodeActionProvider = {
    /** @description Creates a provider backed by the current LGD compilation state. */
    create(languageService)
    {
        const provider = Object.create(LgdCodeActionProvider);
        provider.languageService = languageService;
        provider.proposals = new Map();
        provider.nextProposalId = 0;
        return provider;
    },

    /** @description Offers only fixes whose diagnostics and source snapshot are still current. */
    async provideCodeActions(document, range, context, token)
    {
        if(token?.isCancellationRequested || context.only && !context.only.contains(vscode.CodeActionKind.QuickFix))
        {
            return [];
        }

        const state = this.languageService.getState(document.uri);
        if(!state || state.compiledVersion !== document.version || state.compiledText !== document.getText())
        {
            return [];
        }

        const actions = [];
        for(const diagnostic of context.diagnostics)
        {
            const error = this.matchError(document, state, diagnostic, range);
            if(!error?.quickFix)
            {
                continue;
            }

            const proposal = await this.createProposal(document, state, error.quickFix);
            if(!proposal || token?.isCancellationRequested || !this.isCurrent(proposal))
            {
                continue;
            }

            const action = new vscode.CodeAction(proposal.title, vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diagnostic];
            action.isPreferred = error.quickFix.kind === 'addOverride';
            const proposalId = this.nextProposalId++;
            this.proposals.set(proposalId, proposal);
            if(this.proposals.size > MAX_PENDING_FIXES)
            {
                this.proposals.delete(this.proposals.keys().next().value);
            }

            action.command = { command: APPLY_FIX_COMMAND, title: proposal.title, arguments: [proposalId] };
            actions.push(action);
        }

        return actions;
    },

    /** @description Registers the compatible quick-fix command and clears retained proposals on disposal. */
    registerCommands(subscriptions)
    {
        subscriptions.push(vscode.commands.registerCommand(APPLY_FIX_COMMAND, proposalId => this.applyFix(proposalId)));
        subscriptions.push({ dispose: () => this.proposals.clear() });
    },

    /** @description Revalidates original-source snapshots before applying a fix and refreshing diagnostics. */
    async applyFix(proposalId)
    {
        const proposal = this.proposals.get(proposalId);
        this.proposals.delete(proposalId);
        if(!proposal || !this.isCurrent(proposal))
        {
            vscode.window.setStatusBarMessage('LGD: Source changed; reopen Quick Fix to refresh the available actions.', STALE_FIX_STATUS_MS);
            return false;
        }

        const document = proposal.target.document;
        const range = new vscode.Range(document.positionAt(proposal.offset), document.positionAt(proposal.endOffset));
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, range, proposal.newText);
        const applied = await vscode.workspace.applyEdit(edit);
        if(applied && this.languageService.getState(document.uri))
        {
            await this.languageService.updateDocument(document);
            await this.languageService.pendingDependencyUpdates;
        }

        return applied;
    },

    /** @description Matches a coded diagnostic to its exact current source span and requested range. */
    matchError(document, state, diagnostic, range)
    {
        if(diagnostic.source !== 'LGD' || typeof diagnostic.code !== 'string')
        {
            return null;
        }

        const start = document.offsetAt(diagnostic.range.start);
        const end = document.offsetAt(diagnostic.range.end);
        const requestedStart = document.offsetAt(range.start);
        const requestedEnd = document.offsetAt(range.end);
        if(end < requestedStart || start > requestedEnd)
        {
            return null;
        }

        return state.errors.find(error => error.code === diagnostic.code && error.offset === start && error.endOffset === end) || null;
    },

    /** @description Captures an open source document and its version for stale-edit protection. */
    snapshot(document)
    {
        return { document: document, version: document.version, text: document.getText() };
    },

    /** @description Checks versions and exact source text for every document involved in an action. */
    isCurrent(proposal)
    {
        return proposal.snapshots.every(snapshot =>
        {
            const document = snapshot.document;
            return !document.isClosed && document.version === snapshot.version && document.getText() === snapshot.text;
        });
    },

    /** @description Produces a minimal source edit without guessing types or discarding effectful expressions. */
    async createProposal(document, state, fix)
    {
        const source = this.snapshot(document);
        const dependencies = await this.snapshotDependencies(state);
        if(!dependencies)
        {
            await this.languageService.updateDocument(document, false);
            return null;
        }

        const snapshots = [ source, ...dependencies ];
        if(fix.kind === 'makeBaseVirtual')
        {
            const declaration = state.declarations.find(candidate => candidate.headStart === fix.declarationStart);
            if(!declaration)
            {
                return null;
            }

            const sourceContext = { document: document, parsed: { allDeclarations: state.declarations }, externals: state.externals };
            const search = { name: fix.methodName, visited: new Set(), snapshots: snapshots };
            const origin = await this.findBaseMethod(sourceContext, declaration, search);
            if(!origin)
            {
                return null;
            }

            return { title: `Make ${origin.declaration.name}.${fix.methodName} virtual`,
                target: origin.snapshot, snapshots: snapshots,
                offset: origin.member.start, endOffset: origin.member.start, newText: 'virtual ' };
        }

        const integerOffsets = Number.isInteger(fix.offset) && Number.isInteger(fix.endOffset);
        const validRange = fix.offset >= 0 && fix.endOffset >= fix.offset && fix.endOffset <= source.text.length;
        if(!integerOffsets || !validRange)
        {
            return null;
        }

        if(fix.kind === 'addOverride')
        {
            return { title: 'Add override keyword', target: source, snapshots: snapshots,
                offset: fix.offset, endOffset: fix.endOffset, newText: 'override ' };
        }

        if(fix.kind === 'removeExtraBaseArguments' && this.onlyDiscardableLiterals(source.text.slice(fix.offset, fix.endOffset)))
        {
            return { title: 'Remove extra arguments from base call', target: source, snapshots: snapshots,
                offset: fix.offset, endOffset: fix.endOffset, newText: '' };
        }

        return null;
    },

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

                snapshots.push(this.snapshot(document));
            }
        }
        catch
        {
            return null;
        }

        return snapshots;
    },

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

                const signedLiteral = element.type === 'UnaryExpression' && [ '+', '-' ].includes(element.operator);
                return signedLiteral && [ 'NumericLiteral', 'BigIntLiteral' ].includes(element.argument.type);
            });
        }
        catch
        {
            return false;
        }
    },

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
    },

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

            snapshots.push(this.snapshot(document));
            const externals = await this.languageService.collectExternalTypes(document);
            const parsed = this.languageService.compiler.parse(document.getText(), externals);
            return { document: document, parsed: parsed, externals: externals };
        }
        catch
        {
            return null;
        }
    }
};

module.exports = LgdCodeActionProvider;
