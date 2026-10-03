const vscode = require('vscode');
const DiagnosticQuickFix = require('./QuickFixes/DiagnosticQuickFix');
const QuickFixContext = require('./QuickFixes/QuickFixContext');
const createQuickFixRegistry = require('./QuickFixes/QuickFixRegistry');

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
        provider.handlers = createQuickFixRegistry();
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
        const offeredEdits = new Map();
        for(const diagnostic of context.diagnostics)
        {
            const error = this.matchError(document, state, diagnostic, range);
            if(!error?.quickFix)
            {
                continue;
            }

            const handler = this.handlers.get(error.quickFix.kind);
            if(!handler)
            {
                continue;
            }

            const fixContext = new QuickFixContext(this.languageService, document, state);
            if(!await fixContext.prepare())
            {
                continue;
            }

            const proposal = await handler.create(fixContext, error.quickFix);
            if(!proposal || token?.isCancellationRequested || !DiagnosticQuickFix.canApply(proposal))
            {
                continue;
            }

            const editKey = JSON.stringify([ proposal.target.document.uri.toString(), proposal.offset, proposal.endOffset, proposal.newText ]);
            const existingAction = offeredEdits.get(editKey);
            if(existingAction)
            {
                existingAction.diagnostics.push(diagnostic);
                continue;
            }

            const action = new vscode.CodeAction(proposal.title, vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diagnostic];
            action.isPreferred = proposal.isPreferred;
            const proposalId = this.nextProposalId++;
            this.proposals.set(proposalId, proposal);
            if(this.proposals.size > MAX_PENDING_FIXES)
            {
                this.proposals.delete(this.proposals.keys().next().value);
            }

            action.command = { command: APPLY_FIX_COMMAND, title: proposal.title, arguments: [proposalId] };
            actions.push(action);
            offeredEdits.set(editKey, action);
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
        if(!proposal || !DiagnosticQuickFix.canApply(proposal))
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
    }
};

module.exports = LgdCodeActionProvider;
