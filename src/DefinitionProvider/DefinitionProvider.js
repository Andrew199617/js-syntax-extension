const vscode = require('vscode');

/**
* @description
* @type {DefinitionProviderType}
* @extends {vscode.DefinitionProvider}
*/
const DefinitionProvider = {
  /**
  * @description Initialize an instance of DefinitionProvider.
  * @returns {DefinitionProviderType}
  */
  create() {
    const definitionProvider = Object.create(DefinitionProvider);
    return definitionProvider;
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
  provideDefinition(document, position, token) {

    let linePrefix = document.lineAt(position).text.substr(0, position.character);
    if (!linePrefix.endsWith('/**')) {
      return undefined;
    }
    // \n* @description\n */
    return [
      this.documentSnippet()
    ];
  },

  documentSnippet() {
    const completionItem = new vscode.CompletionItem('/** LGD JsDoc */', vscode.CompletionItemKind.Snippet);
    completionItem.insertText = "";
    completionItem.sortText = "\0";

    const line = document.lineAt(position.line).text;
    const prefix = line.slice(0, position.character).match(/\/\**\s*$/);
    const suffix = line.slice(position.character).match(/^\s*\**\//);
    const start = position.translate(0, prefix ? -prefix[0].length : 0);
    completionItem.range = new Range(
        start,
        position.translate(0, suffix ? suffix[0].length : 0));

    completionItem.command = {
        title: "Insert Documentation",
        command: "lgd.insertDocumentation",
        arguments: [true]
    };

    return completionItem;
  }
};

module.exports = DefinitionProvider;