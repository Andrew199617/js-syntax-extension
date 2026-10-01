const typeMaps = require('./LgdTypeMaps');

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
     * @description Compiled initializers need no rewriting for JavaScript.
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @param {string} compiledInitializer the recursively compiled initializer text.
     * @returns {string} the initializer unchanged.
     */
    rewriteInitializer(declaration, compiledInitializer)
    {
        return compiledInitializer;
    },

    /**
     * @description Merges a preceding JSDoc block with the synthetic @type tag for the declared type.
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @returns {string} the merged JSDoc block.
     */
    mergeJsdoc(declaration)
    {
        const tsType = typeMaps.tsTypeMap[declaration.typeKeyword];
        if(!declaration.jsdoc)
        {
            return `${declaration.indent}/** @type {${tsType}} */`;
        }

        if((/@type\b/).test(declaration.jsdoc))
        {
            return declaration.jsdoc;
        }

        const inner = declaration.jsdoc.slice(0, -jsdocCloseLength).trimEnd();
        const newline = this.newline;
        return `${inner}${newline}${declaration.indent} * @type {${tsType}}${newline}${declaration.indent} */`;
    }
};

module.exports = JsBackend;
