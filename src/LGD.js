// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const path = require('path');
const GenerateTypings = require('./GenerateTypings');
const Configuration = require('./Core/Configuration');
const fs = require('fs');

const Logger = require('./Logging/Logger');
const CompilationReport = require('./Logging/CompilationReport');
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

// VS Code emits separate save events for Save All; collect neighboring events into one report.
const SAVE_BATCH_DELAY_MS = 100;

// Documents waiting for the current save burst to finish.
const pendingSaves = new Map();

let actionProvider = null;
let completionItemProvider = null;
let saveTimer;

function clearPendingSaves()
{
    clearTimeout(saveTimer);
    saveTimer = null;
    pendingSaves.clear();
}

async function compileSavedDocuments()
{
    const documents = Array.from(pendingSaves.values());
    clearPendingSaves();
    const batch = documents.length > 1;
    const report = CompilationReport.create(batch ? 'Save all' : 'Save file', batch);
    const compilations = documents.map(document => GenerateTypings.create(document, lgd.lgdDiagnosticCollection).execute());
    const results = await Promise.allSettled(compilations);
    for(const result of results)
    {
        if(result.status === 'fulfilled')
        {
            report.add(result.value);
        }
        else
        {
            report.reportError(result.reason);
        }
    }

    await report.finish();
}

function queueSavedDocument(document)
{
    if(!document.fileName.endsWith(JS_EXT))
    {
        return;
    }

    const snapshot = Document.create(document.fileName, document.getText(), document.uri);
    pendingSaves.set(document.uri.toString(), snapshot);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(compileSavedDocuments, SAVE_BATCH_DELAY_MS);
}


async function compileFile(uri, report)
{
    const document = Document.create(uri.fsPath, '', uri);
    const compilation = GenerateTypings.create(document, lgd.lgdDiagnosticCollection);
    try
    {
        document._text = await fs.promises.readFile(uri.fsPath, 'utf8');
        await compilation.execute();
    }
    catch(error)
    {
        compilation.recordError(error);
    }

    report.add(compilation.compilationContext);
}

async function compileAllFiles()
{
    const report = CompilationReport.create('Compile all', true);
    try
    {
        const uris = await vscode.workspace.findFiles('**/*.js', '**/node_modules/**');
        const compilations = uris.map(uri => compileFile(uri, report));
        const results = await Promise.allSettled(compilations);
        for(const result of results)
        {
            if(result.status === 'rejected')
            {
                report.reportError(result.reason);
            }
        }
    }
    catch(error)
    {
        report.reportError(error);
    }

    await report.finish();
}

function reportRename(potentialPath, error)
{
    if(error?.code === 'EEXIST')
    {
        lgd.outputChannel.appendLine(`LGD: Skipped renaming ${potentialPath.oldPath}: ${potentialPath.newPath} already exists.`);
        return;
    }

    if(error)
    {
        console.error(error);
        lgd.outputChannel.appendLine(`LGD: Rename failed. ${error.message}`);
        StatusBarMessage.show('LGD: Rename failed.', StatusBarMessageTypes.ERROR);
        return;
    }

    StatusBarMessage.show('LGD: Renamed successful.', StatusBarMessageTypes.SUCCESS);
}

function renameTypings(potentialPath)
{
    if(potentialPath.oldPath === potentialPath.newPath)
    {
        return;
    }

    fs.exists(potentialPath.oldPath, sourceExists =>
    {
        if(!sourceExists)
        {
            console.warn('LGD: File did not already exist.');
            return;
        }

        FileIO.rename(potentialPath.oldPath, potentialPath.newPath, error => reportRename(potentialPath, error));
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
    lgd.outputChannel = vscode.window.createOutputChannel('LGD');
    context.subscriptions.push(lgd.outputChannel);

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
        if(!activeEditor || !activeEditor.document.fileName.endsWith(JS_EXT))
        {
            lgd.outputChannel.appendLine('LGD: Cannot compile the current file. Open a JavaScript (.js) file and try again.');
            return;
        }

        const document = activeEditor.document;
        await GenerateTypings.create(document, lgd.lgdDiagnosticCollection).executeGenerateTypings();
    });

    const compileAllCommand = vscode.commands.registerCommand(COMPILE_ALL_COMMAND, compileAllFiles);

    // compile on save when file is dirty
    const didSaveEvent = vscode.workspace.onDidSaveTextDocument(document =>
    {
        if(!lgd.configuration.generateTypings)
        {
            return;
        }

        queueSavedDocument(document);
    });

    // compile file when we change the document
    const didChangeEvent = vscode.workspace.onDidChangeTextDocument(async TextChangedEvent =>
    {
        if(!lgd.configuration.generateTypingsOnChange || TextChangedEvent.contentChanges.length === 0)
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

            const oldMaintainedRoot = path.relative(vscode.workspace.rootPath, oldParsedPath.dir);
            const newMaintainedRoot = path.relative(vscode.workspace.rootPath, newParsedPath.dir);

            const flattenedPaths = {
                oldPath: path.join(vscode.workspace.rootPath, DEFAULT_DIR, `${oldFileName}${DEFAULT_EXT}`),
                newPath: path.join(vscode.workspace.rootPath, DEFAULT_DIR, `${newFileName}${DEFAULT_EXT}`)
            };
            const maintainedPaths = {
                oldPath: path.join(vscode.workspace.rootPath, DEFAULT_DIR, oldMaintainedRoot, `${oldFileName}${DEFAULT_EXT}`),
                newPath: path.join(vscode.workspace.rootPath, DEFAULT_DIR, newMaintainedRoot, `${newFileName}${DEFAULT_EXT}`)
            };
            if(flattenedPaths.oldPath === maintainedPaths.oldPath || flattenedPaths.newPath === maintainedPaths.newPath)
            {
                const preferredPaths = lgd.configuration.maintainHierarchy ? maintainedPaths : flattenedPaths;
                renameTypings(preferredPaths);
                continue;
            }

            renameTypings(flattenedPaths);
            renameTypings(maintainedPaths);
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
    clearPendingSaves();
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
