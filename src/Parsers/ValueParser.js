const Types = require('./Types');
const inferExpressionType = require('./ExpressionType');
const { parse, parseExpression } = require('@babel/parser');

/** @description Value and array inference shared by file parser instances. */
const ValueParser = {
    /** @description Read file-level initializers from syntax, excluding comments, literals, and unrelated local scopes. */
    parseConstants(content)
    {
        const values = new Map();
        let parsedFile;
        try
        {
            parsedFile = parse(content, { sourceType: 'unambiguous', plugins: ['jsx'] });
        }
        catch
        {
            return values;
        }

        for(const statement of parsedFile.program.body)
        {
            const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
            if(declaration?.type !== 'VariableDeclaration')
            {
                continue;
            }

            for(const variable of declaration.declarations)
            {
                if(variable.id.type === 'Identifier' && variable.init)
                {
                    values.set(variable.id.name, content.slice(variable.init.start, variable.init.end));
                }
            }
        }

        return values;
    },

    /** @description Resolves constant aliases without recursing or following a cycle. */
    resolveConstant(value, content)
    {
        if(!(/^[A-Z][A-Z0-9_]*$/).test(value))
        {
            return value;
        }

        if(this.constantSourceCache !== content)
        {
            this.constantSourceCache = content;
            this.constantValuesCache = ValueParser.parseConstants(content);
        }

        const visited = new Set();
        while((/^[A-Z][A-Z0-9_]*$/).test(value))
        {
            if(visited.has(value))
            {
                return null;
            }

            visited.add(value);
            const assignedValue = this.constantValuesCache.get(value);
            if(!assignedValue)
            {
                break;
            }

            value = assignedValue.trim();
        }

        return value;
    },

    /**
     * @description Infers an array type from complete element expressions without executing them.
     * @param {string} valuesStr the source between the array brackets.
     * @returns {Promise<string | null>} the inferred array type.
     */
    async parseArray(valuesStr)
    {
        if(typeof valuesStr === 'undefined')
        {
            return null;
        }

        const source = `[${valuesStr}]`;
        let array;
        try
        {
            array = parseExpression(source);
        }
        catch
        {
            return Types.ANYARRAY;
        }

        if(array.type !== 'ArrayExpression')
        {
            return Types.ANYARRAY;
        }

        const types = new Set();
        for(const element of array.elements)
        {
            if(!element)
            {
                types.add(Types.ANY);
                continue;
            }

            if(element.type === 'SpreadElement')
            {
                return Types.ANYARRAY;
            }

            if(element.type === 'ArrayExpression')
            {
                this.logger.logInfo(`${valuesStr} | No array of array implemented yet.`);
                return '(any | any[])[]';
            }

            const value = source.slice(element.start, element.end);
            const type = await this.parseValue(value);
            if(!type)
            {
                return Types.ANYARRAY;
            }

            types.add(type);
        }

        const elementTypes = Array.from(types);
        if(elementTypes.length === 0)
        {
            return Types.ANYARRAY;
        }

        if(elementTypes.length === 1)
        {
            return `${elementTypes[0]}[]`;
        }

        return `(${elementTypes.join(' | ')})[]`;
    },

    /**
     * @description Parses any property values.
     * @param {string} value the value of the property.
     * @returns {string | null} the type.
     */
    async parseValue(value, createParser)
    {
        if(typeof value === 'undefined')
        {
            return null;
        }

        const normalizedValue = ValueParser.resolveConstant.call(this, value.trim(), this.content || '');
        if(normalizedValue === null)
        {
            return Types.ANY;
        }

        if((/^process\.env\.[A-Z0-9_]+$/i).test(normalizedValue))
        {
            return Types.STRING;
        }

        const expressionType = inferExpressionType(normalizedValue);
        if(expressionType !== Types.ANY)
        {
            return expressionType;
        }

        if(normalizedValue.includes('.bind(this)'))
        {
            return Types.FUNCTION;
        }

        if((/function\s*?\(|=>/m).test(normalizedValue))
        {
            return Types.FUNCTION;
        }

        let className = (/new\s+(?<className>\w+)\(/m).exec(normalizedValue);
        if(className !== null && className.groups.className)
        {
            return className.groups.className;
        }

        className = (/(?<className>\w+)\.create\s*\(/m).exec(normalizedValue);
        if(className !== null && className.groups.className)
        {
            return `${className.groups.className}Type`;
        }

        // Parse recursive object.
        if(normalizedValue.includes('{') && normalizedValue.includes(':'))
        {
            const tempParser = createParser(this.compilationContext);
            tempParser.staticVariables = [];
            tempParser.tabSize = this.tabSize;

            const tabSize = this.tabSize > this.defaultTabSize ? this.tabSize - this.defaultTabSize : this.tabSize;
            const tabs = new Array(tabSize / this.defaultTabSize)
                .fill('\t')
                .join('');

            return `{${await tempParser.parseObject(normalizedValue)}${tabs}}`;
        }

        if(normalizedValue.includes('[') && normalizedValue.includes(']'))
        {
            return Types.ANYARRAY;
        }

        if(normalizedValue.includes('{') && normalizedValue.includes('}'))
        {
            return Types.OBJECT;
        }

        return expressionType;
    }
};

module.exports = ValueParser;
