const MoveCreateReactClass = require('./MoveCreateReactClass');

/**
* @description The code actions for this extension.
* @type {CodeActionsType}
*/
const CodeActions = {
  /**
  * @description Initialize an instance of CodeActions.
  * @returns {CodeActionsType}
  */
  create() {
    const codeActions = Object.create(CodeActions);

    codeActions.document = null;
    codeActions.range = null;
    codeActions.token = null;
    codeActions.context = null;

    /** @type {MoveCreateReactClassType & QuickFixActionType} */
    codeActions.moveCreateReactClass = MoveCreateReactClass.create('Move to export');

    return codeActions;
  },

  /**
   * @description Called by vscode to provide code Actions.
   * @param {vscode.TextDocument} document
   * @param {vscode.Range} range
   * @param {vscode.CodeActionContext} context
   * @param {vscode.CancellationToken} token
   * @returns
   */
  provideCodeActions(document, range, context, token) {
    this.document = document;
    this.range = range;
    this.token = token;
    this.context = context;

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
  },

  /**
   * @description Register commands with vscode.
   * @param subscriptions the vscode subscription to push to.
   */
  registerCommands(subscriptions) {
    subscriptions.push(this.moveCreateReactClass.createCommand('lgd.moveToExport', 'Move Create React Class to Export.'));
  }
};

module.exports = CodeActions;