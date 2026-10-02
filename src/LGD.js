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
const LgdLanguageService = require('./Lgd/LgdLanguageService');
const LgdHoverProvider = require('./Lgd/LgdHoverProvider');
const LgdDefinitionProvider = require('./Lgd/LgdDefinitionProvider');
const LgdReferenceProvider = require('./Lgd/LgdReferenceProvider');
const LgdCompletionProvider = require('./Lgd/LgdCompletionProvider');
const LgdSemanticTokensProvider = require('./Lgd/LgdSemanticTokensProvider');
const LgdCompiler = require('./Compilers/LgdCompiler');
const LgdTransform = require('./Parsers/LgdTransform');
const InvertIf = require('./Refactor/InvertIf');

// JavaScript source extension supported by the commands.
const JS_EXT = '.js';

// LGD source extension, from the transform facade.
const LGD_EXT = LgdTransform.LGD_EXT;

// Document selector for LGD language features.
const LGD_DOCUMENT_SELECTOR = { scheme: 'file', language: 'lgd' };

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

/**
 * @description Compiles an LGD document to JavaScript next to the source file.
 * When the compiler reports errors the previous output is left untouched, so a
 * broken save never overwrites working JavaScript with invalid code.
 * @param {object} document the saved LGD document.
 * @returns {Promise<void>}
 */
async function compileLgdDocument(document)
{
    const result = LgdCompiler.create().compileToJs(document.getText());
    if(result.errors.length > 0)
    {
        StatusBarMessage.show(`LGD: ${result.errors.length} error(s), .js output not updated.`, StatusBarMessageTypes.ERROR);
        return result;
    }

    const parsedPath = path.parse(document.fileName);
    const jsPath = path.join(parsedPath.dir, `${parsedPath.name}.js`);
    await FileIO.writeFileContents(jsPath, result.code);

    return result;
}

/**
 * @description Reports an LGD language service failure to the output channel.
 * @param {Error} error the failure.
 * @returns {void}
 */
function reportLgdError(error)
{
    console.error(error);
}

/**
 * @description Runs an LGD language service task and reports failures instead of crashing.
 * The returned promise never rejects, so event handlers can safely ignore it.
 * @param {Function} action the async task to run.
 * @returns {Promise<void>}
 */
