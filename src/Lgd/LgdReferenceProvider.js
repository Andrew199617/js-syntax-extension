const vscode = require('vscode');
const { mapProviderLocation } = require('./LgdDefinitionResolver');

/** @import { Location, Position, ReferenceContext, TextDocument } from 'vscode' */

/**
 * @description Provides find-references for LGD documents by delegating to the TypeScript
 * language service on the compiled JavaScript mirror, translating locations back to LGD.
 * @type {LgdReferenceProviderType}
 */
const LgdReferenceProvider = {
    /**
     * @description Creates a reference provider bound to the LGD language service.
     * @param {LgdLanguageServiceType} languageService the LGD language service.
     * @returns {LgdReferenceProviderType}
     */
    create(languageService)
    {
        const provider = Object.create(LgdReferenceProvider);
        provider.languageService = languageService;
        return provider;
    },

    /**
     * @description Provides reference locations for the symbol at a position in an LGD document.
     * A rejected promise is left to VS Code, which treats a failed provider as no result.
     * @param {TextDocument} document the LGD document.
     * @param {Position} position the cursor position.
     * @param {ReferenceContext} context whether the declaration itself is included.
     * @returns {Promise<Location[]|null>} the mapped reference locations, or null when unavailable.
     */
    async provideReferences(document, position, context)
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

        const locations = await vscode.commands.executeCommand(
            'vscode.executeReferenceProvider',
            state.jsDocument.uri,
            jsPosition,
            { includeDeclaration: context.includeDeclaration }
        );
        if(!locations)
        {
            return null;
        }

        const results = [];
        for(const location of locations)
        {
            const mapped = mapProviderLocation(this.languageService, location);
            if(mapped)
            {
                results.push(mapped);
            }
        }

        return results;
    }
};

module.exports = LgdReferenceProvider;
