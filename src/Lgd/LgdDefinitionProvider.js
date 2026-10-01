const vscode = require('vscode');

/** @import { Definition, Location, Position, TextDocument } from 'vscode' */

/**
 * @description Provides go-to-definition for LGD documents by delegating to the TypeScript
 * language service on the compiled JavaScript mirror, translating locations back to LGD.
 * @type {LgdDefinitionProviderType}
 */
const LgdDefinitionProvider = {
    /**
     * @description Creates a definition provider bound to the LGD language service.
     * @param {LgdLanguageServiceType} languageService the LGD language service.
     * @returns {LgdDefinitionProviderType}
     */
    create(languageService)
    {
        const provider = Object.create(LgdDefinitionProvider);
        provider.languageService = languageService;
        return provider;
    },

    /**
     * @description Provides the definition of the symbol at a position in an LGD document.
     * A rejected promise is left to VS Code, which treats a failed provider as no result.
     * @param {TextDocument} document the LGD document.
     * @param {Position} position the cursor position.
     * @returns {Promise<Definition|null>} the mapped definitions, or null when unavailable.
     */
    async provideDefinition(document, position)
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

        const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', state.jsDocument.uri, jsPosition);
        if(!definitions)
        {
            return null;
        }

        const items = Array.isArray(definitions) ? definitions : [definitions];
        const locations = [];
        for(const item of items)
        {
            const targetUri = item.targetUri || item.uri;
            const targetRange = item.targetRange || item.range;
            if(!targetUri || targetUri.toString() !== state.jsDocument.uri.toString())
            {
                continue;
            }

            const lgdRange = this.languageService.toLgdRange(document.uri, targetRange);
            if(lgdRange)
            {
                locations.push(new vscode.Location(document.uri, lgdRange));
            }
        }

        return locations;
    }
};

module.exports = LgdDefinitionProvider;
