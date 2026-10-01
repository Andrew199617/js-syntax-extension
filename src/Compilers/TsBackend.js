const typeMaps = require('./LgdTypeMaps');

/**
 * @description Emits TypeScript for LGD typed declarations.
 * @type {TsBackendType}
 */
const TsBackend = {
    /**
     * @description Creates a TypeScript backend instance.
     * @param {string} newline the line ending to emit, defaults to line feed.
     * @returns {TsBackendType}
     */
    create(newline = '\n')
    {
        const backend = Object.create(TsBackend);
        backend.newline = newline;
        return backend;
    },

    /**
     * @description Emits the TypeScript head for one typed declaration, keeping the original JSDoc and adding a type annotation.
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @returns {string} the emitted head, ending with '='.
     */
    emitHead(declaration)
    {
        const kind = declaration.readonly ? 'const' : 'let';
        const exportKeyword = declaration.exported ? 'export ' : '';
        const tsType = typeMaps.tsTypeMap[declaration.typeKeyword];
        const commentPrefix = declaration.jsdoc ? `${declaration.jsdoc}${this.newline}` : '';
        return `${commentPrefix}${declaration.indent}${exportKeyword}${kind} ${declaration.name}: ${tsType} =`;
    },

    /**
     * @description Non-declaration source text passes through to TypeScript unchanged.
     * @param {string} text the source text.
     * @returns {string} the text unchanged.
     */
    rewriteGap(text)
    {
        return text;
    },

    /**
     * @description Compiled initializers need no rewriting for TypeScript.
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @param {string} compiledInitializer the recursively compiled initializer text.
     * @returns {string} the initializer unchanged.
     */
    rewriteInitializer(declaration, compiledInitializer)
    {
        return compiledInitializer;
    }
};

module.exports = TsBackend;
