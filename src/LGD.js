// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const GenerateTypings = require('./GenerateTypings');
const Configuration = require('./Core/Configuration');

const fs = require('fs');
const Logger = require('./Logging/Logger');
const CodeActions = require('./CodeActions/CodeActions');

const Document = require('./Core/Document');

const JS_EXT = ".js";
const COMPILE_COMMAND = "lgd.generateTypings";
const COMPILE_ALL_COMMAND = "lgd.generateTypingsForAll";

lgd = require('./Core/Globals');

let actionProvider = null;

function activate(context) {
  const documentSelector = { schema: 'file', language: 'javascript' };

  lgd.codeActions = CodeActions.create();
  lgd.lgdDiagnosticCollection = vscode.languages.createDiagnosticCollection();
  lgd.configuration = Configuration.create();
  lgd.logger = Logger.create('LGD.FileParser');

  actionProvider = vscode.languages.registerCodeActionsProvider(
    documentSelector,
    {
      provideCodeActions(document, range, context, token) {
        lgd.codeActions.document = document;
        lgd.codeActions.range = range;
        lgd.codeActions.token = token;
        lgd.codeActions.context = context;

        const actions = [];
        context.diagnostics.forEach(element => {
          if(element.codeAction) {
            const fix = element.codeAction.createFix();
            if(fix) {
              actions.push(fix);
            }
            else if(element.codeAction.command) {
              actions.push(element.codeAction);
            }
          }
        });

        return actions;
      }
    },
    [ vscode.CodeActionKind.QuickFix ]
  );

  const compileCommand = vscode.commands.registerCommand(COMPILE_COMMAND, async () => {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const document = activeEditor.document;

      if (document.fileName.endsWith(JS_EXT)) {
        lgd.logger.log = [];
        await GenerateTypings.create(document, lgd.lgdDiagnosticCollection).execute();
        lgd.logger.notifyUser();
      }
      else {
        vscode.window.showWarningMessage("This command only works for .js files.");
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

      fs.readFile(uris[i].fsPath, 'utf8', async (err, text) => {
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

    if (document.fileName.endsWith(JS_EXT)) {
      lgd.logger.log = [];
      await GenerateTypings.create(document, lgd.lgdDiagnosticCollection).execute()
      lgd.logger.notifyUser();
    }
  });

  // compile file when we change the document
  const didChangeEvent = vscode.workspace.onDidChangeTextDocument(async (TextChangedEvent) => {
    if (!lgd.configuration.options.generateTypingsOnChange) {
      return;
    }

    const document = TextChangedEvent.document;
    if (document.fileName.endsWith(JS_EXT)) {
      lgd.logger.log = [];
      await GenerateTypings.create(document, lgd.lgdDiagnosticCollection).execute()
      lgd.logger.notifyUser();
    }
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

  context.subscriptions.push(compileCommand);
  context.subscriptions.push(compileAllCommand);
  context.subscriptions.push(didSaveEvent);
  context.subscriptions.push(didChangeEvent);
  context.subscriptions.push(didCloseEvent);
  context.subscriptions.push(configurationChanged);
  context.subscriptions.push(actionProvider);

  lgd.codeActions.registerCommands(context.subscriptions);
}

// this method is called when your extension is deactivated
function deactivate() {
  if (lgd.lgdDiagnosticCollection) {
    lgd.lgdDiagnosticCollection.dispose();
  }

  if(actionProvider) {
    actionProvider.dispose();
  }

  if (lgd) {
    delete lgd;
  }
}


module.exports = {
  activate,
  deactivate
}