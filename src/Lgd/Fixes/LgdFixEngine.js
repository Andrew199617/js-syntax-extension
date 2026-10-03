const DiagnosticQuickFix = require('../QuickFixes/DiagnosticQuickFix');
const QuickFixContext = require('../QuickFixes/QuickFixContext');
const createQuickFixRegistry = require('../QuickFixes/QuickFixRegistry');
const LgdDiagnosticDefinitions = require('../LgdDiagnosticDefinitions');

/** @description Shared diagnostic-to-proposal pipeline; strategies own all syntax-specific changes. */
const LgdFixEngine = {
    /** @description Creates the common strategy registry for interactive and batch callers. */
    create(languageService)
    {
        const engine = Object.create(LgdFixEngine);
        engine.languageService = languageService;
        engine.handlers = createQuickFixRegistry();
        return engine;
    },

    /** @description Recompiles stale buffers instead of using cached or disk-only diagnostics. */
    async currentState(document)
    {
        let state = this.languageService.getState(document.uri);
        if(!state)
        {
            state = await this.languageService.openDocument(document);
        }
        else if(state.compiledVersion !== document.version || state.compiledText !== document.getText())
        {
            state = await this.languageService.updateDocument(document);
        }

        return state;
    },

    /** @description Collects current proposals with optional registry-policy filtering and cancellation. */
    async collect(document, state, errors, options = {})
    {
        const { token, eligible = () => true } = options;
        if(token?.isCancellationRequested || !state || state.compiledVersion !== document.version || state.compiledText !== document.getText())
        {
            return [];
        }

        const context = new QuickFixContext(this.languageService, document, state);
        if(!await context.prepare())
        {
            return [];
        }

        const entries = [];
        for(const error of errors)
        {
            for(const fixKind of LgdDiagnosticDefinitions.fixKinds(error))
            {
                const handler = this.handlers.get(fixKind);
                if(!handler || !eligible(handler, error))
                {
                    continue;
                }

                const proposal = await handler.create(context, error.quickFix);
                if(token?.isCancellationRequested)
                {
                    return [];
                }

                if(proposal && DiagnosticQuickFix.canApply(proposal))
                {
                    entries.push({ document: document, proposal: proposal, handler: handler, error: error });
                }
            }
        }

        return entries;
    }
};

module.exports = LgdFixEngine;
