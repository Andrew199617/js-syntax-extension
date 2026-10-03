const typeMaps = require('./LgdTypeMaps');
const lgdTypedParams = require('./LgdTypedParams');
const LgdSourceMap = require('./LgdSourceMap');

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
     * @description Removes parameter type prefixes and documents typed object methods,
     * updating the output mappings so hovers still point at the same source symbols.
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @param {string} compiledInitializer the recursively compiled initializer text.
     * @param {Array} segments the source-to-output mappings, updated in place.
     * @returns {string} the JavaScript initializer with untyped parameters.
     */
    rewriteInitializer(declaration, compiledInitializer, segments = [])
    {
        const map = LgdSourceMap.create(segments);
        const edits = [];
        for(const group of lgdTypedParams.typedParamGroups(declaration))
        {
            for(const parameter of group.params)
            {
                if(!parameter.typeName)
                {
                    continue;
                }

                let end = parameter.typeEnd;
                while((/\s/).test(declaration.initializerText[end] || '') && end < declaration.initializerText.length)
                {
                    end++;
                }

                edits.push({
                    start: map.toOutput(declaration.initializerStart + parameter.typeStart),
                    end: map.toOutput(declaration.initializerStart + end),
                    text: ''
                });
            }

            if(group.returnTypeName)
            {
                edits.push({
                    start: map.toOutput(declaration.initializerStart + group.returnTypeStart),
                    end: map.toOutput(declaration.initializerStart + group.returnTypeEnd),
                    text: ''
                });
            }
        }

        for(const group of this.methodDocumentationGroups(declaration))
        {
            edits.push(this.methodJsdocEdit(declaration, group, map));
        }

        return LgdSourceMap.applyEdits(compiledInitializer, segments, edits);
    },

    /** @description Merges inherited type evidence into documentation without inventing physical type spans. */
    methodDocumentationGroups(declaration)
    {
        const groups = new Map();
        for(const group of lgdTypedParams.typedParamGroups(declaration))
        {
            if(group.methodStart !== undefined)
            {
                groups.set(group.methodStart, group);
            }
        }

        for(const contract of declaration.inheritedMethodContracts || [])
        {
            const inherited = {
                ...contract,
                returnTypeName: contract.opaqueReturn ? '*' : contract.returnTypeName,
                params: contract.params.map(parameter => ({ ...parameter, typeName: parameter.opaqueType ? '*' : parameter.typeName }))
            };
            const physical = groups.get(inherited.methodStart);
            if(!physical)
            {
                groups.set(inherited.methodStart, inherited);
                continue;
            }

            const params = physical.params.map((parameter, index) => ({
                ...parameter, typeName: parameter.typeName || inherited.params[index]?.typeName
            }));

            groups.set(inherited.methodStart, { ...inherited, ...physical, params: params,
                returnTypeName: physical.returnTypeName || inherited.returnTypeName });
        }

        return [...groups.values()];
    },

    /**
     * @description Builds a mapped JSDoc insertion or replacement for a typed object method.
     * @param {Object} declaration the enclosing declaration.
     * @param {Object} group the typed method parameter group.
     * @param {Object} map the source-to-output map of the initializer.
     * @returns {Object} the {start, end, text} output edit.
     */
    methodJsdocEdit(declaration, group, map)
    {
        const before = declaration.initializerText.slice(0, group.methodStart);
        const docblock = (/\/\*\*(?:(?!\*\/)[\S\s])*\*\/\s*$/).exec(before);
        const lineStart = before.lastIndexOf('\n') + 1;
        const linePrefix = before.slice(lineStart);
        const indent = (/^[\t ]*$/).test(linePrefix) ? linePrefix : declaration.indent;
        const start = docblock ? docblock.index : group.methodStart;
        const jsdoc = docblock ? docblock[0].trimEnd() : '/** */';
        const parameters = this.mergeMethodParams(jsdoc, group.params, indent);
        const comment = this.mergeMethodReturn(parameters, group, indent);
        const prefix = declaration.initializerText.slice(0, start);
        const currentLine = prefix.slice(prefix.lastIndexOf('\n') + 1);
        const newlinePrefix = (/^[\t ]*$/).test(currentLine) ? '' : this.newline;
        return {
            start: map.toOutput(declaration.initializerStart + start),
            end: map.toOutput(declaration.initializerStart + group.methodStart),
            text: `${newlinePrefix}${comment}${this.newline}${indent}`
        };
    },

    /** @description Adds or updates the exact declared return contract on a method. */
    mergeMethodReturn(jsdoc, group, indent)
    {
        if(!group.returnTypeName)
        {
            return jsdoc;
        }

        const declared = group.returnTypeName === 'void' ? 'undefined' : typeMaps.toTsType(group.returnTypeName);
        const type = group.async ? `Promise<${declared}>` : declared;
        const tag = /@returns?(?:[\t ]+{[^\n\r}]*})?/;
        if(tag.test(jsdoc))
        {
            return jsdoc.replace(tag, `@returns {${type}}`);
        }

        const prefix = jsdoc.slice(0, -jsdocCloseLength).trimEnd();
        return `${prefix}${this.newline}${indent} * @returns {${type}}${this.newline}${indent} */`;
    },

    /**
     * @description Adds method parameter types while preserving existing descriptions and tags.
     * @param {string} jsdoc the existing method docblock, or an empty docblock.
     * @param {Array} parameters the parsed method parameters.
     * @param {string} indent the indentation of the method.
     * @returns {string} the complete typed docblock.
     */
    mergeMethodParams(jsdoc, parameters, indent)
    {
        const seen = new Set();
        const tagPattern = /@param(?:[\t ]+{[^\n\r}]*})?(?<spacing>[\t ]+)(?<name>\[[^\n\r\]]+]|[$A-Z_a-z][\w$]*)/g;
        const typed = jsdoc.replace(tagPattern, (tag, ...captures) =>
        {
            const groups = captures[captures.length - 1];
            const name = groups.name.replace(/^\[/, '').replace(/(?:=.*)?]$/, '');
            const parameter = parameters.find(candidate => candidate.name === name && candidate.typeName);
            if(!parameter)
            {
                return tag;
            }

            seen.add(name);
            return `@param {${this.parameterJsdocType(parameter)}}${groups.spacing}${groups.name}`;
        });

        const missing = parameters.filter(parameter => parameter.typeName && !seen.has(parameter.name));
        if(missing.length === 0)
        {
            return typed;
        }

        const tags = missing.map(parameter => ` * @param {${this.parameterJsdocType(parameter)}} ${parameter.name}`);
        const prefix = typed.slice(0, -jsdocCloseLength).trimEnd();
        return `${prefix}${this.newline}${indent}${tags.join(this.newline + indent)}${this.newline}${indent} */`;
    },

    /**
     * @description Converts an LGD parameter type to its JSDoc type, including rest parameters.
     * @param {Object} parameter the parsed typed parameter.
     * @returns {string} the JSDoc type.
     */
    parameterJsdocType(parameter)
    {
        const type = typeMaps.toTsType(parameter.typeName);
        if(!parameter.rest)
        {
            return type;
        }

        return typeMaps.isNullableType(parameter.typeName) ? `...(${type})` : `...${type}`;
    },

    /**
     * @description Merges a preceding JSDoc block with the synthetic @type tag for the declared type.
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @returns {string} the merged JSDoc block.
     */
    mergeJsdoc(declaration)
    {
        // A broad Object annotation hides a module's exported namespace from TypeScript.
        // Explicit JSDoc remains authoritative, and ordinary Object values retain their type.
        const requireInitializer = /^\s*require\(\s*(?<quote>["'])(?:(?!\k<quote>)[^\\]|\\.)*\k<quote>\s*\)\s*$/;
        const isModuleImport = declaration.typeName === 'Object' && requireInitializer.test(declaration.initializerText);
        if(isModuleImport)
        {
            return declaration.jsdoc || '';
        }

        const tsType = typeMaps.toTsType(declaration.typeName);
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
            .map(parameter => ` * @param {${this.parameterJsdocType(parameter)}} ${parameter.name}`);
    }
};

module.exports = JsBackend;
