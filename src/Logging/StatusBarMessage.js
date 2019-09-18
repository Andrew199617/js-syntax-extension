
const vscode = require('vscode');
const StatusBarMessageTypes = require('./StatusBarMessageTypes');

const ERROR_COLOR_CSS = 'rgba(255,60,60,1)';
const ERROR_DURATION_MS = 20000;

const WARNING_COLOR_CSS = 'rgba(255,160,90,1)';
const WARNING_DURATION_MS = 10000;

const HINT_COLOR_CSS = 'rgba(60,255,60,1)';
const HINT_DURATION_MS = 10000;

const SUCCESS_DURATION_MS = 1500;

let errorMessage;

function hideError() {
  if(errorMessage) {
    errorMessage.hide();
    errorMessage = null;
  }
}

function show(message, type) {
  hideError();

  switch(type) {
    case StatusBarMessageTypes.SUCCESS:
      return vscode.window.setStatusBarMessage(message, SUCCESS_DURATION_MS);

    case StatusBarMessageTypes.INDEFINITE:
      return vscode.window.setStatusBarMessage(message);

    case StatusBarMessageTypes.HINT:
      errorMessage = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
      errorMessage.text = message;
      errorMessage.command = 'workbench.action.showErrorsWarnings';
      errorMessage.color = HINT_COLOR_CSS;
      errorMessage.show();
      setTimeout(hideError, HINT_DURATION_MS);

      return errorMessage;

    case StatusBarMessageTypes.WARNING:
      errorMessage = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
      errorMessage.text = message;
      errorMessage.command = 'workbench.action.showErrorsWarnings';
      errorMessage.color = WARNING_COLOR_CSS;
      errorMessage.show();
      setTimeout(hideError, WARNING_DURATION_MS);

      return errorMessage;

    case StatusBarMessageTypes.ERROR:
      errorMessage = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
      errorMessage.text = message;
      errorMessage.command = 'workbench.action.showErrorsWarnings';
      errorMessage.color = ERROR_COLOR_CSS;
      errorMessage.show();
      setTimeout(hideError, ERROR_DURATION_MS);

      return errorMessage;
  }
}

module.exports = {
  hideError,
  show
}