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
     * @description Formats one typed parameter as 'Type name' for hover signatures.
     * @param {Object} parameter the {name, typeName} parameter.
     * @returns {string} the formatted parameter.
     */
    formatTypedParameter(parameter)
    {
        return parameter.typeName ? `${parameter.typeName} ${parameter.name}` : parameter.name;
    },

    /**
     * @description Provides hover information for a position in an LGD document.
     * Declared names with known members get an LGD type summary (TypeScript cannot
     * expand nominal types like GoToNextParagraph); everything else falls back to the
     * TypeScript hover on the compiled mirror. A rejected promise is left to VS Code,
     * which treats a failed provider as no result.
     * @param {TextDocument} document the LGD document.
     * @param {Position} position the hovered position.
     * @returns {Promise<Hover|null>} the hover, or null when unavailable.
     */
    async provideHover(document, position)
    {
        const state = this.languageService.getState(document.uri);
        if(!state)
        {
            return null;
        }

        const wordRange = document.getWordRangeAtPosition(position);
        if(wordRange)
        {
            const summary = await this.languageService.getTypeSummary(document.uri, document.getText(wordRange));
            if(summary && (summary.members.length > 0 || summary.params.length > 0))
            {
                return new vscode.Hover(this.renderTypeSummary(summary), wordRange);
            }
        }

        if(!state.jsDocument)
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
    },

    /**
     * @description Renders an LGD-style type summary for a declared nominal type or function signature.
     * @param {Object} summary the {name, typeName, readonly, members, params} type summary.
     * @returns {string} the markdown hover content.
     */
    renderTypeSummary(summary)
    {
        const modifier = summary.readonly ? 'readonly ' : '';
        if(summary.params.length > 0)
        {
            const params = summary.params
                .map(this.formatTypedParameter)
                .join(', ');

            return [ '```lgd', `${modifier}${summary.name}: ${summary.typeName}(${params})`, '```' ].join('\n');
        }

        const lines = summary.members.map(member => `    ${member.name}${member.kind === 'method' ? '()' : ''},`);
        return [ '```lgd', `${modifier}${summary.name}: ${summary.typeName} {`, ...lines, '}', '```' ].join('\n');
    }
};

module.exports = LgdHoverProvider;
