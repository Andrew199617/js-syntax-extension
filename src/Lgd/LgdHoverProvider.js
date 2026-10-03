const vscode = require('vscode');
const LgdClassMemberLookup = require('./LgdClassMemberLookup');

/** @import { Hover, Position, TextDocument } from 'vscode' */

/**
 * @description Provides hovers for LGD documents by delegating to the TypeScript language
 * service on the compiled JavaScript mirror, translating positions both ways.
 * @type {LgdHoverProviderType}
 */
const LgdHoverProvider = {
    /** @description Length of the `this.` receiver prefix checked before a hovered word. */
    THIS_DOT_LENGTH: 5,

    /** @description Length of the `base.` receiver prefix checked before a hovered word. */
    BASE_DOT_LENGTH: 5,

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
            const declaredField = LgdClassMemberLookup.get(state, position);
            if(declaredField?.kind === 'field')
            {
                return new vscode.Hover(this.renderDeclaredField(declaredField), wordRange);
            }

            const memberHover = this.provideThisMemberHover(document, position, wordRange);
            if(memberHover)
            {
                return memberHover;
            }

            const baseHover = this.provideBaseMemberHover(document, position, wordRange);
            if(baseHover)
            {
                return baseHover;
            }

            const summary = await this.languageService.getTypeSummary(document.uri, document.getText(wordRange));
            if(summary && (summary.kind === 'class' || summary.kind === 'interface' || summary.members.length > 0 || summary.params.length > 0))
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
     * @description Provides hover for a `this.member` access by resolving the member through
     * the properties the enclosing object's create() method assigns to the instance.
     * @param {TextDocument} document the LGD document.
     * @param {Position} position the hovered position.
     * @param {Range} wordRange the range of the hovered member name.
     * @returns {Hover|null} the hover, or null when the word is not a this. member access.
     */
    provideThisMemberHover(document, position, wordRange)
    {
        if(wordRange.start.character < this.THIS_DOT_LENGTH)
        {
            return null;
        }

        const receiverRange = new vscode.Range(
            new vscode.Position(wordRange.start.line, wordRange.start.character - this.THIS_DOT_LENGTH),
            wordRange.start
        );
        if(document.getText(receiverRange) !== 'this.')
        {
            return null;
        }

        const detail = this.languageService.getThisMemberDetail(document, position, document.getText(wordRange));
        if(!detail)
        {
            return null;
        }

        return new vscode.Hover(this.renderPropertySummary(detail), wordRange);
    },

    /**
     * @description Provides hover for a `base.` access by resolving the member through
     * the enclosing class's base declaration or its imported base type.
     * @param {TextDocument} document the LGD document.
     * @param {Position} position the hovered position.
     * @param {Range} wordRange the range of the hovered member name.
     * @returns {Hover|null} the hover, or null when the word is not a base. member access.
     */
    provideBaseMemberHover(document, position, wordRange)
    {
        if(wordRange.start.character < this.BASE_DOT_LENGTH)
        {
            return null;
        }

        const receiverRange = new vscode.Range(
            new vscode.Position(wordRange.start.line, wordRange.start.character - this.BASE_DOT_LENGTH),
            wordRange.start
        );
        if(document.getText(receiverRange) !== 'base.')
        {
            return null;
        }

        const detail = this.languageService.getBaseMemberDetail(document, position, document.getText(wordRange));
        if(!detail)
        {
            return null;
        }

        if(detail.kind === 'method')
        {
            return new vscode.Hover(this.renderMethodSummary(detail), wordRange);
        }

        return new vscode.Hover(this.renderPropertySummary(detail), wordRange);
    },

    /** @description Shows the declared field type and owner even when the JavaScript mirror cannot infer a default-only field. */
    renderDeclaredField(detail)
    {
        const modifier = `${detail.static ? 'static ' : ''}${detail.readonly ? 'readonly ' : ''}`;
        const owner = detail.declaringType ? `${detail.declaringType}.` : '';
        const type = detail.propertyTypeName || detail.typeName;
        return [ '```lgd', `${modifier}${type} ${owner}${detail.name}`, '```' ].join('\n');
    },

    /**
     * @description Renders an LGD-style summary for one base-class method.
     * @param {Object} detail the {name} member detail.
     * @returns {string} the markdown hover content.
     */
    renderMethodSummary(detail)
    {
        return [ '```lgd', `(method) ${detail.name}()`, '```' ].join('\n');
    },

    /**
     * @description Renders an LGD-style summary for one create()-assigned instance property.
     * @param {Object} detail the {name, typeName, properties} member detail.
     * @returns {string} the markdown hover content.
     */
    renderPropertySummary(detail)
    {
        const type = detail.typeName ? `: ${detail.typeName}` : '';
        if(!detail.properties || detail.properties.length === 0)
        {
            return [ '```lgd', `(property) ${detail.name}${type}`, '```' ].join('\n');
        }

        const lines = detail.properties.map(property => `    ${property},`);
        return [ '```lgd', `(property) ${detail.name}${type} {`, ...lines, '}', '```' ].join('\n');
    },

    /**
     * @description Renders an LGD-style type summary for a declared nominal type or function signature.
     * @param {Object} summary the {name, typeName, readonly, members, params} type summary.
     * @returns {string} the markdown hover content.
     */
    renderTypeSummary(summary)
    {
        if(summary.kind === 'enum')
        {
            const lines = summary.members.map(member => `    ${member.name} = ${member.valueText},`);
            return [ '```lgd', `enum ${summary.name} {`, ...lines, '}', '```' ].join('\n');
        }

        if(summary.kind === 'class' || summary.kind === 'interface')
        {
            const heritage = [ summary.baseName, ...summary.interfaceNames || [] ].filter(Boolean);
            const base = heritage.length > 0 ? ` : ${heritage.join(', ')}` : '';
            const modifier = summary.abstract && summary.kind === 'class' ? 'abstract ' : '';
            const constructorParams = (summary.constructorParams || []).map(this.formatTypedParameter).join(', ');
            const visibleMembers = summary.members.filter(member => !summary.abstract || member.name !== 'create');
            const lines = visibleMembers.map(member =>
            {
                if(member.name === 'create')
                {
                    return `    create(${constructorParams}),`;
                }

                const type = member.typeName ? `: ${member.typeName}` : '';
                return `    ${member.name}${member.kind === 'method' ? '()' : type},`;
            });

            return [ '```lgd', `${modifier}${summary.kind} ${summary.name}${base} {`, ...lines, '}', '```' ].join('\n');
        }

        const modifier = summary.readonly ? 'const ' : '';
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
