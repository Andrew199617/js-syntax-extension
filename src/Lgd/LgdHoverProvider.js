const vscode = require('vscode');

/** @import { Hover, Position, TextDocument } from 'vscode' */

/**
 * @description Provides hovers for LGD documents by delegating to the TypeScript language
 * service on the compiled JavaScript mirror, translating positions both ways.
 * @type {LgdHoverProviderType}
 */
const LgdHoverProvider = {
    /**
     * @description Creates a hover provider bound to the LGD language service.
     * @param {LgdLanguageServiceType} languageService the LGD language service.
     * @returns {LgdHoverProviderType}
     */
    create(languageService)
    {
        const provider = Object.create(LgdHoverProvider);
        provider.languageService = languageService;
        return provider;
    },

    /**
     * @description Provides hover information for a position in an LGD document.
     * A rejected promise is left to VS Code, which treats a failed provider as no result.
     * @param {TextDocument} document the LGD document.
     * @param {Position} position the hovered position.
     * @returns {Promise<Hover|null>} the hover, or null when unavailable.
     */
    async provideHover(document, position)
    {
        const state = this.languageService.getState(document.uri);
        if(!state || !state.jsDocument)
        {
            return null;
        }

        const jsPosition = this.languageService.toJsPosition(document.uri, position);
        if(!jsPosition)
        {
            return null;
        }

        const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', state.jsDocument.uri, jsPosition);
        if(!hovers || hovers.length === 0)
        {
            return null;
        }

        const hover = hovers[0];
        const range = hover.range ? this.languageService.toLgdRange(document.uri, hover.range) : null;
        return new vscode.Hover(hover.contents, range);
    }
};

module.exports = LgdHoverProvider;
