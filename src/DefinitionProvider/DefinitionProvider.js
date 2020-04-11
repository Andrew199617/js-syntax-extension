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

  },

  registerCommands(subscriptions){

  }
};


module.exports = DefinitionProvider;