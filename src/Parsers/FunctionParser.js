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
            const regex = /\w+\s*=\s*[\dA-Za-z]+(?:,|)|\w+\s*=\s*{[^}]+}|\w+/g;
            return params.match(regex) || [];
        }
    },

    /** @description Preserve binding patterns while removing their nested default initializers. */
    getParameterBinding(pattern, source)
    {
        if(pattern.type === 'AssignmentPattern')
        {
            return this.getParameterBinding(pattern.left, source);
        }

        let children = [];
        if(pattern.type === 'ObjectPattern')
        {
            children = pattern.properties.map(property =>
            {
                if(property.type === 'RestElement')
                {
                    return property;
                }

                return property.value;
            });
        }
        else if(pattern.type === 'ArrayPattern')
        {
            children = pattern.elements.filter(Boolean);
        }
        else if(pattern.type === 'RestElement')
        {
            children = [pattern.argument];
        }

        let binding = '';
        let position = pattern.start;
        for(const child of children)
        {
            binding += source.slice(position, child.start);
            binding += this.getParameterBinding(child, source);
            position = child.end;
        }

        return binding + source.slice(position, pattern.end);
    },

    /** @description Separate the binding, rest marker, and whole-parameter default using syntax nodes. */
    parseParameter(parameter)
    {
        const source = `(${parameter}) => {}`;
        let binding;
        try
        {
            binding = parseExpression(source).params[0];
        }
        catch
        {
            return { name: parameter, isRest: false };
        }

        const isRest = binding.type === 'RestElement';
        if(isRest)
        {
            binding = binding.argument;
        }

        let defaultValue;
        if(binding.type === 'AssignmentPattern')
        {
            // A destructuring default does not describe every property accepted by the parameter.
            if(binding.left.type === 'Identifier')
            {
                defaultValue = source.slice(binding.right.start, binding.right.end);
            }

            binding = binding.left;
        }

        return { name: this.getParameterBinding(binding, source), isRest: isRest, defaultValue: defaultValue };
    },

    /** @description Recognizes array-shaped TypeScript annotations without changing their element types. */
    isArrayType(annotation)
    {
        switch(annotation.type)
        {
            case 'TSArrayType':
            case 'TSTupleType':
                return true;
            case 'TSTypeReference':
                return [ 'Array', 'ReadonlyArray' ].includes(annotation.typeName.name);
            case 'TSParenthesizedType':
                return this.isArrayType(annotation.typeAnnotation);
            case 'TSTypeOperator':
                return annotation.operator === 'readonly' && this.isArrayType(annotation.typeAnnotation);
            case 'TSUnionType':
                return annotation.types.every(type => this.isArrayType(type));
            case 'TSIntersectionType':
                return annotation.types.some(type => this.isArrayType(type));
            default:
                return false;
        }
    },

    /** @description Rest parameters need an array or tuple, including when JSDoc specifies an element type. */
    getRestParameterType(type)
    {
        type = type.trim().replace(/^\.{3}/, '').trim();
        let annotation;
        try
        {
            annotation = parseExpression(`value as ${type}`, { plugins: ['typescript'] }).typeAnnotation;
        }
        catch
        {
            return 'any[]';
        }

        if(this.isArrayType(annotation))
        {
            return type;
        }

        if([ 'TSUnionType', 'TSIntersectionType', 'TSFunctionType', 'TSConstructorType', 'TSConditionalType', 'TSTypeOperator' ].includes(annotation.type))
        {
            return `(${type})[]`;
        }

        return `${type}[]`;
    },

    /**
     * Parse the function paramaters.
     * @param {string} params
     * @param {Object} commentParams Parameter options read from JSDoc.
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

            const parsedParameter = this.parseParameter(variables[i]);
            let parameter = parsedParameter.name;
            const type = commentParams[parameter];

            // The type gotten from the default value.
            let parsedType = null;
            if(!type && typeof parsedParameter.defaultValue !== 'undefined')
            {
                parsedType = await this.parseValue(parsedParameter.defaultValue);
            }

            let parameterType = type || parsedType || 'any';
            if(parsedParameter.isRest)
            {
                parameter = `...${parameter}`;
                parameterType = this.getRestParameterType(parameterType);
            }

            functionCall += `${parameter}: ${parameterType}${i < variables.length - 1 ? ', ' : ''}`;
        }

        functionCall += ')';
        return functionCall;
    }
};

module.exports = FunctionParser;
