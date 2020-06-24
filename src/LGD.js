// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const path = require('path');
const GenerateTypings = require('./GenerateTypings');
const Configuration = require('./Core/Configuration');

const fs = require('fs');
const Logger = require('./Logging/Logger');
const CodeActions = require('./CodeActions/CodeActions');
const DefinitionProvider = require('./DefinitionProvider/DefinitionProvider');
const CompletionItemProvider = require('./CompletionItems/CompletionItemProvider');

const ErrorTypes = require('./Errors/ErrorTypes');
const SeverityConverter = require('./Core/ServerityConverter');
const StatusBarMessage = require('./Logging/StatusBarMessage');
const StatusBarMessageTypes = require('./Logging/StatusBarMessageTypes');

const FileIO = require('./Logging/FileIO');
const Document = require('./Core/Document');

const JS_EXT = ".js";
const COMPILE_COMMAND = "lgd.generateTypings";
const COMPILE_ALL_COMMAND = "lgd.generateTypingsForAll";

let actionProvider = null;
let definitionProvider = null;
let completionItemProvider = null;
const errorSeverity = SeverityConverter.getDiagnosticSeverity(ErrorTypes.ERROR);

async function executeGenerateTypings(document) {
  if (document.fileName.endsWith(JS_EXT)) {
    lgd.logger.log = [];
    await GenerateTypings.create(document, lgd.lgdDiagnosticCollection).execute()
    lgd.logger.notifyUser();

    const diagnostics = lgd.lgdDiagnosticCollection.get(document.uri);

    let anySevere = false;
    for(let i = 0; i < diagnostics.length; ++i) {
      if(diagnostics[i].severity === errorSeverity) {
        anySevere = true;
        break;
      }
    }

    if(anySevere) {
      vscode.window.showErrorMessage(`Error occurred parsing JavaScript File into TypeScript Definition File.`);
    }
  }
}

function activate(context) {
  const documentSelector = { schema: 'file', language: 'javascript' };

  lgd = {};
  // lgd.definitionProvider = DefinitionProvider.create();
  lgd.codeActions = CodeActions.create();
  lgd.lgdDiagnosticCollection = vscode.languages.createDiagnosticCollection();
  lgd.configuration = Configuration.create();
  lgd.logger = Logger.create('LGD.FileParser');

  // definitionProvider = vscode.languages.registerDefinitionProvider(
  //   documentSelector,
  //   lgd.definitionProvider
  // )

  if(lgd.configuration.options.autoComplete.enabled) {
    lgd.completionItemProvider = CompletionItemProvider.create();

    completionItemProvider = vscode.languages.registerCompletionItemProvider(
      documentSelector,
      lgd.completionItemProvider,
      '/', '*'
    )

    context.subscriptions.push(completionItemProvider);
    // lgd.completionItemProvider.registerCommands(context.subscriptions);
  }

  actionProvider = vscode.languages.registerCodeActionsProvider(
    documentSelector,
    lgd.codeActions,
    [ vscode.CodeActionKind.QuickFix ]
  );

  const compileCommand = vscode.commands.registerCommand(COMPILE_COMMAND, async () => {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const document = activeEditor.document;
      await executeGenerateTypings(document);

      if (!document.fileName.endsWith(JS_EXT)) {
        vscode.window.showWarningMessage("Can only compile .js file into .d.ts file.");
      }
    }
    else {
      vscode.window.showInformationMessage("This command is only available when a .js editor is open.");
    }
  });

  const compileAllCommand = vscode.commands.registerCommand(COMPILE_ALL_COMMAND, async () => {
    const uris = await vscode.workspace.findFiles('**/*.js', '**/node_modules/**')

    let completed = 0;
    for(let i = 0; i < uris.length; ++i) {
      const fileName = uris[i].fsPath;

      lgd.logger.log = [];

      fs.readFile(fileName, 'utf8', async (err, text) => {
        if(err) {
          throw err;
        }

        await GenerateTypings.create(Document.create(fileName, text, uris[i]), lgd.lgdDiagnosticCollection).execute();

        completed++;
        if(completed === uris.length) {
          lgd.logger.notifyUser();
        }
      });
    }
  });

  // compile on save when file is dirty
  const didSaveEvent = vscode.workspace.onDidSaveTextDocument(async document => {
    if (!lgd.configuration.options.generateTypings) {
      return;
    }

    await executeGenerateTypings(document);
  });

  // compile file when we change the document
  const didChangeEvent = vscode.workspace.onDidChangeTextDocument(async (TextChangedEvent) => {
    if (!lgd.configuration.options.generateTypingsOnChange) {
      return;
    }

    const document = TextChangedEvent.document;
    await executeGenerateTypings(document);
  })

  // dismiss errors on file close
  const didCloseEvent = vscode.workspace.onDidCloseTextDocument((doc) => {
    if (doc.fileName.endsWith(JS_EXT)) {
      lgd.lgdDiagnosticCollection.delete(doc.uri);
    }
  })

  const configurationChanged = vscode.workspace.onDidChangeConfiguration(() => {
    lgd.configuration = Configuration.create();
  });

  const onDidRenameFiles = vscode.workspace.onDidRenameFiles(fileRenameEvent => {
    const DEFAULT_DIR = 'typings';
    const DEFAULT_EXT = '.d.ts';

    for(let i = 0; i < fileRenameEvent.files.length; ++i) {
      const oldFileUri = fileRenameEvent.files[i].oldUri;
      const newFileUri = fileRenameEvent.files[i].newUri;

      const oldParsedPath = path.parse(oldFileUri.fsPath)
      const oldFileName = oldParsedPath.name;

      const newParsedPath = path.parse(newFileUri.fsPath)
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

      for(let k = 0; k < typeFilePaths.length; ++k) {
        const potentialPath = typeFilePaths[k];
        fs.exists(potentialPath.oldPath, exists => {

          if(!exists) {
            console.warn('LGD: File did not already exist.');
            return;
          }

          fs.exists(potentialPath.newPath, exists => {
            if(exists) {
              if(oldMaintainedRoot === newMaintainedRoot) {
                vscode.window.showErrorMessage(`LGD: Renamed to existing file. ${oldFileName} ->  ${newFileName}`);
              }

              return;
            }

            FileIO.rename(potentialPath.oldPath, potentialPath.newPath, () => {
              StatusBarMessage.show('LGD: Renamed successful.', StatusBarMessageTypes.SUCCESS)
            });
          });
        })
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
function deactivate() {
  if (lgd.lgdDiagnosticCollection) {
    lgd.lgdDiagnosticCollection.dispose();
  }

  if(actionProvider) {
    actionProvider.dispose();
  }

  if(definitionProvider) {
    definitionProvider.dispose();
  }

  if(completionItemProvider) {
    completionItemProvider.dispose();
  }

  if (lgd) {
    delete lgd;
  }
}


module.exports = {
  activate,
  deactivate
}