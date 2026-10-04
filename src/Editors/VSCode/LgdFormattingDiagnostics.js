const vscode = require('vscode');
const createLgdDiagnostics = require('../../Lgd/LgdDiagnostics');
const LgdFormattingRules = require('../../Lgd/Fixes/LgdFormattingRules');

/** @description Publishes optional style diagnostics separately from semantic compiler failures. */
const LgdFormattingDiagnostics = {
    /** @description Creates a VS Code presentation adapter around the shared formatting rules. */
    create(configuration, onError)
    {
        const diagnostics = Object.create(this);
        diagnostics.configuration = configuration;
        diagnostics.onError = onError;
        diagnostics.collection = vscode.languages.createDiagnosticCollection('lgd-formatting');
        diagnostics.generations = new Map();
        diagnostics.disposed = false;
        return diagnostics;
    },

    /** @description Updates diagnostics on buffer changes without editing or saving documents. */
    register(subscriptions)
    {
        const changed = event => this.refresh(event.document || event);
        const closed = document =>
        {
            this.generations.delete(document.uri.toString());
            this.collection.delete(document.uri);
        };

        subscriptions.push(this);
        subscriptions.push(vscode.workspace.onDidOpenTextDocument(changed));
        subscriptions.push(vscode.workspace.onDidChangeTextDocument(changed));
        subscriptions.push(vscode.workspace.onDidCloseTextDocument(closed));
    },

    /** @description Rechecks open sources when a project formatting preference changes. */
    async refreshAll()
    {
        for(const document of vscode.workspace.textDocuments || [])
        {
            await this.refresh(document);
        }
    },

    /** @description Drops stale source or configuration reads instead of publishing obsolete diagnostics. */
    async refresh(document)
    {
        if(this.disposed || document.languageId !== 'lgd' || document.isClosed)
        {
            return;
        }

        const key = document.uri.toString();
        const generation = (this.generations.get(key) || 0) + 1;
        this.generations.set(key, generation);
        const version = document.version;
        const text = document.getText();
        try
        {
            const configuration = await this.configuration.resolve(document);
            const current = this.generations.get(key) === generation && document.version === version && document.getText() === text;
            if(this.disposed || document.isClosed || !current)
            {
                return;
            }

            if(!configuration.valid || !this.configuration.buffersCurrent(configuration))
            {
                this.collection.delete(document.uri);
                return;
            }

            await this.refreshCompilerDiagnostics?.(document, configuration);
            if(this.disposed || this.generations.get(key) !== generation || document.version !== version || document.getText() !== text)
            {
                return;
            }

            const errors = LgdFormattingRules.analyze(text, configuration);
            this.collection.set(document.uri, createLgdDiagnostics(document, errors));
        }
        catch(error)
        {
            if(!this.disposed && this.generations.get(key) === generation)
            {
                this.collection.delete(document.uri);
                this.onError?.(error);
            }
        }
    },

    /** @description Disposes this editor's presentation state without affecting shared rule definitions. */
    dispose()
    {
        this.disposed = true;
        this.generations.clear();
        this.collection.dispose();
    }
};

module.exports = LgdFormattingDiagnostics;
