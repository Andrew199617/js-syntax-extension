const typeMaps = require('./LgdTypeMaps');

/**
 * @description Emits C# for LGD typed declarations. v1 mock: declarations are translated, other statements pass through with light rewrites.
 * @type {CSharpBackendType}
 */
const CSharpBackend = {
    /**
     * @description Creates a C# backend instance.
     * @param {string} newline the line ending to emit, defaults to line feed.
     * @returns {CSharpBackendType}
     */
    create(newline = '\n')
    {
        const backend = Object.create(CSharpBackend);
        backend.newline = newline;
        return backend;
    },

    /**
     * @description Emits the C# head for one typed declaration, converting JSDoc to a summary comment.
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @returns {string} the emitted head, ending with '='.
     */
    emitHead(declaration)
    {
        const summary = this.toSummary(declaration.jsdoc);
        const summaryPrefix = summary ? `${summary}${this.newline}` : '';
        const indent = declaration.indent;
        if(declaration.typeKeyword === 'Function')
        {
            const funcType = this.inferFuncType(declaration.initializerText);
            return `${summaryPrefix}${indent}${funcType} ${declaration.name} =`;
        }

        const csType = typeMaps.csharpTypeMap[declaration.typeKeyword];
        const constantKeyword = declaration.readonly && this.isLiteralInitializer(declaration.initializerText) ? 'const ' : '';
        return `${summaryPrefix}${indent}${constantKeyword}${csType} ${declaration.name} =`;
    },

    /**
     * @description Rewrites a compiled initializer for C# quirks: array literals become List initializers, BigInt literals become long literals.
     * @param {LgdDeclarationType} declaration the parsed typed declaration.
     * @param {string} compiledInitializer the recursively compiled initializer text.
     * @returns {string} the rewritten initializer.
     */
    rewriteInitializer(declaration, compiledInitializer)
    {
        if(declaration.typeKeyword === 'Array')
        {
            return this.rewriteArrayLiteral(compiledInitializer);
        }

        if(declaration.typeKeyword === 'BigInt')
        {
            return this.rewriteBigIntLiteral(compiledInitializer);
        }

        return compiledInitializer;
    },

    /**
     * @description Rewrites non-declaration source text with light C# translations: .push to .Add, === to ==, = [] to new List.
     * @param {string} text the source text.
     * @returns {string} the rewritten text.
     */
    rewriteGap(text)
    {
        return this.rewriteCodeSegments(text, code => code
            .replace(/^[\t ]*export[\t ]+/gm, '')
            .replace(/\.push\(/g, '.Add(')
            .replace(/===/g, '==')
            .replace(/!==/g, '!=')
            .replace(/(?<before>[^!<=>])=\s*\[]/g, '$<before>= new List<dynamic>()'));
    },

    /**
     * @description Converts a JSDoc block to a C# summary comment, dropping tags.
     * @param {string} jsdoc the JSDoc block, or null.
     * @returns {string} the summary comment, or an empty string.
     */
    toSummary(jsdoc)
    {
        if(!jsdoc)
        {
            return '';
        }

        const lines = jsdoc
            .split('\n')
            .map(line => line
                .replace(/^\s*\/\*\*?/, '')
                .replace(/\*\/\s*$/, '')
                .replace(/^\s*\*\s?/, '')
                .trim())
            .filter(line => line.length > 0 && !line.startsWith('@'));

        if(lines.length === 0)
        {
            return '';
        }

        const escaped = lines
            .join(' ')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        return `/// <summary>${escaped}</summary>`;
    },

    /**
     * @description Infers a Func or Action type for an arrow function initializer based on parameter count and whether the block body returns.
     * @param {string} initializerText the raw initializer text.
     * @returns {string} the inferred delegate type.
     */
    inferFuncType(initializerText)
    {
        const parameterMatch = (/\(\s*(?<parameters>[^)]*)\)\s*=>/).exec(initializerText);
        const bareParameterMatch = (/^[$A-Z_a-z][\w$]*\s*=>/).exec(initializerText.trimStart());
        let parameterCount = 0;
        if(parameterMatch)
        {
            const parameters = parameterMatch.groups.parameters.trim();
            parameterCount = parameters ? parameters.split(',').length : 0;
        }
        else if(bareParameterMatch)
        {
            parameterCount = 1;
        }

        const arrowIndex = initializerText.indexOf('=>');
        const body = arrowIndex === -1 ? '' : initializerText.slice(arrowIndex + 2).trimStart();
        const isBlockBody = body.startsWith('{');
        const returnsValue = (/\breturn\b/).test(body);
        if(isBlockBody && !returnsValue)
        {
            return parameterCount === 0 ? 'Action' : `Action<${this.dynamicList(parameterCount)}>`;
        }

        return `Func<${this.dynamicList(parameterCount + 1)}>`;
    },

    /**
     * @description Builds a comma-separated list of dynamic types.
     * @param {number} count how many dynamic entries to include.
     * @returns {string} the type list.
     */
    dynamicList(count)
    {
        return Array(count).fill('dynamic').join(', ');
    },

    /**
     * @description Checks whether an initializer is a constant literal, which allows readonly to become const.
     * @param {string} initializerText the raw initializer text.
     * @returns {boolean} true for string, number, boolean, and null literals.
     */
    isLiteralInitializer(initializerText)
    {
        return (/^(?<literal>"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|-?\d+(?:\.\d+)?|true|false|null)$/).test(initializerText.trim());
    },

    /**
     * @description Rewrites a BigInt literal initializer to a C# long literal.
     * @param {string} initializerText the raw initializer text.
     * @returns {string} the rewritten initializer.
     */
    rewriteBigIntLiteral(initializerText)
    {
        const match = (/^(?<digits>\d+)n$/).exec(initializerText.trim());
        if(match)
        {
            return ` ${match.groups.digits}L`;
        }

        return initializerText;
    },

    /**
     * @description Rewrites array literals in an initializer to List initializers, leaving index access alone.
     * @param {string} initializerText the raw initializer text.
     * @returns {string} the rewritten initializer.
     */
    rewriteArrayLiteral(initializerText)
    {
        let result = '';
        const literalStack = [];
        let stringChar = null;
        let index = 0;
        while(index < initializerText.length)
        {
            const character = initializerText[index];
            if(stringChar)
            {
                result += character;
                if(character === '\\')
                {
                    result += initializerText[index + 1] || '';
                    index++;
                }
                else if(character === stringChar)
                {
                    stringChar = null;
                }

                index++;
                continue;
            }

            if(character === '"' || character === "'" || character === '`')
            {
                stringChar = character;
                result += character;
                index++;
                continue;
            }

            if(character === '[')
            {
                const previous = result.trimEnd().slice(-1);
                const isLiteral = previous === '' || '=([,{'.includes(previous) || (/(?:^|[^\w$])(?:return|=>)\s*$/).test(result);
                literalStack.push(isLiteral);
                result += isLiteral ? 'new List<dynamic> {' : '[';
                index++;
                continue;
            }

            if(character === ']')
            {
                const wasLiteral = literalStack.pop();
                result += wasLiteral ? ' }' : ']';
                index++;
                continue;
            }

            result += character;
            index++;
        }

        return result;
    },

    /**
     * @description Applies a rewrite to code segments only, leaving strings and comments untouched.
     * @param {string} text the source text.
     * @param {Function} rewrite the rewrite to apply to each code segment.
     * @returns {string} the text with code segments rewritten.
     */
    rewriteCodeSegments(text, rewrite)
    {
        let result = '';
        let segment = '';
        let mode = 'code';

        function flushSegment()
        {
            result += mode === 'code' ? rewrite(segment) : segment;
            segment = '';
        }

        let index = 0;
        while(index < text.length)
        {
            const character = text[index];
            const next = text[index + 1] || '';
            if(mode === 'code')
            {
                if(character === '"' || character === "'" || character === '`')
                {
                    flushSegment();
                    mode = character;
                    segment += character;
                }
                else if(character === '/' && next === '/')
                {
                    flushSegment();
                    mode = 'line';
                    segment += '//';
                    index++;
                }
                else if(character === '/' && next === '*')
                {
                    flushSegment();
                    mode = 'block';
                    segment += '/*';
                    index++;
                }
                else
                {
                    segment += character;
                }
            }
            else if(mode === '"' || mode === "'" || mode === '`')
            {
                segment += character;
                if(character === '\\')
                {
                    segment += next;
                    index++;
                }
                else if(character === mode)
                {
                    flushSegment();
                    mode = 'code';
                }
            }
            else if(mode === 'line')
            {
                segment += character;
                if(character === '\n')
                {
                    flushSegment();
                    mode = 'code';
                }
            }
            else if(mode === 'block')
            {
                segment += character;
                if(character === '*' && next === '/')
                {
                    segment += next;
                    index++;
                    flushSegment();
                    mode = 'code';
                }
            }

            index++;
        }

        flushSegment();
        return result;
    }
};

module.exports = CSharpBackend;
