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
     * @param {string} detail Text shown alongside the completion label.
     * @returns {BaseCompletionItemType}
     */
    create(label, detail)
    {
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

    /** @description Requires derived completion items to prepare their values before returning them to the completion provider. */
    getCompletionItem()
    {
        throw new Error('Not implemented.');
    }
};

module.exports = BaseCompletionItem;
