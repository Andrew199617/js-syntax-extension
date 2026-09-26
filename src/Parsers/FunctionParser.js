const StaticAccessorCheck = require('../Checks/StaticAccessorCheck');
const { parseExpression } = require('@babel/parser');

/**
 * @description Class that handles parsing a Function.
 * @type {FunctionParserType}
 */
const FunctionParser = {
    /**
     * @description Initialize an instance of FunctionParser.
     * @param {Function} parseValue
     * @returns {FunctionParserType}
     */
    create(parseValue)
    {
        const functionParser = Object.create(FunctionParser);

        /** @type {Function} */
        functionParser.parseValue = parseValue;

        return functionParser;
    },

    /**
     * @description Check Function for any errors.
     * @param {string} insideFunction the entire inside of a function.
     * @param {ClassParserType | FileParserType} fileParser
     */
    checkFunction(insideFunction, fileParser)
    {
        StaticAccessorCheck.execute.bind(fileParser)(insideFunction);
    },

    /**
     * @description Parse the return of a function.
     * @param {string} insideFunction the entire inside of a function.
     * @returns {string} the type that was parsed.
     */
    async parseFunctionReturn(insideFunction)
    {
    // Nested function returns are currently included in this scan.
        const returnRegex = /return(?:\s+(?<return>.*?);|)/gm;

        let returns;

        const types = new Map();
        while((returns = returnRegex.exec(insideFunction)) !== null)
        {
            if(typeof returns.groups.return === 'undefined')
            {
                types.set('null', 'null');
                continue;
            }

            const parsedType = await this.parseValue(returns.groups.return);
            if(parsedType === 'any')
            {
                return 'any';
            }

            types.set(parsedType, parsedType);
        }

        let returnType = '';
        types.forEach(type =>
        {
            returnType += returnType.length === 0 ? type : ` | ${type}`;
        });

        return returnType || 'void';
    },

    /**
     * @description Split the function parameters into an array.
     * @param {string} params the parameters of a function.
     * @returns {string[]} the split parameters.
     */
    splitFunctionParams(params)
    {
        const source = `(${params}) => {}`;
        try
        {
            const parsedFunction = parseExpression(source);
            return parsedFunction.params.map(parameter => source.slice(parameter.start, parameter.end));
        }
        catch
        {
            // Preserve the existing recovery behavior for incomplete parameter lists.
            const regex = /\w+\s*=\s*[a-zA-Z0-9]+(?:,|)|\w+\s*=\s*\{[^}]+\}|\w+/g;
            return params.match(regex) || [];
        }
    },

    /**
     * Parse the function paramaters.
     * @param {string} params
     */
    async parseFunctionParams(params, commentParams)
    {
        if(typeof params === 'undefined')
        {
            return '';
        }

        let functionCall = '(';

        let parameterList = params.trim();
        if(parameterList.startsWith('(') && parameterList.endsWith(')'))
        {
            parameterList = parameterList.slice(1, -1);
        }

        const variables = this.splitFunctionParams(parameterList);

        for(let i = 0; i < variables.length; ++i)
        {
            if(!variables[i])
            {
                continue;
            }

            let type = commentParams[variables[i]];

            // The type gotten from the default value.
            let parsedType = null;
            const assignmentIndex = variables[i].indexOf('=');
            if(assignmentIndex !== -1)
            {
                const defaultValue = variables[i].slice(assignmentIndex + 1).trim();
                variables[i] = variables[i].slice(0, assignmentIndex).trim();
                type = commentParams[variables[i]];

                if(!type)
                {
                    parsedType = await this.parseValue(defaultValue);
                }
            }

            functionCall += `${variables[i]}: ${type || parsedType || 'any'}${i < variables.length - 1 ? ', ' : ''}`;
        }

        functionCall += ')';
        return functionCall;
    }
};

module.exports = FunctionParser;
