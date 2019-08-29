// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const  vscode = require('vscode');
const GenerateTypings = require('./GenerateTypings');
const Configuration = require('./Configuration');

const JS_EXT = ".js";
const COMPILE_COMMAND = "lgd.generateTypings";

global.lgd = {
    configuration: null,
    lgdDiagnosticCollection: null
}

// TODO: add generate propTypes command.
// "keybindings": [{
//     "command": "lgd.generateTypings",
//     "key": "ctrl+shift+c",
//     "mac": "cmd+shift+c",
//     "when": "editorTextFocus"
// }],

function activate(context)
{

    lgd.lgdDiagnosticCollection = vscode.languages.createDiagnosticCollection();
    lgd.configuration = Configuration.create();

    const compileCommand = vscode.commands.registerCommand(COMPILE_COMMAND, () =>
    {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor)
        {
            const document = activeEditor.document;

            if (document.fileName.endsWith(JS_EXT))
            {
                GenerateTypings.create(document, lgd.lgdDiagnosticCollection).execute()
            }
            else
            {
                vscode.window.showWarningMessage("This command only works for .js files.");
            }
        }
        else
        {
            vscode.window.showInformationMessage("This command is only available when a .js editor is open.");
        }
    });

    // compile on save when file is dirty
    const didSaveEvent = vscode.workspace.onDidSaveTextDocument(document =>
    {
        if(!lgd.configuration.options.generateTypings) {
            return;
        }

        if (document.fileName.endsWith(JS_EXT))
        {
            GenerateTypings.create(document, lgd.lgdDiagnosticCollection).execute()
        }
    });

    // compile js on save when file is clean (clean saves don't trigger onDidSaveTextDocument, so use this as fallback)
    const willSaveEvent = vscode.workspace.onWillSaveTextDocument(e =>
    {
        if(!lgd.configuration.options.generateTypings) {
            return;
        }

        if (e.document.fileName.endsWith(JS_EXT) && !e.document.isDirty)
        {
            GenerateTypings.create(e.document, lgd.lgdDiagnosticCollection).execute()
        }
    });

    // compile file when we change the document
    const didChangeEvent = vscode.workspace.onDidChangeTextDocument((TextChangedEvent) =>
    {
        if(!lgd.configuration.options.generateTypingsOnChange) {
            return;
        }

        const document = TextChangedEvent.document;
        if (document.fileName.endsWith(JS_EXT))
        {
            GenerateTypings.create(document, lgd.lgdDiagnosticCollection).execute()
        }
    })

    // dismiss errors on file close
    const didCloseEvent = vscode.workspace.onDidCloseTextDocument((doc) =>
    {
        if (doc.fileName.endsWith(JS_EXT))
        {
            lgd.lgdDiagnosticCollection.delete(doc.uri);
        }
    })

    const configurationChanged = vscode.workspace.onDidChangeConfiguration(() => {
        lgd.configuration = Configuration.create();
    });

    context.subscriptions.push(compileCommand);
    context.subscriptions.push(willSaveEvent);
    context.subscriptions.push(didSaveEvent);
    context.subscriptions.push(didChangeEvent);
    context.subscriptions.push(didCloseEvent);
    context.subscriptions.push(configurationChanged);
}

// this method is called when your extension is deactivated
function deactivate()
{
    if (lgd.lgdDiagnosticCollection)
    {
        lgd.lgdDiagnosticCollection.dispose();
    }

    if(lgd) {
        delete lgd;
    }
}


module.exports = {
    activate,
    deactivate
}