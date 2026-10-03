const DiagnosticQuickFix = require('../QuickFixes/DiagnosticQuickFix');
const LgdDiagnosticDefinitions = require('../LgdDiagnosticDefinitions');

/** @description Shared diagnostic-to-proposal pipeline; strategies own all syntax-specific changes. */
const LgdFixEngine = {
    /** @description Creates the common strategy registry for interactive and batch callers. */
    create(languageService, adapter)
    {
        const engine = Object.create(LgdFixEngine);
        engine.languageService = languageService;
        engine.handlers = adapter.handlers;
        engine.createContext = adapter.createContext;
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

        const analysisIdentity = this.analysisIdentity(document, state.externals);
        const context = this.createContext(document, state);
        context.configuration = options.configuration;
        context.formattingErrors = options.formattingErrors;
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
                    proposal.analysisContext = { document: document, identity: analysisIdentity };
                    entries.push({ document: document, proposal: proposal, handler: handler, error: error });
                }
            }
        }

        return entries;
    },

    /** @description Captures non-text compilation inputs that can change when project manifests or settings change. */
    analysisIdentity(document, externals)
    {
        const dependencies = Array.from(externals || [], ([ name, entry ]) => [ name, entry.sourcePath, entry.projectId, entry.sourceText ]);
        dependencies.sort((left, right) => left[0].localeCompare(right[0]));
        const output = this.languageService.getOutputOptions(document);
        return JSON.stringify({ projectId: externals?.sourceContext?.projectId, dependencies: dependencies, output: output });
    },

    /** @description Re-resolves imported contracts and compilation identity before an already offered edit is applied. */
    async isAnalysisCurrent(proposal, identities = new Map())
    {
        const context = proposal.analysisContext;
        if(!context)
        {
            return true;
        }

        const key = context.document.uri.toString();
        if(!identities.has(key))
        {
            const externals = await this.languageService.collectExternalTypes(context.document);
            identities.set(key, this.analysisIdentity(context.document, externals));
        }

        return identities.get(key) === context.identity;
    }
};

module.exports = LgdFixEngine;
