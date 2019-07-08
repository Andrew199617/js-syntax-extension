// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const  vscode = require('vscode');
const GenerateTypings = require('./GenerateTypings');
const Configuration = require('./Configuration');

const JS_EXT = ".js";
const COMPILE_COMMAND = "lgd.generateTypings";

global.lgd = {
    configuration: Configuration.create()
}

let lgdDiagnosticCollection;

function activate(context)
{
    if(!lgd.configuration.options.generateTypings) {
        return;
    }

    lgdDiagnosticCollection = vscode.languages.createDiagnosticCollection();

    const compileLessSub = vscode.commands.registerCommand(COMPILE_COMMAND, () =>
    {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor)
        {
            const document = activeEditor.document;

            if (document.fileName.endsWith(JS_EXT))
            {
                document.save();
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

    // compile less on save when file is dirty
    const didSaveEvent = vscode.workspace.onDidSaveTextDocument(document =>
    {
        if (document.fileName.endsWith(JS_EXT))
        {
            GenerateTypings.create(document, lgdDiagnosticCollection).execute()
        }
    });

    // compile less on save when file is clean (clean saves don't trigger onDidSaveTextDocument, so use this as fallback)
    const willSaveEvent = vscode.workspace.onWillSaveTextDocument(e =>
    {
        if (e.document.fileName.endsWith(JS_EXT) && !e.document.isDirty)
        {
            GenerateTypings.create(e.document, lgdDiagnosticCollection).execute()
        }
    });

    // dismiss less errors on file close
    const didCloseEvent = vscode.workspace.onDidCloseTextDocument((doc) =>
    {
        if (doc.fileName.endsWith(JS_EXT))
        {
            lgdDiagnosticCollection.delete(doc.uri);
        }
    })

    context.subscriptions.push(compileLessSub);
    context.subscriptions.push(willSaveEvent);
    context.subscriptions.push(didSaveEvent);
    context.subscriptions.push(didCloseEvent);
}

// this method is called when your extension is deactivated
function deactivate()
{
    if (lgdDiagnosticCollection)
    {
        lgdDiagnosticCollection.dispose();
    }

    if(lgd) {
        delete lgd;
    }
}


module.exports = {
    activate,
    deactivate
}