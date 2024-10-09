const QuickFixAction = require('./QuickFixAction');
const vscode = require('vscode');
const { Oloo } = require('@mavega/oloo');

/**
* @description Remove the extends if it adds no value.
* @type {RemoveDefaultReactExtendsType}
* @extends {QuickFixActionType}
*/
const RemoveDefaultReactExtends = {
  /**
  * @description Initialize an instance of RemoveDefaultReactExtends.
  * @returns {RemoveDefaultReactExtendsType}
  */
  create(title) {
    const removeDefaultReactExtends = Oloo.assign(QuickFixAction.create(title), RemoveDefaultReactExtends);
    return removeDefaultReactExtends;
  },

  setupFix() {
    const startPosition = new vscode.Position(this.range.start.line, 0)
    const endPosition = new vscode.Position(this.range.end.line + 1, 0)
    this.edit.replace(this.document.uri, new vscode.Range(startPosition, endPosition), '');
    this.isPreferred = true;

    return true;
  },

  executeCommand() {
    Oloo.base(this, this.executeCommand);
  }
};

module.exports = RemoveDefaultReactExtends;