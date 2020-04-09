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

  registerCommands(subscriptions) {
    subscriptions.push(this.moveCreateReactClass.createCommand('lgd.moveToExport', 'Move Create React Class to Export.'));
  }
};

module.exports = CodeActions;