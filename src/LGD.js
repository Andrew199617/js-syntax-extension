// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const path = require('path');
const GenerateTypings = require('./GenerateTypings');
const Configuration = require('./Core/Configuration');
const fs = require('fs');

const Logger = require('./Logging/Logger');
const CodeActions = require('./CodeActions/CodeActions');
const CompletionItemProvider = require('./CompletionItems/CompletionItemProvider');

const StatusBarMessage = require('./Logging/StatusBarMessage');
const StatusBarMessageTypes = require('./Logging/StatusBarMessageTypes');

const FileIO = require('./Logging/FileIO');
const Document = require('./Core/Document');
const RefactorProvider = require('./Refactor/RefactorProvider');
const InvertIf = require('./Refactor/InvertIf');

// JavaScript source extension supported by the commands.
const JS_EXT = '.js';

// Command identifier for compiling the active file.
const COMPILE_COMMAND = 'lgd.generateTypings';

// Command identifier for compiling all workspace files.
const COMPILE_ALL_COMMAND = 'lgd.generateTypingsForAll';

let actionProvider = null;
let completionItemProvider = null;


async function compileFile(uri)
{
    const text = await fs.promises.readFile(uri.fsPath, 'utf8');
    const document = Document.create(uri.fsPath, text, uri);
    await GenerateTypings.create(document, lgd.lgdDiagnosticCollection).execute();
}

async function compileAllFiles()
{
    const uris = await vscode.workspace.findFiles('**/*.js', '**/node_modules/**');
    lgd.logger.log = [];
    try
    {
        const compilations = uris.map(compileFile);
        const results = await Promise.allSettled(compilations);
        const failure = results.find(result => result.status === 'rejected');
        if(failure)
        {
            throw failure.reason;
        }
    }
    finally
    {
        lgd.logger.notifyUser();
    }
}

function reportRename(error)
{
    if(error)
    {
        console.error(error);
        StatusBarMessage.show('LGD: Rename failed.', StatusBarMessageTypes.ERROR);
        return;
    }

    StatusBarMessage.show('LGD: Renamed successful.', StatusBarMessageTypes.SUCCESS);
}

function renameTypings(potentialPath, context)
{
    fs.exists(potentialPath.oldPath, sourceExists =>
    {
        if(!sourceExists)
        {
            console.warn('LGD: File did not already exist.');
            return;
        }

        fs.exists(potentialPath.newPath, targetExists =>
        {
            if(targetExists)
            {
                if(context.oldMaintainedRoot === context.newMaintainedRoot)
                {
                    vscode.window.showErrorMessage(`LGD: Renamed to existing file. ${context.oldFileName} -> ${context.newFileName}`);
                }

                return;
            }

            FileIO.rename(potentialPath.oldPath, potentialPath.newPath, reportRename);
        });
    });
}

