const typeMaps = require('./LgdTypeMaps');
const lgdTypedParams = require('./LgdTypedParams');

/** @description Length of the JSDoc closing marker, stripped before merging the synthetic type tag. */
const jsdocCloseLength = 2;

/**
 * @description Emits JavaScript for LGD typed declarations.
 * @type {JsBackendType}
 */
const JsBackend = {
    /**
     * @description Creates a JavaScript backend instance.
     * @param {string} newline the line ending to emit, defaults to line feed.
     * @returns {JsBackendType}
     */
    create(newline = '\n')
    {
        const backend = Object.create(JsBackend);
        backend.newline = newline;
        return backend;
    },

    /**
     * @description Emits the JavaScript head for one typed declaration, merging any JSDoc with a synthetic @type tag.
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @returns {Object} the emitted head text ending with '=', and the variable name span within it.
     */
    emitHead(declaration)
    {
        const kind = declaration.readonly ? 'const' : 'let';
        const exportKeyword = declaration.exported ? 'export ' : '';
        const comment = this.mergeJsdoc(declaration);
        const commentPrefix = comment ? `${comment}${this.newline}` : '';
        const text = `${commentPrefix}${declaration.indent}${exportKeyword}${kind} ${declaration.name} =`;
        const nameStart = text.length - declaration.name.length - 2;
        return { text: text, nameStart: nameStart, nameEnd: nameStart + declaration.name.length };
    },

    /**
     * @description Non-declaration source text passes through to JavaScript unchanged.
     * @param {string} text the source text.
     * @returns {string} the text unchanged.
     */
    rewriteGap(text)
    {
        return text;
    },

    /**
     * @description Strips LGD types from the parameter list: (Number value) becomes (value).
     * @param {Object} typedParams the {start, end, params, hasTypes} parameter group.
     * @param {string} compiledInitializer the recursively compiled initializer text.
     * @returns {string} the initializer with untyped parameters.
     */
    stripParamTypes(typedParams, compiledInitializer)
    {
        const params = typedParams.params.map(parameter =>
        {
            if(!parameter.name)
            {
                return parameter.raw;
            }

            const rest = parameter.rest ? '...' : '';
            const defaultText = parameter.defaultText === null ? '' : ` = ${parameter.defaultText}`;
            return `${rest}${parameter.name}${defaultText}`;
        });

        return `${compiledInitializer.slice(0, typedParams.start)
        }(${params.join(', ')})${
            compiledInitializer.slice(typedParams.end)}`;
    },

    /**
     * @description Rewrites a compiled initializer for JavaScript, stripping LGD parameter types.
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @param {string} compiledInitializer the recursively compiled initializer text.
     * @param {Array} segments the emit segments mapping source offsets to output offsets.
     * @returns {string} the initializer with plain JavaScript parameters.
     */
    rewriteInitializer(declaration, compiledInitializer, segments = [])
    {
        let code = compiledInitializer;
        for(const group of lgdTypedParams.typedParamGroupsForOutput(declaration, segments))
        {
            code = this.stripParamTypes(group, code);
        }

        return code;
    },

    /**
     * @description Merges a preceding JSDoc block with the synthetic @type tag for the declared type.
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @returns {string} the merged JSDoc block.
     */
    mergeJsdoc(declaration)
    {
        const tsType = typeMaps.tsTypeMap[declaration.typeName] || declaration.typeName;
        const params = this.paramTags(declaration);
        if(!declaration.jsdoc)
        {
            if(params.length === 0)
            {
                return `${declaration.indent}/** @type {${tsType}} */`;
            }

            const newline = this.newline;
            return `${declaration.indent}/**${newline}${declaration.indent}${params.join(newline + declaration.indent)}${newline}${declaration.indent} * @type {${tsType}}${newline}${declaration.indent} */`;
        }

        if((/@type\b/).test(declaration.jsdoc))
        {
            return declaration.jsdoc;
        }

        const inner = declaration.jsdoc.slice(0, -jsdocCloseLength).trimEnd();
        const newline = this.newline;
        const hasParamTags = params.length > 0 && !(/@param\b/).test(declaration.jsdoc);
        const paramLines = hasParamTags
            ? `${newline}${declaration.indent}${params.join(newline + declaration.indent)}`
            : '';

        return `${inner}${paramLines}${newline}${declaration.indent} * @type {${tsType}}${newline}${declaration.indent} */`;
    },

    /**
     * @description Builds @param JSDoc lines for the typed parameters of a function declaration.
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @returns {Array} the @param lines, or an empty array when there are none.
     */
    paramTags(declaration)
    {
        const typedParams = declaration.typedParams;
        if(!typedParams || !typedParams.hasTypes)
        {
            return [];
        }

        return typedParams.params
            .filter(parameter => parameter.name && parameter.typeName)
            .map(parameter => ` * @param {${typeMaps.tsTypeMap[parameter.typeName] || parameter.typeName}} ${parameter.name}`);
    }
};

module.exports = JsBackend;
