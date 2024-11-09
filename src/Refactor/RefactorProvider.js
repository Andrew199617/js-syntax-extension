const vscode = require('vscode');
const InvertIf = require('./InvertIf');
const { Oloo } = require('@mavega/oloo');
const ExtractFunction = require('./ExtractFunction');

/**
 * @description Provides refactoring actions for inverting if statements.
 * @type {RefactorProviderType}
 * @extends {vscode.CodeActionProvider}
 */
const RefactorProvider = {
  /**
   * @description Initializes the RefactorProvider.
   * @param {vscode.ExtensionContext} context
   */
  create(context) {
    const refactorProvider = Oloo.create(RefactorProvider);
    refactorProvider.context = context;
    refactorProvider.register();

    refactorProvider.extractFunction = ExtractFunction.create();
    refactorProvider.extractFunction.register(context);
    return refactorProvider;
  },

  /**
   * @description Registers the Code Action provider.
   */
  register() {
    const provider = vscode.languages.registerCodeActionsProvider(
      [ 'javascript', 'typescript' ],
      this,
      {
        providedCodeActionKinds: this.providedCodeActionKinds
      }
    );
    this.context.subscriptions.push(provider);
  },

  /**
   * @description Defines the kinds of code actions provided.
   * @returns {vscode.CodeActionKind[]}
   */
  get providedCodeActionKinds() {
    return [vscode.CodeActionKind.Refactor];
  },

  /**
   * @description Provides code actions for the given document and range.
   * @param {vscode.TextDocument} document
   * @param {vscode.Range} range
   * @param {vscode.CodeActionContext} context
   * @returns {vscode.CodeAction[]}
   */
  provideCodeActions(document, range, context) {
    const codeActions = [];

    if(this.extractFunction.shouldProvideRefactor(document, range, context)) {
      codeActions.push(this.extractFunction.createCodeAction(document, range, context));
    }

    const lineText = document.lineAt(range.start.line).text;

    // Find the if statement on the current line
    const ifRegex = /if\s*\(((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*)\)\s*{/;
    const match = ifRegex.exec(lineText);

    if(!match) {
      return codeActions;
    }

    const invertIfAction = new vscode.CodeAction(
      'Invert If Statement',
      vscode.CodeActionKind.Refactor
    );
    invertIfAction.command = {
      command: 'lgd.invertIf',
      title: 'Invert If Statement',
      arguments: [ document, range ]
    };
    codeActions.push(invertIfAction);
    return codeActions;
  }
};

module.exports = RefactorProvider;