async function runLgdTask(action)
{
    try
    {
        await action();
    }
    catch(error)
    {
        reportLgdError(error);
    }
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

/**
 * @description Compiles one LGD file to JavaScript and records it in the compile-all report.
 * @param {object} uri the LGD file uri.
 * @param {object} report the compilation report.
 * @returns {Promise<void>}
 */
async function compileLgdFile(uri, report)
{
    try
    {
        const text = await fs.promises.readFile(uri.fsPath, 'utf8');
        const result = await compileLgdDocument({ fileName: uri.fsPath, getText: () => text });
        const failed = result.errors.length > 0;
        report.add({
            errorOccurred: failed,
            compiled: !failed,
            document: { fileName: uri.fsPath },
            logger: { log: [] },
            diagnostics: result.errors.map(error => ({
                severity: vscode.DiagnosticSeverity.Error,
                range: { start: { line: error.line - 1, character: error.offset - (text.lastIndexOf('\n', error.offset - 1) + 1) } },
                message: `LGD: ${error.message}`
            }))
        });
    }
    catch(error)
    {
        report.reportError(error);
    }
}

async function compileAllFiles()
{
    const report = CompilationReport.create('Compile all', true);
    try
    {
        const jsUris = await vscode.workspace.findFiles('**/*.js', '**/node_modules/**');
        const lgdUris = await vscode.workspace.findFiles('**/*.lgd', '**/node_modules/**');
        const compilations = jsUris.map(uri => compileFile(uri, report));
        compilations.push(...lgdUris.map(uri => compileLgdFile(uri, report)));
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
    lgd.outputChannel = vscode.window.createOutputChannel('LGD');
    context.subscriptions.push(lgd.outputChannel);

    // definitionProvider = vscode.languages.registerDefinitionProvider(
    //   documentSelector,
    //   lgd.definitionProvider
    // )

    RefactorProvider.create(context);
    InvertIf.create().register(context);

    lgd.languageService = LgdLanguageService.create(lgd.lgdDiagnosticCollection, reportLgdError);

    const lgdHoverProvider = vscode.languages.registerHoverProvider(
        LGD_DOCUMENT_SELECTOR,
        LgdHoverProvider.create(lgd.languageService)
    );

    const lgdDefinitionProvider = vscode.languages.registerDefinitionProvider(
        LGD_DOCUMENT_SELECTOR,
        LgdDefinitionProvider.create(lgd.languageService)
    );

    const lgdReferenceProvider = vscode.languages.registerReferenceProvider(
        LGD_DOCUMENT_SELECTOR,
        LgdReferenceProvider.create(lgd.languageService)
    );

    const lgdCompletionProvider = vscode.languages.registerCompletionItemProvider(
        LGD_DOCUMENT_SELECTOR,
        LgdCompletionProvider.create(lgd.languageService),
        '.'
    );

    const lgdSemanticTokensProvider = vscode.languages.registerDocumentSemanticTokensProvider(
        LGD_DOCUMENT_SELECTOR,
        LgdSemanticTokensProvider.create(lgd.languageService),
        LgdSemanticTokensProvider.legend
    );

    context.subscriptions.push(lgdHoverProvider);
    context.subscriptions.push(lgdDefinitionProvider);
    context.subscriptions.push(lgdReferenceProvider);
    context.subscriptions.push(lgdCompletionProvider);
    context.subscriptions.push(lgdSemanticTokensProvider);

    // The open event fires before activation when it triggers it, so pick up
    // any LGD documents that are already visible.
    for(const openDocument of vscode.workspace.textDocuments)
    {
        if(openDocument.languageId === 'lgd')
        {
            runLgdTask(() => lgd.languageService.openDocument(openDocument));
        }
    }

    const didOpenLgdDocument = vscode.workspace.onDidOpenTextDocument(document =>
    {
        if(document.languageId === 'lgd')
        {
            runLgdTask(() => lgd.languageService.openDocument(document));
        }
    });

    context.subscriptions.push(didOpenLgdDocument);

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
            if(document.fileName.endsWith(LGD_EXT))
            {
                await compileLgdDocument(document);
                vscode.window.showInformationMessage('LGD: Compiled .lgd file into .js file.');
                return;
            }

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

    // recompile LGD documents as they are typed
    const didChangeLgdEvent = vscode.workspace.onDidChangeTextDocument(TextChangedEvent =>
    {
        const document = TextChangedEvent.document;
        if(document.languageId !== 'lgd' || TextChangedEvent.contentChanges.length === 0)
        {
            return;
        }

        runLgdTask(() => lgd.languageService.updateDocument(document));
    });

    // compile LGD to JavaScript on save, mirroring the .js to .d.ts flow
    const didSaveLgdEvent = vscode.workspace.onDidSaveTextDocument(document =>
    {
        if(document.languageId !== 'lgd' || !lgd.configuration.generateTypings)
        {
            return;
        }

        runLgdTask(() => compileLgdDocument(document));
    });

    // dismiss errors on file close
    const didCloseEvent = vscode.workspace.onDidCloseTextDocument(doc =>
    {
        if(doc.fileName.endsWith(JS_EXT))
        {
            lgd.lgdDiagnosticCollection.delete(doc.uri);
        }

        if(doc.languageId === 'lgd' || doc.fileName.endsWith(LGD_EXT))
        {
            lgd.languageService.closeDocument(doc);
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

            const typeFilePaths = [
                {
                    oldPath: path.join(vscode.workspace.rootPath, DEFAULT_DIR, `${oldFileName}${DEFAULT_EXT}`),
                    newPath: path.join(vscode.workspace.rootPath, DEFAULT_DIR, `${newFileName}${DEFAULT_EXT}`),
                    isMaintained: false
                },
                {
                    oldPath: path.join(vscode.workspace.rootPath, DEFAULT_DIR, oldMaintainedRoot, `${oldFileName}${DEFAULT_EXT}`),
                    newPath: path.join(vscode.workspace.rootPath, DEFAULT_DIR, newMaintainedRoot, `${newFileName}${DEFAULT_EXT}`),
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
    context.subscriptions.push(didSaveLgdEvent);
    context.subscriptions.push(didChangeEvent);
    context.subscriptions.push(didChangeLgdEvent);
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
