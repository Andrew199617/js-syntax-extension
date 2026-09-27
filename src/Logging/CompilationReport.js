const vscode = require('vscode');
const StatusBarMessage = require('./StatusBarMessage');
const StatusBarMessageTypes = require('./StatusBarMessageTypes');
const SeverityConverter = require('../Core/ServerityConverter');
const ErrorTypes = require('../Errors/ErrorTypes');

/** @description One output stream and one final status-bar message for a compilation run. */
const CompilationReport = {
    create(label, batch = false)
    {
        const report = Object.assign({}, CompilationReport);
        report.batch = batch;
        report.output = lgd.outputChannel;
        report.logger = lgd.logger;
        report.log = [];
        report.errors = 0;
        report.warnings = 0;
        report.compiled = 0;
        report.skipped = 0;
        report.failed = 0;
        report.startTime = Date.now();
        const progressMessage = batch ? `$(sync~spin) LGD: ${label}` : '$(zap) Compiling .js --> .d.ts';
        report.progress = vscode.window.setStatusBarMessage(progressMessage);
        report.output.appendLine(`\nLGD: ${label} started.`);
        return report;
    },

    add(compilation)
    {
        let outcome = 'Skipped (no supported declarations)';
        if(compilation.errorOccurred)
        {
            outcome = 'Failed';
            this.failed++;
        }
        else if(compilation.compiled)
        {
            outcome = 'Compiled';
            this.compiled++;
        }
        else
        {
            this.skipped++;
        }

        this.output.appendLine(`${outcome}: ${compilation.document.fileName}`);
        this.log.push(...compilation.logger.log);
        for(const entry of compilation.logger.log)
        {
            if(entry.startsWith('INFO:'))
            {
                this.output.appendLine(entry);
            }
        }

        for(const diagnosis of compilation.diagnostics)
        {
            let severity = 'Info';
            if(diagnosis.severity === vscode.DiagnosticSeverity.Error)
            {
                severity = 'Error';
                this.errors++;
            }
            else if(diagnosis.severity === vscode.DiagnosticSeverity.Warning)
            {
                severity = 'Warning';
                this.warnings++;
            }

            const position = diagnosis.range.start;
            this.output.appendLine(`${compilation.document.fileName}:${position.line + 1}:${position.character + 1}: ${severity}: ${diagnosis.message}`);
        }
    },

    /** @description Report failures that do not belong to a source file, such as workspace discovery. */
    reportError(error)
    {
        this.errors++;
        this.output.appendLine(`Error: ${error.message || String(error)}`);
    },

    async finish()
    {
        try
        {
            this.logger.log = this.log;
            await this.logger.write();
        }
        catch(error)
        {
            this.reportError(error);
        }
        finally
        {
            this.progress.dispose();
        }

        const elapsed = Date.now() - this.startTime;
        const summary = `LGD: ${this.compiled} compiled, ${this.skipped} skipped, ${this.failed} failed; ${this.errors} errors, ${this.warnings} warnings (${elapsed}ms).`;
        this.output.appendLine(summary);
        let status = StatusBarMessageTypes.SUCCESS;
        let statusMessage = `$(check) LGD compiled in ${elapsed}ms`;
        if(this.errors > 0)
        {
            status = StatusBarMessageTypes.ERROR;
            statusMessage = SeverityConverter.getStatusBarMessage(ErrorTypes.ERROR);
        }
        else if(this.warnings > 0)
        {
            status = StatusBarMessageTypes.WARNING;
            statusMessage = SeverityConverter.getStatusBarMessage(ErrorTypes.WARNING);
        }

        StatusBarMessage.show(this.batch ? summary : statusMessage, status);
    }
};

module.exports = CompilationReport;
