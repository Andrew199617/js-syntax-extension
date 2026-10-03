const vscode = require('vscode');
const LgdAccessibilityEditor = require('./LgdAccessibilityEditor');
const { maskCode } = require('../Compilers/LgdInfer');

/** @import { CompletionItem, Position, TextDocument } from 'vscode' */

/**
 * @description Provides member completions for LGD documents. After 'object.',
 * lists the members of the LGD-declared object from the language service type
 * summary (object literal members, nominal type members, and cross-file exports).
 * After 'this.', lists the enclosing object literal members plus the properties its
 * create() method assigns.
 * @type {LgdCompletionProviderType}
 */
const LgdCompletionProvider = {
    /**
     * @description Creates a completion provider bound to the LGD language service.
     * @param {LgdLanguageServiceType} languageService the LGD language service.
     * @returns {LgdCompletionProviderType}
     */
    create(languageService)
    {
        const provider = Object.create(LgdCompletionProvider);
        provider.languageService = languageService;
        return provider;
    },

    /**
     * @description Provides member completion items for the object named before the dot
     * at the cursor. Returns null when the cursor is not after a member access or the
     * object has no known members, leaving other providers to answer. A rejected promise
     * is left to VS Code, which treats a failed provider as no result.
     * @param {TextDocument} document the LGD document.
     * @param {Position} position the cursor position.
     * @returns {Promise<Array<CompletionItem>|null>} the member items, or null when unavailable.
     */
    async provideCompletionItems(document, position)
    {
        const lineStart = new vscode.Position(position.line, 0);
        const code = maskCode(document.getText(), true);
        const prefix = code.slice(document.offsetAt(lineStart), document.offsetAt(position));
        const match = (/(?<objectName>[$A-Z_a-z][\w$]*)\??\.[\w$]*$/).exec(prefix);
        if(!match)
        {
            return null;
        }

        const state = this.languageService.getState(document.uri);
        if(match.groups.objectName === 'this')
        {
            const candidates = this.languageService.getThisMembers(document, position);
            const members = LgdAccessibilityEditor.filter(state, position, 'this', candidates);
            if(members.length === 0)
            {
                return null;
            }

            return members.map(member => this.toCompletionItem(member));
        }

        const summary = await this.languageService.getTypeSummary(document.uri, match.groups.objectName);
        if(!summary || summary.members.length === 0)
        {
            return null;
        }

        const candidates = summary.kind === 'class' ? summary.members.filter(member => member.static) : summary.members;
        const members = LgdAccessibilityEditor.filter(state, position, match.groups.objectName, candidates);
        return members.map(member => this.toCompletionItem(member));
    },

    /**
     * @description Converts an LGD member record to a VS Code completion item.
     * @param {Object} member the {name, kind} member, kind being 'method' or 'property'.
     * @returns {CompletionItem} the completion item.
     */
    toCompletionItem(member)
    {
        const kind = member.kind === 'method' ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Property;
        return new vscode.CompletionItem(member.name, kind);
    }
};

module.exports = LgdCompletionProvider;
