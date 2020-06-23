
const vscode = require('vscode');
const StatusBarMessageTypes = require('./StatusBarMessageTypes');

const ERROR_COLOR_CSS = 'rgba(255,40,40,1)';
const ERROR_DURATION_MS = 20000;

const WARNING_COLOR_CSS = 'rgba(255,160,90,1)';
const WARNING_DURATION_MS = 10000;

const HINT_COLOR_CSS = 'rgba(255,192,203,1)';
const HINT_DURATION_MS = 10000;

const SUCCESS_COLOR_CSS = 'rgba(60,255,60,1)';
const SUCCESS_DURATION_MS = 2500;

let statusBarItem;
let timeoutRef;

function hideError() {
  if(timeoutRef) {
    clearTimeout(timeoutRef)
    timeoutRef = null;
  }

  if(statusBarItem) {
    statusBarItem.hide();
    statusBarItem = null;
  }
}

function show(message, type) {
  hideError();

  switch(type) {
    case StatusBarMessageTypes.SUCCESS:
      statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
      statusBarItem.text = message;
      statusBarItem.command = 'workbench.action.showErrorsWarnings';
      statusBarItem.color = SUCCESS_COLOR_CSS;
      statusBarItem.show();
      timeoutRef = setTimeout(hideError, SUCCESS_DURATION_MS);

      return statusBarItem;

    case StatusBarMessageTypes.INDEFINITE:
      return vscode.window.setStatusBarMessage(message);

    case StatusBarMessageTypes.HINT:
      statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
      statusBarItem.text = message;
      statusBarItem.command = 'workbench.action.showErrorsWarnings';
      statusBarItem.color = HINT_COLOR_CSS;
      statusBarItem.show();
      timeoutRef = setTimeout(hideError, HINT_DURATION_MS);

      return statusBarItem;

    case StatusBarMessageTypes.WARNING:
      statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
      statusBarItem.text = message;
      statusBarItem.command = 'workbench.action.showErrorsWarnings';
      statusBarItem.color = WARNING_COLOR_CSS;
      statusBarItem.show();
      timeoutRef = setTimeout(hideError, WARNING_DURATION_MS);

      return statusBarItem;

    case StatusBarMessageTypes.ERROR:
      statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
      statusBarItem.text = message;
      statusBarItem.command = 'workbench.action.showErrorsWarnings';
      statusBarItem.color = ERROR_COLOR_CSS;
      statusBarItem.show();
      timeoutRef = setTimeout(hideError, ERROR_DURATION_MS);

      return statusBarItem;
  }
}

module.exports = {
  hideError,
  show
}