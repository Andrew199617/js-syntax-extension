const Types = require('./Types');
const inferExpressionType = require('./ExpressionType');

/** @description Value and array inference shared by file parser instances. */
const ValueParser = {
    /**
     * @description Parses any property values.
     * @param {string} valuesStr the value of the property.
     * @returns {any} the type.
     */
    async parseArray(valuesStr)
    {
        if(typeof valuesStr === 'undefined')
        {
            return null;
        }

        if(valuesStr.includes('[') && valuesStr.includes(']'))
        {
            lgd.logger.logInfo(`${valuesStr} | No array of array implemented yet.`);
            return '(any | any[])[]';
        }

        const values = valuesStr.split(',').map(val => val.trim());

        const types = {
            length: 0
        };

        for(let i = 0; i < values.length; ++i)
        {
            const type = await this.parseValue(values[i]);
            if(!type)
            {
                return 'any[]';
            }

            if(!types[type])
            {
                types[type] = 1;
                types.length++;
            }
        }

        if(types.length === 1)
        {
            delete types.length;
            const typeKeys = Object.keys(types);
            return `${typeKeys[0]}[]`;
        }
        else if(types.length > 1)
        {
            delete types.length;
            const typeKeys = Object.keys(types);
            let typeStr = '(';
            for(let i = 0; i < typeKeys.length; ++i)
            {
                typeStr += typeKeys[i];
                typeStr += i < typeKeys.length - 1 ? ' | ' : '';
            }

            typeStr += ')[]';
            return typeStr;
        }

        return 'any[]';
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

        const normalizedValue = value.trim();

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

        if((/^[A-Z][A-Z0-9_]*$/).test(normalizedValue))
        {
            const constantRegex = new RegExp(`(?:const|let|var)\\s+${normalizedValue}\\s*=\\s*(?<assignedValue>.*?)(;|$)`, 'm');
            const constantMatch = constantRegex.exec(this.content || '');
            if(constantMatch?.groups?.assignedValue && constantMatch.groups.assignedValue !== normalizedValue)
            {
                return await this.parseValue(constantMatch.groups.assignedValue);
            }
        }

        // Parse recursive object.
        if(normalizedValue.includes('{') && normalizedValue.includes(':'))
        {
            const tempParser = createParser();
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
