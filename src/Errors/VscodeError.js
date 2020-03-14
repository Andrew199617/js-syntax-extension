/* eslint-disable max-params */
const vscode = require('vscode');
const StatusBarMessage = require('../Logging/StatusBarMessage');
const SeverityConverter = require('../Core/ServerityConverter');
const ErrorTypes = require('./ErrorTypes');

/**
* @description An error occured that should be logged to the user and we can specify the line in the document that error occured.
* @type {VscodeErrorType}
*/
const VscodeError = {
  /**
   * @description all the errors that have occured for current document.
   */
  diagnostics: [],

  /**
   * @description the current document we are parsing.
   */
  currentDocument: null,

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

    lgd.lgdDiagnosticCollection.set(document.uri, VscodeError.diagnostics);

    StatusBarMessage.show(
      SeverityConverter.getStatusBarMessage(this.severity),
      SeverityConverter.getMessageType(this.severity)
    );

    if(this.severity === ErrorTypes.ERROR) {
      fileParser.errorOccured = true;
    }
  }
};

module.exports = VscodeError;