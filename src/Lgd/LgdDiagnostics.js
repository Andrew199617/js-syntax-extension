const vscode = require('vscode');
const LgdDiagnosticDefinitions = require('./LgdDiagnosticDefinitions');

/** @description Maps a diagnostic span for either an editor document or a saved-text snapshot. */
function diagnosticRange(document, text, error)
{
    const offset = Math.max(0, Math.min(error.offset || 0, text.length));
    let lineEnd = text.indexOf('\n', offset);
    if(lineEnd === -1)
    {
        lineEnd = text.length;
    }

    if(text[lineEnd - 1] === '\r')
    {
        lineEnd--;
    }

    const endOffset = Number.isInteger(error.endOffset)
        ? Math.min(Math.max(offset, error.endOffset), text.length)
        : Math.max(offset, lineEnd);
    if(typeof document.positionAt === 'function')
    {
        return new vscode.Range(document.positionAt(offset), document.positionAt(endOffset));
    }

    const startLines = text.slice(0, offset).split('\n');
    const endLines = text.slice(0, endOffset).split('\n');
    return new vscode.Range(startLines.length - 1, startLines.at(-1).length, endLines.length - 1, endLines.at(-1).length);
}

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
        const severity = error.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
        const diagnostic = new vscode.Diagnostic(
            diagnosticRange(document, text, error),
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
