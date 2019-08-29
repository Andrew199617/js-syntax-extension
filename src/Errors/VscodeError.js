const vscode = require('vscode');
const StatusBarMessage = require("../Logging/StatusBarMessage");
const SeverityConverter = require('../ServerityConverter');

/**
* @description An error occured that should be logged to the user and we can specify the line in the document that error occured.
* @type {VscodeErrorType}
*/
const VscodeError = {
  /**
  * @description Initialize an instace of VscodeError.
  * @param {string} message The message to tell the user.
  * @param {number} startLine Where the error began.
  * @param {number} startCharacter The Character it began at.
  * @param {number} endLine The Line error ended at.
  * @param {number} endCharacter The Character the error ended at.
  * @param {ErrorTypesType} severity HINT, WARNING, ERROR.
  * @returns {VscodeErrorType}
  */
  create(message, startLine, startCharacter, endLine, endCharacter, severity) {
    const vscodeError = Object.assign({}, VscodeError);
    vscodeError.name = 'VscodeError';
    vscodeError.message = message;

    vscodeError.startLine = startLine;
    vscodeError.startCharacter = startCharacter || 0;
    vscodeError.endLine = endLine;
    vscodeError.endCharacter = endCharacter || 0;

    vscodeError.severity = severity;

    Error.call(vscodeError);
    Error.captureStackTrace(vscodeError, { message });

    return vscodeError;
  },

  /**
   * @description Don't throw the error and stop compiling.
   */
  notifyUser() {
    const activeEditor = vscode.window.activeTextEditor;

    if (!activeEditor) {
      throw this;
    }

    const document = activeEditor.document;

    let range = new vscode.Range(this.startLine, this.startCharacter, this.endLine, this.endCharacter);

    const diagnosis = new vscode.Diagnostic(range, this.message, SeverityConverter.getDiagnosticSeverity(this.severity));
    lgd.lgdDiagnosticCollection.set(document.uri, [diagnosis]);

    StatusBarMessage.show(SeverityConverter.getStatusBarMessage(this.severity), SeverityConverter.getMessageType(this.severity));
  }
};

module.exports = VscodeError;