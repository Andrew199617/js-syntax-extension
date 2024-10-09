const vscode = require('vscode');
const { Oloo } = require('@mavega/oloo');

/**
* @description Base Completion Class that inherits vscode.
* @type {BaseCompletionItemType}
* @extends {vscode.CompletionItem}
*/
const BaseCompletionItem = {
  /**
  * @description Initialize an instance of BaseCompletionItem.
  * @param {string} label
  * @returns {BaseCompletionItemType}
  */
  create(label, detail) {
    const completionItem = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
    const baseCompletionItem = Oloo.assign(completionItem, BaseCompletionItem);

    /**
     * @description The active document we are going complete on.
     * @type {vscode.TextDocument}
     **/
    baseCompletionItem.document = null;

    baseCompletionItem.detail = detail;

    return baseCompletionItem;
  },

  /**
   * @description Although we inherit from CompletionItem we still want to
   * initialize some values before handing ourself off to CompletionProvider.
   * @param {vscode.TextDocument} document
   * @param {vscode.Range} position
   */
  getCompletionItem(document, position) {
    throw new Error('Not implemented.');
  }
};

module.exports = BaseCompletionItem;