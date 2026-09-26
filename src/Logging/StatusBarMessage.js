
const vscode = require('vscode');

// Supported categories for status bar notifications.
const StatusBarMessageTypes = require('./StatusBarMessageTypes');

// Error notification color.
const ERROR_COLOR_CSS = 'rgba(255,40,40,1)';

// Error notification duration in milliseconds.
const ERROR_DURATION_MS = 20000;

// Warning notification color.
const WARNING_COLOR_CSS = 'rgba(255,160,90,1)';

// Warning notification duration in milliseconds.
const WARNING_DURATION_MS = 10000;

// Hint notification color.
const HINT_COLOR_CSS = 'rgba(255,192,203,1)';

// Hint notification duration in milliseconds.
const HINT_DURATION_MS = 10000;

// Success notification color.
const SUCCESS_COLOR_CSS = 'rgba(60,255,60,1)';

// Success notification duration in milliseconds.
const SUCCESS_DURATION_MS = 2500;

function hideError(state)
{
    if(state.timeoutRef)
    {
        clearTimeout(state.timeoutRef);
        state.timeoutRef = null;
    }

    if(state.statusBarItem)
    {
        state.statusBarItem.hide();
        state.statusBarItem = null;
    }
}

function show(state, message, type)
{
    hideError(state);

    switch(type)
    {
        case StatusBarMessageTypes.SUCCESS:
            state.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
            state.statusBarItem.text = message;
            state.statusBarItem.command = 'workbench.action.showErrorsWarnings';
            state.statusBarItem.color = SUCCESS_COLOR_CSS;
            state.statusBarItem.show();
            state.timeoutRef = setTimeout(() => hideError(state), SUCCESS_DURATION_MS);

            return state.statusBarItem;

        case StatusBarMessageTypes.INDEFINITE:
            return vscode.window.setStatusBarMessage(message);

        case StatusBarMessageTypes.HINT:
            state.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
            state.statusBarItem.text = message;
            state.statusBarItem.command = 'workbench.action.showErrorsWarnings';
            state.statusBarItem.color = HINT_COLOR_CSS;
            state.statusBarItem.show();
            state.timeoutRef = setTimeout(() => hideError(state), HINT_DURATION_MS);

            return state.statusBarItem;

        case StatusBarMessageTypes.WARNING:
            state.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
            state.statusBarItem.text = message;
            state.statusBarItem.command = 'workbench.action.showErrorsWarnings';
            state.statusBarItem.color = WARNING_COLOR_CSS;
            state.statusBarItem.show();
            state.timeoutRef = setTimeout(() => hideError(state), WARNING_DURATION_MS);

            return state.statusBarItem;

        case StatusBarMessageTypes.ERROR:
            state.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
            state.statusBarItem.text = message;
            state.statusBarItem.command = 'workbench.action.showErrorsWarnings';
            state.statusBarItem.color = ERROR_COLOR_CSS;
            state.statusBarItem.show();
            state.timeoutRef = setTimeout(() => hideError(state), ERROR_DURATION_MS);

            return state.statusBarItem;
    }
}

function create()
{
    const state = { statusBarItem: null, timeoutRef: null };
    return {
        hideError: () => hideError(state),
        show: (message, type) => show(state, message, type)
    };
}

module.exports = {
    ...create(),
    create: create
};