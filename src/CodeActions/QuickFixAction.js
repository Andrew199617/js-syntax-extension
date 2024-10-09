const { Oloo } = require('@mavega/oloo');
const vscode = require('vscode');

/**
* @description
* @type {QuickFixActionType & vscode.CodeAction}
*/
const QuickFixAction = {
  /**
  * @description Initialize an instance of QuickFixAction.
  * @returns {QuickFixActionType & vscode.CodeAction}
  */
  create(title = 'Quick Fix') {
    const quickFixAction = Oloo.assign(new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix), QuickFixAction);

    /** @type {vscode.WorkspaceEdit} */
    quickFixAction.edit = null;

    /** @type {vscode.Command} */
    quickFixAction.command = null;

    return quickFixAction;
  },

  /**
   * @type {vscode.Range}
   */
  get range() {
    return lgd.codeActions.range;
  },

  /**
   * @type {vscode.CancellationToken}
   */
  get token() {
    return lgd.codeActions.token;
  },

  /**
   * @type {vscode.TextDocument}
   */
  get document() {
    return lgd.codeActions.document;
  },

  /**
   * @type {vscode.CodeActionContext}
   */
  get context() {
    return lgd.codeActions.context;
  },

  /** @type {string} The name to register command with. */
  get commandName() {
    return this.command.command;
  },

  /**
   * @description This Action will perform a fix.
   * @returns {QuickFixActionType}
   */
  createFix() {
    this.edit = new vscode.WorkspaceEdit();
    this.diagnostics = this.context.diagnostics;
    if(this.setupFix()) {
      return this;
    }

    return null;
  },

  /**
   * @description Inheriting class implements this.
   * @virtual
   */
  setupFix() {
    throw new Error('Not implemented');
  },

  getCommand() {
    this.diagnostics = this.context.diagnostics;
    return this;
  },

  createCommand(commandName, tooltip) {
    this.command = { command: commandName, title: this.title, tooltip };
    return vscode.commands.registerCommand(this.commandName, this.executeCommand.bind(this))
  },

  /**
   * @description Clears Diagnostic by default.
   */
  executeCommand() {
    // if not already removed.
    if(!lgd.configuration.options.generateTypingsOnChange) {
      let diagnostics = lgd.lgdDiagnosticCollection.get(this.document.uri);
      this.context.diagnostics.forEach(element => {
        diagnostics = diagnostics.filter(val => val !== element);
      });

      lgd.lgdDiagnosticCollection.set(this.document.uri, diagnostics);
    }
  }
};

module.exports = QuickFixAction