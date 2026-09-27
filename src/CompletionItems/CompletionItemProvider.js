const DocumentCode = require('./DocumentCode');

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
    create()
    {
        const completionItemProvider = Object.create(CompletionItemProvider);

        /**
         * @description The command handler to help with documenting code.
         * @type {DocumentCodeType}
         */
        completionItemProvider.documentCode = DocumentCode.create();

        return completionItemProvider;
    },

    /**
     * Provides documentation completions at the given document position.
     * @param {vscode.TextDocument} document The document in which the command was invoked.
     * @param {vscode.Range} position The position at which the command was invoked.
     * @return {[]} A definition or a thenable that resolves to such. The lack of a result can be
     * signaled by returning `undefined` or `null`.
     */
    provideCompletionItems(document, position)
    {
        const completionItems = [];

        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        if(linePrefix.endsWith('/**'))
        {
            completionItems.push(this.documentCode.getCompletionItem(document, position));
        }

        return completionItems.length > 0 ? completionItems : undefined;
    }
};


module.exports = CompletionItemProvider;
