const DocumentCode = require('./DocumentCode');
const vscode = require('vscode');

/**
* @description Provide completion for snippets that can't be added through snippets.json.
* @type {CompletionItemProviderType}
* @extends {vscode.CompletionItemProvider}
*/
const CompletionItemProvider = {
  /**
  * @description Initialize an instance of CompletionItemProvider.
  * @returns {CompletionItemProviderType}
  */
  create() {
    const completionItemProvider = Object.create(CompletionItemProvider);

    /**
     * @description The command handler to help with documenting code.
     * @type {DocumentCodeType}
     */
    completionItemProvider.documentCode = DocumentCode.create();

    return completionItemProvider;
  },

  /**
   * Provide the definition of the symbol at the given position and document.
   *
   * @param {vscode.TextDocument} document The document in which the command was invoked.
   * @param {vscode.Range} position The position at which the command was invoked.
   * @param {vscode.CancellationToken} token A cancellation token.
   * @return {[]} A definition or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined` or `null`.
   */
  provideCompletionItems(document, position, token) {
    const completionItems = [];

    let linePrefix = document.lineAt(position).text.substr(0, position.character);
    if (linePrefix.endsWith('/**')) {
      completionItems.push(this.documentCode.getCompletionItem(document, position));
    }

    return completionItems.length > 0 ? completionItems : undefined;
  }
};


module.exports = CompletionItemProvider;