function activate(context)
{
    const documentSelector = { schema: 'file', language: 'javascript' };

    globalThis.lgd = {};

    // lgd.definitionProvider = DefinitionProvider.create();
    lgd.codeActions = CodeActions.create();
    lgd.lgdDiagnosticCollection = vscode.languages.createDiagnosticCollection();
    lgd.configuration = Configuration.create();
    lgd.logger = Logger.create('LGD.FileParser');

    // definitionProvider = vscode.languages.registerDefinitionProvider(
    //   documentSelector,
    //   lgd.definitionProvider
    // )

    RefactorProvider.create(context);
    InvertIf.create().register(context);

    if(lgd.configuration.autoComplete.enabled)
    {
        lgd.completionItemProvider = CompletionItemProvider.create();

        completionItemProvider = vscode.languages.registerCompletionItemProvider(
            documentSelector,
            lgd.completionItemProvider,
            '/', '*'
        );

        context.subscriptions.push(completionItemProvider);

    // lgd.completionItemProvider.registerCommands(context.subscriptions);
    }

    actionProvider = vscode.languages.registerCodeActionsProvider(
        documentSelector,
        lgd.codeActions,
        [vscode.CodeActionKind.QuickFix]
    );

    const compileCommand = vscode.commands.registerCommand(COMPILE_COMMAND, async () =>
    {
        const activeEditor = vscode.window.activeTextEditor;
        if(activeEditor)
        {
            const document = activeEditor.document;
            await GenerateTypings.create(document, lgd.lgdDiagnosticCollection).executeGenerateTypings();

            if(!document.fileName.endsWith(JS_EXT))
            {
                vscode.window.showWarningMessage('Can only compile .js file into .d.ts file.');
            }
        }
        else
        {
            vscode.window.showInformationMessage('This command is only available when a .js editor is open.');
        }
    });

    const compileAllCommand = vscode.commands.registerCommand(COMPILE_ALL_COMMAND, compileAllFiles);

    // compile on save when file is dirty
    const didSaveEvent = vscode.workspace.onDidSaveTextDocument(async document =>
    {
        if(!lgd.configuration.generateTypings)
        {
            return;
        }

        await GenerateTypings.create(document, lgd.lgdDiagnosticCollection).executeGenerateTypings();
    });

    // compile file when we change the document
    const didChangeEvent = vscode.workspace.onDidChangeTextDocument(async TextChangedEvent =>
    {
        if(!lgd.configuration.generateTypingsOnChange)
        {
            return;
        }

        const document = TextChangedEvent.document;
        await GenerateTypings.create(document, lgd.lgdDiagnosticCollection).executeGenerateTypings();
    });

    // dismiss errors on file close
    const didCloseEvent = vscode.workspace.onDidCloseTextDocument(doc =>
    {
        if(doc.fileName.endsWith(JS_EXT))
        {
            lgd.lgdDiagnosticCollection.delete(doc.uri);
        }
    });

    const configurationChanged = vscode.workspace.onDidChangeConfiguration(() =>
    {
        lgd.configuration = Configuration.create();
    });

    const onDidRenameFiles = vscode.workspace.onDidRenameFiles(fileRenameEvent =>
    {
        const DEFAULT_DIR = 'typings';
        const DEFAULT_EXT = '.d.ts';

        for(let i = 0; i < fileRenameEvent.files.length; ++i)
        {
            const oldFileUri = fileRenameEvent.files[i].oldUri;
            const newFileUri = fileRenameEvent.files[i].newUri;

            const oldParsedPath = path.parse(oldFileUri.fsPath);
            const oldFileName = oldParsedPath.name;

            const newParsedPath = path.parse(newFileUri.fsPath);
            const newFileName = newParsedPath.name;

            const oldMaintainedRoot = oldParsedPath.dir.replace(vscode.workspace.rootPath, '');
            const newMaintainedRoot = newParsedPath.dir.replace(vscode.workspace.rootPath, '');

            const typeFilePaths = [
                {
                    oldPath: `${vscode.workspace.rootPath}\\${DEFAULT_DIR}\\${oldFileName}${DEFAULT_EXT}`,
                    newPath: `${vscode.workspace.rootPath}\\${DEFAULT_DIR}\\${newFileName}${DEFAULT_EXT}`,
                    isMaintained: false
                },
                {
                    oldPath: `${vscode.workspace.rootPath}\\${DEFAULT_DIR}${oldMaintainedRoot}\\${oldFileName}${DEFAULT_EXT}`,
                    newPath: `${vscode.workspace.rootPath}\\${DEFAULT_DIR}${newMaintainedRoot}\\${newFileName}${DEFAULT_EXT}`,
                    isMaintained: true
                }
            ];

            for(let k = 0; k < typeFilePaths.length; ++k)
            {
                const potentialPath = typeFilePaths[k];
                renameTypings(potentialPath, {
                    oldMaintainedRoot: oldMaintainedRoot,
                    newMaintainedRoot: newMaintainedRoot,
                    oldFileName: oldFileName,
                    newFileName: newFileName
                });
            }
        }
    });

    context.subscriptions.push(compileCommand);
    context.subscriptions.push(compileAllCommand);
    context.subscriptions.push(didSaveEvent);
    context.subscriptions.push(didChangeEvent);
    context.subscriptions.push(didCloseEvent);
    context.subscriptions.push(onDidRenameFiles);
    context.subscriptions.push(configurationChanged);
    context.subscriptions.push(actionProvider);

    // context.subscriptions.push(definitionProvider);

    lgd.codeActions.registerCommands(context.subscriptions);

    // lgd.definitionProvider.registerCommands(context.subscriptions);
}

// this method is called when your extension is deactivated
function deactivate()
{
    if(globalThis.lgd?.lgdDiagnosticCollection)
    {
        lgd.lgdDiagnosticCollection.dispose();
    }

    if(actionProvider)
    {
        actionProvider.dispose();
    }

    if(completionItemProvider)
    {
        completionItemProvider.dispose();
    }

    if(globalThis.lgd)
    {
        delete globalThis.lgd;
    }
}


module.exports = {
    activate,
    deactivate
};