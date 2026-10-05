const path = require('path');
const LgdCastDiagnosticPolicy = require('../../Lgd/Fixes/LgdCastDiagnosticPolicy');
const vscode = require('vscode');
const LgdFixRuntime = require('./LgdFixRuntime');
const LgdFixEdits = require('./LgdFixEdits');
const LgdFixPlan = require('../../Lgd/Fixes/LgdFixPlan');
const LgdFixComposition = require('../../Lgd/Fixes/LgdFixComposition');
const LgdFixConfiguration = require('./LgdFixConfiguration');
const LgdFormattingDiagnostics = require('./LgdFormattingDiagnostics');
const LgdFormattingPolicy = require('../../Lgd/Fixes/LgdFormattingPolicy');
const LgdFormattingRules = require('../../Lgd/Fixes/LgdFormattingRules');
const LgdFormattingSources = require('../../Lgd/Formatting/LgdFormattingSources');

/** @description Native save-participant source action; no save listener or filesystem write loop. */
const SOURCE_KIND = 'source.fixAll.lgd';

/** @description Bounds diagnostic cascades and extension-host work during a single invocation. */
const MAX_PASSES = 10;

/** @description Bounds retained save actions and nonmodal status messages. */
const limits = { pending: 30, previews: 100, staleStatusMs: 4000, resultStatusMs: 5000 };

/** @description Excludes generated, vendored and regression-fixture folders before opening files. */
const SEARCH_EXCLUDE = '**/{node_modules,.git,dist,build,coverage,vendor,generated,typings,tests/mocks,tests/__mocks__}/**';

