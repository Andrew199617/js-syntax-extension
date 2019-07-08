
const  vscode = require('vscode');
const StatusBarMessageTypes = require('./StatusBarMessageTypes');

const ERROR_COLOR_CSS = "rgba(255,125,0,1)";
const ERROR_DURATION_MS = 10000;
const SUCCESS_DURATION_MS = 1500;

let errorMessage;

function hideError()
{
    if (errorMessage)
    {
        errorMessage.hide();
        errorMessage = null;
    }
}

function show(message, type)
{
    this.hideError();

    switch (type)
    {
        case StatusBarMessageTypes.SUCCESS:
            return vscode.window.setStatusBarMessage(message, SUCCESS_DURATION_MS);

        case StatusBarMessageTypes.INDEFINITE:
            return vscode.window.setStatusBarMessage(message);

        case StatusBarMessageTypes.ERROR:
            errorMessage = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
            errorMessage.text = message;
            errorMessage.command = "workbench.action.showErrorsWarnings";
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