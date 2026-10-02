const vscode = require('vscode');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { maskCode } = require('../Compilers/LgdInfer');

/** @import { CancellationToken, SemanticTokens, TextDocument } from 'vscode' */

/**
 * @description Provides standard type, parameter, and keyword semantic roles for LGD documents.
 * Type references use the theme's class color. The TextMate grammar already colors the eight type
 * keywords in declaration position; this provider covers the spots it cannot see:
 * typed parameter types like vscode.TextDocument and JSDoc type tags like
 * @type {vscode.Command}.
 * @type {LgdSemanticTokensProviderType}
 */
const LgdSemanticTokensProvider = {
    /** @description Uses standard theme roles for types, parameters, and language keywords. */
    legend: new vscode.SemanticTokensLegend([ 'class', 'parameter', 'keyword' ], []),

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
        const spans = this.collectSemanticSpans(source, state);
        for(const span of spans)
        {
            builder.push(
                new vscode.Range(document.positionAt(span.start), document.positionAt(span.end)),
                span.tokenType
            );
        }

        return builder.build();
    },

    /** @description Combines mapped binding roles with LGD type and return-keyword spans. */
    collectSemanticSpans(source, state)
    {
        const spans = this.collectTypeSpans(source, state.declarations).map(span => ({ ...span, tokenType: 'class' }));
        for(const declaration of state.declarations)
        {
            for(const group of declaration.methodTypedParams || [])
            {
                if(group.returnTypeName === 'void')
                {
                    spans.push({ start: declaration.initializerStart + group.returnTypeStart,
                        end: declaration.initializerStart + group.returnTypeEnd, tokenType: 'keyword' });
                }
            }
        }

        this.collectErasedKeywords(source, state.declarations, spans);
        spans.push(...this.collectBindingSpans(source, state));
        spans.sort((first, second) => first.start - second.start || first.end - second.end);
        return spans.filter((span, index) => index === 0 || span.start !== spans[index - 1].start || span.end !== spans[index - 1].end);
    },

    /** @description Restores keyword roles for syntax removed or rewritten by LGD lowering. */
    collectErasedKeywords(source, declarations, spans)
    {
        for(const declaration of declarations)
        {
            const prefix = source.slice(declaration.headStart, declaration.typeStart);
            for(const match of prefix.matchAll(/\b(?:export|readonly|abstract)\b/g))
            {
                const start = declaration.headStart + match.index;
                spans.push({ start: start, end: start + match[0].length, tokenType: 'keyword' });
            }

            if(declaration.kind !== 'class' && declaration.kind !== 'interface')
            {
                continue;
            }

            spans.push({ start: declaration.typeStart, end: declaration.typeStart + declaration.kind.length, tokenType: 'keyword' });
            for(const member of declaration.classMembers)
            {
                for(const modifier of member.modifierSpans || [])
                {
                    spans.push({ ...modifier, tokenType: 'keyword' });
                }

                if(member.abstract && member.kind === 'property')
                {
                    if(member.getterStart !== null)
                    {
                        spans.push({ start: member.getterStart, end: member.getterEnd, tokenType: 'keyword' });
                    }

                    if(member.setterStart !== null)
                    {
                        spans.push({ start: member.setterStart, end: member.setterEnd, tokenType: 'keyword' });
                    }
                }

                if(member.baseArgumentsStart !== null)
                {
                    const initializer = maskCode(source.slice(member.paramEnd, member.baseArgumentsStart));
                    const base = (/\bbase\b/).exec(initializer);
                    if(base)
                    {
                        const start = member.paramEnd + base.index;
                        spans.push({ start: start, end: start + 'base'.length, tokenType: 'keyword' });
                    }
                }
            }

            for(const call of declaration.baseCalls || [])
            {
                spans.push({ start: call.baseStart, end: call.baseEnd, tokenType: 'keyword' });
            }
        }
    },

    /** @description Parses the current mirror, retaining complete declarations when an unfinished trailing expression exists. */
    parseMirror(code, state)
    {
        const options = { sourceType: 'unambiguous', plugins: [ 'jsx', 'deprecatedImportAssert' ], allowReturnOutsideFunction: true, tokens: true };
        try
        {
            return parser.parse(code, options);
        }
        catch
        {
            const sourceEnd = Math.max(0, ...state.declarations.map(declaration => declaration.end));
            const completePrefix = code.slice(0, state.map.toOutput(sourceEnd));
            try
            {
                return parser.parse(completePrefix, options);
            }
            catch
            {
                return null;
            }
        }
    },

    /** @description Colors real parameter bindings and their reads/writes without matching properties or shadowed locals by text. */
    collectBindingSpans(source, state)
    {
        if(!state.jsDocument)
        {
            return [];
        }

        const code = state.jsDocument.getText();
        const tree = this.parseMirror(code, state);
        const context = { source: source, code: code, map: state.map, spans: [] };
        if(!tree)
        {
            return context.spans;
        }

        const identifiers = new Set();
        traverse(tree, {
            /** @description Excludes ordinary identifier/property uses of contextual words and records parameter roles. */
            Identifier: path =>
            {
                if(!path.parentPath.isMetaProperty() || path.key !== 'meta')
                {
                    identifiers.add(path.node.start);
                }

                const binding = path.scope.getBinding(path.node.name);
                if(binding && binding.kind === 'param' && (path.isReferencedIdentifier() || path.isBindingIdentifier()))
                {
                    this.appendMappedSpan(context, path.node.start, path.node.end, 'parameter');
                }
            }
        });
        this.collectNativeKeywords(tree.tokens, identifiers, context);
        return context.spans;
    },

    /** @description Uses parsed tokens for reserved and contextual syntax words, leaving literals and identifiers distinct. */
    collectNativeKeywords(tokens, identifiers, context)
    {
        const contextual = new Set([ 'async', 'await', 'yield', 'let', 'of', 'from', 'as', 'get', 'set', 'static', 'using', 'assert' ]);
        const literals = new Set([ 'true', 'false', 'null' ]);
        for(const token of tokens)
        {
            const reserved = token.type.keyword;
            const syntaxWord = token.type.label === 'name' && contextual.has(token.value);
            if((reserved || syntaxWord) && !identifiers.has(token.start) && !literals.has(reserved))
            {
                this.appendMappedSpan(context, token.start, token.end, 'keyword');
            }
        }
    },

    /** @description Maps only verbatim source identifiers, excluding synthesized lowering tokens. */
    appendMappedSpan(context, start, end, tokenType)
    {
        const sourceStart = context.map.toSource(start);
        const sourceEnd = context.map.toSource(end - 1) + 1;
        if(sourceEnd - sourceStart === end - start && context.source.slice(sourceStart, sourceEnd) === context.code.slice(start, end))
        {
            context.spans.push({ start: sourceStart, end: sourceEnd, tokenType: tokenType });
        }
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
            if(declaration.kind === 'class' || declaration.kind === 'interface')
            {
                spans.push({ start: declaration.nameStart, end: declaration.nameEnd });
                for(const heritage of declaration.heritage || [])
                {
                    spans.push({ start: heritage.start, end: heritage.end });
                }

                for(const member of declaration.classMembers || [])
                {
                    if(member.propertyTypeName)
                    {
                        spans.push({ start: declaration.initializerStart + member.propertyTypeStart, end: declaration.initializerStart + member.propertyTypeEnd });
                    }
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
            if(group.returnTypeName && group.returnTypeName !== 'void')
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
