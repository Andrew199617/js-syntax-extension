const parser = require('@babel/parser');

/** @description Limits declarative JSONC input without evaluating expressions or loading external files. */
const limits = { bytes: 262144, depth: 32 };

/** @description Reads JSON with comments and trailing commas through a literal-only syntax tree. */
const LgdStyleJson = {
    /** @description Accepts only JSON values; comments and trailing commas do not authorize JavaScript execution. */
    parse(text)
    {
        if(text.length > limits.bytes)
        {
            throw new Error('The JSON style file exceeds the 256 KiB limit.');
        }

        const expression = parser.parseExpression(text);
        return this.value(expression, 0);
    },

    /** @description Converts whitelisted literal nodes and rejects calls, getters, imports, spreads and prototype keys. */
    value(node, depth)
    {
        if(depth > limits.depth)
        {
            throw new Error('The JSON style file exceeds the supported nesting limit.');
        }

        if([ 'StringLiteral', 'NumericLiteral', 'BooleanLiteral' ].includes(node.type))
        {
            return node.value;
        }

        if(node.type === 'NullLiteral')
        {
            return null;
        }

        if(node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'NumericLiteral')
        {
            return -node.argument.value;
        }

        if(node.type === 'ArrayExpression')
        {
            if(node.elements.some(entry => !entry))
            {
                throw new Error('Sparse arrays are not valid JSON style data.');
            }

            return node.elements.map(entry => this.value(entry, depth + 1));
        }

        if(node.type !== 'ObjectExpression')
        {
            throw new Error('Only literal JSON values are allowed in style configuration.');
        }

        const result = {};
        for(const property of node.properties)
        {
            if(property.type !== 'ObjectProperty' || property.computed || property.shorthand || property.key.type !== 'StringLiteral')
            {
                throw new Error('JSON style mappings require quoted keys and literal values.');
            }

            const key = property.key.value;
            if([ '__proto__', 'prototype', 'constructor' ].includes(key) || Object.hasOwn(result, key))
            {
                throw new Error(`Duplicate or unsafe JSON style key: ${key}.`);
            }

            result[key] = this.value(property.value, depth + 1);
        }

        return result;
    }
};

module.exports = LgdStyleJson;
