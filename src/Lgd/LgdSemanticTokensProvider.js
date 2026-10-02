const vscode = require('vscode');

/** @import { CancellationToken, SemanticTokens, TextDocument } from 'vscode' */

/**
 * @description Provides semantic tokens for LGD documents, coloring type references
 * with the theme's class color. The TextMate grammar already colors the eight type
 * keywords in declaration position; this provider covers the spots it cannot see:
 * typed parameter types like vscode.TextDocument and JSDoc type tags like
 * @type {vscode.Command}.
 * @type {LgdSemanticTokensProviderType}
 */
const LgdSemanticTokensProvider = {
    /** @description The token legend: types are reported as the standard 'class' token. */
    legend: new vscode.SemanticTokensLegend(['class'], []),

    /**
     * @description Creates a semantic tokens provider bound to the LGD language service.
     * @param {LgdLanguageServiceType} languageService the LGD language service.
     * @returns {LgdSemanticTokensProviderType}
     */
    create(languageService)
    {
        const provider = Object.create(LgdSemanticTokensProvider);
        provider.languageService = languageService;
        return provider;
    },

    /**
     * @description Provides the semantic type tokens for an LGD document.
     * @param {TextDocument} document the LGD document.
     * @param {CancellationToken} [token] cancellation for this semantic-token request.
     * @returns {Promise<SemanticTokens|null>} current tokens, or null for a closed, canceled, or stale request.
     */
    async provideDocumentSemanticTokens(document, token = null)
    {
        const state = this.languageService.getState(document.uri);
        if(!state || token && token.isCancellationRequested)
        {
            return null;
        }

        const version = document.version;
        const source = document.getText();
        const key = document.uri.toString();
        let pending;
        do
        {
            pending = this.languageService.pendingUpdates.get(key);
            if(pending)
            {
                await pending;
            }

            const canceled = token && token.isCancellationRequested;
            const changed = document.version !== version || document.getText() !== source;
            const closed = this.languageService.getState(document.uri) !== state || state.document !== document;
            if(canceled || changed || closed)
            {
                return null;
            }
        }
        while(this.languageService.pendingUpdates.get(key) !== pending);

        if(!state.map || state.compiledVersion !== version)
        {
            return null;
        }

        const builder = new vscode.SemanticTokensBuilder(this.legend);
        const spans = this.collectTypeSpans(source, state.declarations);
        for(const span of spans)
        {
            builder.push(
                new vscode.Range(document.positionAt(span.start), document.positionAt(span.end)),
                'class'
            );
        }

        return builder.build();
    },

    /**
     * @description Collects every document span that names a type: typed parameter types
     * from top-level function declarations and object methods, plus JSDoc type tags.
     * @param {string} text the LGD document text.
     * @param {Array} declarations the parsed declarations.
     * @returns {Array} the sorted, deduplicated {start, end} spans.
     */
    collectTypeSpans(text, declarations)
    {
        const spans = [];
        for(const declaration of declarations)
        {
            this.collectParamTypeSpans(declaration, spans);
            if(declaration.kind === 'class')
            {
                spans.push({ start: declaration.nameStart, end: declaration.nameEnd });
                if(declaration.baseName)
                {
                    spans.push({ start: declaration.baseStart, end: declaration.baseEnd });
                }

                if(declaration.constructorMember)
                {
                    spans.push({ start: declaration.constructorMember.nameStart, end: declaration.constructorMember.nameEnd });
                }
            }
        }

        this.collectJsdocTypeSpans(text, spans);
        spans.sort((first, second) => first.start - second.start);

        const unique = [];
        for(const span of spans)
        {
            const previous = unique[unique.length - 1];
            if(!previous || previous.start !== span.start || previous.end !== span.end)
            {
                unique.push(span);
            }
        }

        return unique;
    },

    /**
     * @description Collects the typed parameter spans of one declaration, covering both
     * top-level function initializers and object literal methods.
     * @param {Object} declaration the parsed declaration.
     * @param {Array} spans the collected {start, end} spans.
     * @returns {void}
     */
    collectParamTypeSpans(declaration, spans)
    {
        const groups = [];
        if(declaration.typedParams)
        {
            groups.push(declaration.typedParams);
        }

        for(const group of declaration.methodTypedParams || [])
        {
            groups.push(group);
        }

        for(const group of groups)
        {
            if(group.returnTypeName)
            {
                const start = declaration.initializerStart + group.returnTypeStart;
                spans.push({ start: start, end: declaration.initializerStart + group.returnTypeEnd });
            }

            for(const parameter of group.params || [])
            {
                if(parameter.typeStart !== -1 && parameter.typeName)
                {
                    const start = declaration.initializerStart + parameter.typeStart;
                    spans.push({ start: start, end: start + parameter.typeName.length });
                }
            }
        }
    },

    /**
     * @description Collects the type names inside JSDoc tags such as @type {vscode.Command}.
     * @param {string} text the LGD document text.
     * @param {Array} spans the collected {start, end} spans.
     * @returns {void}
     */
    collectJsdocTypeSpans(text, spans)
    {
        const commentPattern = /\/\*\*[\S\s]*?\*\//g;
        let commentMatch = commentPattern.exec(text);
        while(commentMatch)
        {
            if(this.languageService.isInsideStringOrComment(text, commentMatch.index))
            {
                commentMatch = commentPattern.exec(text);
                continue;
            }

            const comment = commentMatch[0];
            const tagPattern = /@(?:type|param|returns|typedef)\b[^\n{]*{(?<type>(?:[$A-Z_a-z][\w$]*\.)*[A-Z][\w$]*)}/g;
            let tagMatch = tagPattern.exec(comment);
            while(tagMatch)
            {
                const typeName = tagMatch.groups.type;
                const typeIndex = comment.indexOf(typeName, tagMatch.index);
                const start = commentMatch.index + typeIndex;
                spans.push({ start: start, end: start + typeName.length });
                tagMatch = tagPattern.exec(comment);
            }

            commentMatch = commentPattern.exec(text);
        }
    }
};

module.exports = LgdSemanticTokensProvider;
