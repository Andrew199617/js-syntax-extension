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
     * @returns {Object} the emitted head text ending with '=', and the variable name span within it.
     */
    emitHead(declaration)
    {
        const kind = declaration.readonly ? 'const' : 'let';
        const exportKeyword = declaration.exported ? 'export ' : '';
        const tsType = typeMaps.tsTypeMap[declaration.typeName] || declaration.typeName;
        const commentPrefix = declaration.jsdoc ? `${declaration.jsdoc}${this.newline}` : '';
        const namePrefix = `${commentPrefix}${declaration.indent}${exportKeyword}${kind} `;
        const text = `${namePrefix}${declaration.name}: ${tsType} =`;
        return { text: text, nameStart: namePrefix.length, nameEnd: namePrefix.length + declaration.name.length };
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
     * @description Annotates the parameter list with TypeScript types: (Number value) becomes (value: number).
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @param {string} compiledInitializer the recursively compiled initializer text.
     * @returns {string} the initializer with typed parameters.
     */
    rewriteInitializer(declaration, compiledInitializer)
    {
        const typedParams = declaration.typedParams;
        if(!typedParams || !typedParams.hasTypes)
        {
            return compiledInitializer;
        }

        const params = typedParams.params.map(parameter =>
        {
            if(!parameter.name)
            {
                return parameter.raw;
            }

            const tsType = parameter.typeName ? typeMaps.tsTypeMap[parameter.typeName] || parameter.typeName : null;
            const defaultText = parameter.defaultText === null ? '' : ` = ${parameter.defaultText}`;
            if(parameter.rest)
            {
                return `...${parameter.name}${tsType ? `: ${tsType}[]` : ''}${defaultText}`;
            }

            return `${parameter.name}${tsType ? `: ${tsType}` : ''}${defaultText}`;
        });

        return `${compiledInitializer.slice(0, typedParams.start)
        }(${params.join(', ')})${
            compiledInitializer.slice(typedParams.end)}`;
    }
};

module.exports = TsBackend;
