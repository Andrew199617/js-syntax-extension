const StatusBarMessageTypes = require('./Logging/StatusBarMessageTypes');
const vscode = require('vscode');
const ErrorTypes = require('./Errors/ErrorTypes');

/**
* @description
* @type {ServerityConverterType}
* @static
*/
const ServerityConverter = {
  getDiagnosticSeverity(severity) {
    switch(severity) {
      case ErrorTypes.HINT:
        return vscode.DiagnosticSeverity.Information;

      case ErrorTypes.WARNING:
        return vscode.DiagnosticSeverity.Warning;

      case ErrorTypes.ERROR:
        return vscode.DiagnosticSeverity.Error;
    }
  },

  getMessageType(severity) {
    switch(severity) {
      case ErrorTypes.HINT:
        return StatusBarMessageTypes.HINT;

      case ErrorTypes.WARNING:
        return StatusBarMessageTypes.WARNING;

      case ErrorTypes.ERROR:
        return StatusBarMessageTypes.ERROR;
    }
  },

  getStatusBarMessage(severity) {
    switch(severity) {
      case ErrorTypes.HINT:
        return '$(alert) Hint can be found in Problems window ctrl+shift+M';

      case ErrorTypes.WARNING:
        return '$(alert) Warning occured compiling JS to TS (more detail in Problems window ctrl+shift+M)';

      case ErrorTypes.ERROR:
        return '$(alert) Error compiling JS to TS (more detail in Problems window ctrl+shift+M)';
    }
  }
};

module.exports = ServerityConverter;