/** @description Coordinates configurable fixes across buffers and workspace roots through the shared registry. */
const LgdFixService = {
    /** @description Creates an isolated configuration reader and guarded proposal queue. */
    create(languageService)
    {
        const service = Object.create(LgdFixService);
        service.languageService = languageService;
        service.engine = LgdFixRuntime.create(languageService);
        const ruleIds = Array.from(new Set(Array.from(service.engine.handlers.values(), handler => handler.ruleId)));
        service.configuration = LgdFixConfiguration.create(ruleIds, LgdFormattingSources);
        service.ruleHandlers = new Map(Array.from(service.engine.handlers.values()).filter(handler => !handler.individualOnly).map(handler => [ handler.ruleId, handler ]));
        languageService.diagnosticPolicy = async (state, configuration) =>
        {
            const resolved = configuration || await service.configuration.resolve(state.document);
            return service.configuration.buffersCurrent(resolved) ? LgdCastDiagnosticPolicy.apply(state.errors, resolved) : null;
        };

        service.formattingDiagnostics = LgdFormattingDiagnostics.create(service.configuration, languageService.onError);
        service.formattingDiagnostics.refreshCompilerDiagnostics = async (document, configuration) =>
        {
            const state = languageService.getState(document.uri);
            if(state)
            {
                await languageService.publishDiagnostics(state, configuration);
            }
        };

        service.pending = new Map();
        service.previews = new Map();
        service.nextId = 0;
        service.pendingApply = Promise.resolve();
        return service;
    },

    /** @description Registers explicit commands, save source actions and read-only native diff documents. */
    register(subscriptions)
    {
        this.formattingDiagnostics.register(subscriptions);
        this.configuration.register(subscriptions, () => this.formattingDiagnostics.refreshAll());
        subscriptions.push(vscode.commands.registerCommand('lgd.fixAll', uri => this.chooseScope(uri)));
        subscriptions.push(vscode.commands.registerCommand('lgd.fixAllDocument', () => this.run('document')));
        subscriptions.push(vscode.commands.registerCommand('lgd.fixAllFile', () => this.run('document')));
        subscriptions.push(vscode.commands.registerCommand('lgd.fixAllProject', () => this.run('project')));
        subscriptions.push(vscode.commands.registerCommand('lgd.fixAllSolution', () => this.run('solution')));
        subscriptions.push(vscode.commands.registerCommand('lgd.applyFixAll', id => this.applyPending(id)));
        subscriptions.push(vscode.languages.registerCodeActionsProvider(
            [ { language: 'lgd', scheme: 'file' }, { language: 'lgd', scheme: 'untitled' } ],
            this,
            { providedCodeActionKinds: [new vscode.CodeActionKind(SOURCE_KIND)] }
        ));

        subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('lgd-fix-preview', {
            provideTextDocumentContent: uri => this.previews.get(uri.toString()) || ''
        }));

        subscriptions.push({ dispose: () => this.dispose() });
    },

    /** @description Keeps individual quick fixes available unless the project explicitly disables their rule. */
    async prepareIndividual(proposal, handler, analysis = {})
    {
        const targets = new Set([ proposal, ...proposal.additionalEdits || [] ].map(edit => edit.target.document));
        proposal.fixConfigurations = [];
        for(const document of targets)
        {
            const config = document === analysis.document ? analysis.configuration : await this.configuration.resolve(document);
            const enabled = (proposal.ruleIds || [handler.ruleId]).every(ruleId => LgdFormattingPolicy.setting(ruleId, config.rules).fix !== 'off');
            if(!config.valid || config.ignored || !enabled)
            {
                return false;
            }

            proposal.fixConfigurations.push({ document: document, config: config });
        }

        const configurations = new Map(proposal.fixConfigurations.map(entry => [ entry.document.uri.toString(), entry.config ]));
        const composed = this.composeProposal(proposal, configurations, { automatic: false });
        Object.assign(proposal, composed);
        return true;
    },

    /** @description Shares local cleanup and its existing policy checks across individual, batch and save fixes. */
    composeProposal(proposal, configurations, options)
    {
        return LgdFixComposition.compose(proposal, configurations, (error, configuration) =>
        {
            const handler = this.ruleHandlers.get(error.ruleId);
            return handler && this.eligibleError(handler, error, configuration, options);
        });
    },

    /** @description Rejects a quick fix if a policy changed after the lightbulb menu was opened. */
    async individualCurrent(proposal)
    {
        for(const entry of proposal.fixConfigurations || [])
        {
            if(!await this.configuration.isCurrent(entry.document, entry.config))
            {
                return false;
            }
        }

        return vscode.workspace.isTrusted !== false && (proposal.fixConfigurations || []).every(entry => this.configuration.buffersCurrent(entry.config));
    },

    /** @description Releases retained proposals and preview snapshots on extension disposal. */
    dispose()
    {
        this.pending.clear();
        this.previews.clear();
    },

    /** @description Defaults only source-preserving migrations into manual Fix All; automatic fixes are opt-in twice. */
    eligible(handler, config, automatic, selectedRules)
    {
        const selected = !selectedRules || selectedRules.includes(handler.ruleId) || selectedRules.includes(handler.parentRuleId);
        if(handler.individualOnly || !selected)
        {
            return false;
        }

        const setting = LgdFormattingPolicy.setting(handler.ruleId, config.rules);
        if(setting.severity === 'off')
        {
            return false;
        }

        const mode = setting.fix || (handler.automatic ? 'manual' : 'off');
        if(automatic)
        {
            return config.autoFix && mode === 'automatic' && handler.automatic === true;
        }

        return mode !== 'off';
    },

    /** @description Requires every option contributing to an atomic style edit to permit the requested mode. */
    eligibleError(handler, error, configuration, options)
    {
        if(options.safeOnly && !handler.automatic || !this.eligible(handler, configuration, options.automatic, options.rules))
        {
            return false;
        }

        return (error.relatedRuleIds || []).every(ruleId =>
        {
            const related = this.ruleHandlers.get(ruleId);
            return related && this.eligible(related, configuration, options.automatic, options.rules);
        });
    },

    /** @description Requires each native action contributing to a migration to be independently allowed. */
    eligibleProposal(proposal, configuration, options)
    {
        return (proposal.ruleIds || []).every(ruleId =>
        {
            const handler = this.ruleHandlers.get(ruleId);
            return handler && this.eligible(handler, configuration, options.automatic, options.rules);
        });
    },

    /** @description Reuses manual batch eligibility before exposing its scope picker beside a diagnostic fix. */
    eligibleQuickFix(document, proposal, handler, error)
    {
        if(vscode.workspace.isTrusted === false || document.languageId !== 'lgd' || ![ 'file', 'untitled' ].includes(document.uri.scheme))
        {
            return false;
        }

        return proposal.fixConfigurations.every(entry =>
        {
            const options = { automatic: false };
            return this.eligibleError(handler, error, entry.config, options) && this.eligibleProposal(proposal, entry.config, options);
        });
    },

    /** @description Adds fresh style findings for this request without mutating semantic compiler state. */
    async analysisRequest(document, state, configuration)
    {
        const config = configuration || await this.configuration.resolve(document);
        const formattingErrors = LgdFormattingRules.analyze(document.getText(), config);
        const errors = LgdCastDiagnosticPolicy.apply(state?.errors || [], config);
        return { configuration: config, formattingErrors: formattingErrors, state: { ...state, errors: [ ...errors, ...formattingErrors ] } };
    },

    /** @description Offers save-compatible actions only for explicitly opted-in, automatic-safe migrations. */
    async provideCodeActions(document, range, context, token)
    {
        const kind = new vscode.CodeActionKind(SOURCE_KIND);
        if(!context.only || !context.only.contains(kind) || token?.isCancellationRequested || vscode.workspace.isTrusted === false)
        {
            return [];
        }

        const batch = await this.plan([document], { automatic: true, scope: 'document', token: token });
        if(batch.plan.entries.length === 0 || token?.isCancellationRequested)
        {
            return [];
        }

        const id = this.nextId++;
        this.pending.set(id, batch);
        if(this.pending.size > limits.pending)
        {
            this.pending.delete(this.pending.keys().next().value);
        }

        const action = new vscode.CodeAction('Fix all automatic LGD issues', kind);
        action.command = { command: 'lgd.applyFixAll', title: action.title, arguments: [id] };
        return [action];
    },

    /** @description Presents document/file, nearest project and all workspace roots without inventing a solution format. */
    async chooseScope(uri)
    {
        const document = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
        const choice = await vscode.window.showQuickPick([
            { label: 'Document / File', description: 'Current LGD editor buffer, including unsaved changes', scope: 'document' },
            { label: 'Project', description: 'Nearest .vscode/lgd.json project, or current workspace folder', scope: 'project' },
            { label: 'Solution / Workspace', description: 'All folders in the current multi-root workspace', scope: 'solution' }
        ], { placeHolder: 'Fix all configured LGD issues in…' });
        if(choice)
        {
            return this.run(choice.scope, { document: document });
        }

        return false;
    },

    /** @description Selects open buffers first, then discovers LGD sources inside the requested scope. */
    async documents(scope, document, token)
    {
        if(scope === 'document')
        {
            return document ? [document] : [];
        }

        let folders = vscode.workspace.workspaceFolders || [];
        let projectRoot;
        if(scope === 'project')
        {
            if(!document)
            {
                return [];
            }

            const config = await this.configuration.resolve(document);
            projectRoot = config.root;
            if(!projectRoot || !config.valid)
            {
                return [];
            }

            folders = [{ uri: vscode.Uri.file(projectRoot) }];
        }

        const documents = new Map();
        for(const folder of folders)
        {
            const pattern = new vscode.RelativePattern(folder.uri.fsPath, '**/*.lgd');
            const uris = await vscode.workspace.findFiles(pattern, SEARCH_EXCLUDE, undefined, token);
            for(const uri of uris)
            {
                if(token?.isCancellationRequested)
                {
                    return [];
                }

                const config = await this.configuration.resolve({ uri: uri });
                if(config.valid && !config.ignored && (!projectRoot || config.root === projectRoot))
                {
                    const opened = await vscode.workspace.openTextDocument(uri);
                    documents.set(uri.toString(), opened);
                }
            }
        }

        for(const opened of vscode.workspace.textDocuments || [])
        {
            if(opened.languageId !== 'lgd' || opened.uri.scheme !== 'file')
            {
                continue;
            }

            const config = await this.configuration.resolve(opened);
            const inScope = projectRoot ? config.root === projectRoot : folders.some(folder => this.within(folder.uri.fsPath, opened.uri.fsPath));
            if(inScope && config.valid && !config.ignored)
            {
                documents.set(opened.uri.toString(), opened);
            }
        }

        return Array.from(documents.values());
    },

    /** @description Uses path segments rather than prefix matching for project boundaries. */
    within(root, filename)
    {
        const relative = path.relative(root, filename);
        return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    },

    /** @description Builds one conservative conflict-free pass, retaining configuration and dependency guards. */
    async plan(documents, options)
    {
        const entries = [];
        const configurations = new Map();
        const allowed = new Set(documents.map(document => document.uri.toString()));
        for(const document of documents)
        {
            if(options.token?.isCancellationRequested)
            {
                break;
            }

            const sourceKey = document.uri.toString();
            const config = configurations.get(sourceKey)?.config || await this.configuration.resolve(document);
            configurations.set(sourceKey, { document: document, config: config });
            if(!config.valid || config.ignored)
            {
                continue;
            }

            const state = await this.engine.currentState(document);
            const analysis = await this.analysisRequest(document, state, config);
            const request = { token: options.token, configuration: config, formattingErrors: analysis.formattingErrors,
                eligible: (handler, error) => this.eligibleError(handler, error, config, options) };
            const candidates = await this.engine.collect(document, analysis.state, analysis.state.errors, request);
            for(const entry of candidates)
            {
                const edits = [ entry.proposal, ...entry.proposal.additionalEdits || [] ];
                const targets = edits.map(edit => edit.target.document);
                let permitted = targets.every(target => allowed.has(target.uri.toString()));
                for(const target of targets)
                {
                    const key = target.uri.toString();
                    const targetConfig = configurations.get(key)?.config || await this.configuration.resolve(target);
                    configurations.set(key, { document: target, config: targetConfig });
                    const eligible = this.eligibleError(entry.handler, entry.error, targetConfig, options) && this.eligibleProposal(entry.proposal, targetConfig, options);
                    if(!targetConfig.valid || targetConfig.ignored || !eligible)
                    {
                        permitted = false;
                    }
                }

                if(permitted)
                {
                    const policies = new Map(Array.from(configurations, ([ key, target ]) => [ key, target.config ]));
                    entry.proposal = this.composeProposal(entry.proposal, policies, options);
                    entries.push(entry);
                }
            }
        }

        const plan = LgdFixPlan.create(entries);
        const required = new Set(plan.entries.map(entry => entry.document.uri.toString()));
        for(const edit of plan.edits)
        {
            required.add(edit.target.document.uri.toString());
        }

        const guards = Array.from(configurations.values()).filter(entry => required.has(entry.document.uri.toString()));
        return { plan: plan, configurations: guards, documents: documents, options: options };
    },

    /** @description Rejects changes to config, buffers, imported contracts, scope or workspace trust before any edit. */
    async current(batch)
    {
        if(batch.options.token?.isCancellationRequested || vscode.workspace.isTrusted === false)
        {
            return false;
        }

        for(const entry of batch.configurations)
        {
            if(!await this.configuration.isCurrent(entry.document, entry.config))
            {
                return false;
            }
        }

        const identities = new Map();
        for(const entry of batch.plan.entries)
        {
            if(!await this.engine.isAnalysisCurrent(entry.proposal, identities))
            {
                return false;
            }
        }

        const configurationsCurrent = batch.configurations.every(entry => this.configuration.buffersCurrent(entry.config));
        return !batch.options.token?.isCancellationRequested && vscode.workspace.isTrusted !== false && configurationsCurrent && LgdFixPlan.isCurrent(batch.plan);
    },

    /** @description Runs a cancelable Fix All command and requires review/consent for wider or semantic plans. */
    async run(scope, options = {})
    {
        if(vscode.workspace.isTrusted === false)
        {
            return false;
        }

        const document = options.document || vscode.window.activeTextEditor?.document;
        if(scope !== 'solution' && document?.languageId !== 'lgd')
        {
            vscode.window.showInformationMessage('LGD: Open an LGD document first.');
            return false;
        }

        const prepare = async (progress, token) =>
        {
            progress.report({ message: 'Finding current LGD diagnostics…' });
            const documents = await this.documents(scope, document, token);
            return this.plan(documents, { ...options, scope: scope, automatic: false, token: token });
        };

        const batch = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'LGD Fix All', cancellable: true }, prepare);
        if(batch.options.token?.isCancellationRequested)
        {
            return false;
        }

        if(batch.plan.entries.length === 0)
        {
            vscode.window.showInformationMessage('LGD: No enabled fixes are available in this scope. Check .vscode/lgd.json and Problems if expected fixes are missing.');
            return false;
        }

        const semantic = batch.plan.entries.some(entry => !entry.handler.automatic);
        if((scope !== 'document' || semantic) && !await this.confirm(batch, semantic))
        {
            return false;
        }

        return this.applyBatch(batch, scope === 'document' && !semantic);
    },

    /** @description Shows exact native diffs and waits for explicit acceptance of project or semantic edits. */
    async confirm(batch, semantic)
    {
        const previews = LgdFixPlan.previews(batch.plan);
        const warning = semantic ? ' Includes changes to contracts or behavior.' : '';
        const message = `Apply ${batch.plan.entries.length} LGD fixes in ${previews.length} file(s)?${warning} Files will remain unsaved.`;
        let choice = await vscode.window.showWarningMessage(message, 'Review changes', 'Apply fixes', 'Cancel');
        while(choice === 'Review changes')
        {
            const items = previews.map(preview => ({ label: path.basename(preview.document.uri.fsPath), description: preview.document.uri.fsPath, preview: preview }));
            const item = await vscode.window.showQuickPick(items, { placeHolder: 'Choose a file to preview' });
            if(item)
            {
                const id = this.nextId++;
                const beforeUri = vscode.Uri.parse(`lgd-fix-preview:/${id}/before.lgd`);
                const afterUri = vscode.Uri.parse(`lgd-fix-preview:/${id}/after.lgd`);
                this.previews.set(beforeUri.toString(), item.preview.before);
                this.previews.set(afterUri.toString(), item.preview.after);
                while(this.previews.size > limits.previews)
                {
                    this.previews.delete(this.previews.keys().next().value);
                }

                await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, `LGD Fix All: ${item.label}`);
            }

            choice = await vscode.window.showWarningMessage(message, 'Review changes', 'Apply fixes', 'Cancel');
        }

        return choice === 'Apply fixes';
    },

    /** @description Revalidates a retained save action and runs only configured automatic-safe passes. */
    applyPending(id)
    {
        const batch = this.pending.get(id);
        this.pending.delete(id);
        return batch ? this.applyBatch(batch, true) : false;
    },

    /** @description Applies conflict-free passes without saving, stops on cancellation/staleness/cycles and bounds cascades. */
    applyBatch(batch, iterate)
    {
        const pending = this._queuedApply(batch, iterate, this.pendingApply);
        this.pendingApply = this._settle(pending);
        return pending;
    },

    async _queuedApply(batch, iterate, previous)
    {
        await previous;
        return this._applyBatch(batch, iterate);
    },

    async _settle(pending)
    {
        try
        {
            return await pending;
        }
        catch
        {
            return false;
        }
    },

    async _applyBatch(batch, iterate)
    {
        if(iterate)
        {
            batch.options = { ...batch.options, safeOnly: true };
        }

        let applied = false;
        let count = 0;
        const seen = new Set();
        for(let pass = 0; pass < MAX_PASSES; pass++)
        {
            if(!await this.current(batch))
            {
                if(!batch.options.automatic)
                {
                    vscode.window.setStatusBarMessage('LGD: Source or configuration changed; run Fix All again.', limits.staleStatusMs);
                }

                return applied;
            }

            const signature = JSON.stringify(batch.documents.map(document => [ document.uri.toString(), document.getText() ]));
            if(seen.has(signature) || batch.plan.entries.length === 0)
            {
                break;
            }

            seen.add(signature);
            if(!await LgdFixEdits.apply(batch.plan, this.languageService))
            {
                return applied;
            }

            applied = true;
            count += batch.plan.entries.length;
            if(!iterate)
            {
                break;
            }

            batch = await this.plan(batch.documents, batch.options);
        }

        if(!batch.options.automatic)
        {
            const deferred = batch.plan.skipped ? ' Conflicting fixes were deferred; run Fix All again.' : '';
            vscode.window.setStatusBarMessage(`LGD: Applied ${count} fixes. Files remain unsaved.${deferred}`, limits.resultStatusMs);
        }

        return applied;
    }
};

module.exports = LgdFixService;
