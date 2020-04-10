/* eslint-disable max-params */
const vscode = require('vscode');
const StatusBarMessage = require('../Logging/StatusBarMessage');
const SeverityConverter = require('../Core/ServerityConverter');
const ErrorTypes = require('./ErrorTypes');
const { Oloo } = require('@learngamedevelopment/oloo');

/**
* @description An error occurred that should be logged to the user and we can specify the line in the document that error occurred.
* @type {VscodeErrorType}
*/
const VscodeError = {
  /**
   * @description all the errors that have occurred for current document.
   */
  diagnostics: [],

  /**
   * @description the current document we are parsing.
   * @type {vscode.TextDocument}
   */
  currentDocument: null,

  /**
  * @description Initialize an instance of VscodeError.
  * @param {string} message The message to tell the user.
  * @param {number} startLine Where the error began.
  * @param {number} startCharacter The Character it began at.
  * @param {number} endLine The Line error ended at.
  * @param {number} endCharacter The Character the error ended at.
  * @param {ErrorTypesType} severity HINT, WARNING, ERROR.
  * @returns {VscodeErrorType}
  */
  create(message, startLine, startCharacter, endLine, endCharacter, severity) {
    const vscodeError = Oloo.assign(new Error(), VscodeError);
    vscodeError.name = 'VscodeError';
    vscodeError.message = message;

    vscodeError.startLine = startLine;
    vscodeError.startCharacter = startCharacter || 0;
    vscodeError.endLine = endLine;
    vscodeError.endCharacter = vscodeError.startCharacter + (endCharacter || 0);

    vscodeError.severity = severity;

    /**
     * @description The code action that can be preformed to fix this Error.
     */
    vscodeError.codeAction = null;

    return vscodeError;
  },

  /**
   * @description Pass Code Action for diagnostic.
   * @param {vscode.CodeAction} codeAction
   * @returns {VscodeErrorType} chain notifyUser.
   */
  provideCodeAction(codeAction) {
    this.codeAction = codeAction;
    return this;
  },

  /**
   * @description Don't throw the error but fail compilation.
   */
  notifyUser(fileParser) {
    const document = VscodeError.currentDocument;

    if(!document) {
      // eslint-disable-next-line no-throw-literal
      throw this;
    }

    const range = new vscode.Range(this.startLine, this.startCharacter, this.endLine, this.endCharacter);

    const diagnosis = new vscode.Diagnostic(
      range,
      this.message,
      SeverityConverter.getDiagnosticSeverity(this.severity)
    );
    VscodeError.diagnostics.push(diagnosis);

    if(this.codeAction) {
      diagnosis.codeAction = this.codeAction;
    }

    lgd.lgdDiagnosticCollection.set(document.uri, VscodeError.diagnostics);

    StatusBarMessage.show(
      SeverityConverter.getStatusBarMessage(this.severity),
      SeverityConverter.getMessageType(this.severity)
    );

    if(this.severity === ErrorTypes.ERROR) {
      fileParser.errorOccurred = true;
    }
  }
};

module.exports = VscodeError;