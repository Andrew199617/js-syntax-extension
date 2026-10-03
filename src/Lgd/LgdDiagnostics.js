const vscode = require('vscode');
const LgdDiagnosticDefinitions = require('./LgdDiagnosticDefinitions');

/**
 * @description Builds coded LGD diagnostics from precise compiler source spans.
 * @param {Object} document the original LGD source document.
 * @param {Array} errors compiler diagnostics.
 * @returns {Array} VS Code diagnostics.
 */
function createLgdDiagnostics(document, errors)
{
    const text = document.getText();
    return errors.map(error =>
    {
        const position = document.positionAt(Math.min(error.offset, text.length));
        const lineRange = document.lineAt(position.line).range;
        const end = Number.isInteger(error.endOffset)
            ? document.positionAt(Math.min(Math.max(error.offset, error.endOffset), text.length))
            : lineRange.end;
        const severity = error.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(position, end),
            error.message,
            severity
        );
        const definition = LgdDiagnosticDefinitions.get(error);
        diagnostic.source = definition.source;
        diagnostic.code = definition.visibleCode;
        return diagnostic;
    });
}

module.exports = createLgdDiagnostics;
