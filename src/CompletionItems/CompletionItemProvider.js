const DocumentCode = require('./DocumentCode');

/** @import { CompletionItem, Position, TextDocument } from 'vscode' */

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
     * @param {TextDocument} document The document in which completion was requested.
     * @param {Position} position The cursor position at which completion was requested.
     * @returns {CompletionItem[] | undefined} Documentation snippets available at the cursor, or no result.
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
