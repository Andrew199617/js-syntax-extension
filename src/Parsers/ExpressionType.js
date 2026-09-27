const { parseExpression } = require('@babel/parser');
const Types = require('./Types');

// Bound work performed while parsing expressions during editing.
const MAX_EXPRESSION_LENGTH = 10000;

// Stop recursive inference before deeply nested input exhausts the stack.
const MAX_EXPRESSION_DEPTH = 64;

// Keep constant BigInt calculations small, including shifts and exponentiation.
const MAX_BIGINT_BITS = 1024;

// Only these standard numeric constants can be read through member expressions.
const MATH_CONSTANTS = new Map([
    [ 'E', Math.E ],
    [ 'LN2', Math.LN2 ],
    [ 'LN10', Math.LN10 ],
    [ 'LOG2E', Math.LOG2E ],
    [ 'LOG10E', Math.LOG10E ],
    [ 'PI', Math.PI ],
    [ 'SQRT1_2', Math.SQRT1_2 ],
    [ 'SQRT2', Math.SQRT2 ]
]);

// Comparisons have a boolean result even when their operands are unknown.
const COMPARISON_OPERATORS = [ '==', '===', '!=', '!==', '<', '>', '<=', '>=', 'in', 'instanceof' ];

/** @description Combines constant calculation with type inference for unresolved expressions. */
const ExpressionType = {
    /** @description Infers a syntax node's type and any known primitive value within the recursion limit. */
    inferNode(node, depth = 0)
    {
        if(depth >= MAX_EXPRESSION_DEPTH)
        {
            return this.unknownValue();
        }

        switch(node.type)
        {
            case 'StringLiteral':
            case 'NumericLiteral':
            case 'BooleanLiteral':
                return this.constantValue(node.value);
            case 'NullLiteral':
                return this.constantValue(null);
            case 'BigIntLiteral':
                if(node.value.length > MAX_BIGINT_BITS)
                {
                    return this.unknownValue('bigint');
                }

                return this.constantValue(globalThis.BigInt(node.value));
            case 'Identifier':
                return this.inferIdentifier(node.name);
            case 'MemberExpression':
                return this.inferMember(node);
            case 'TemplateLiteral':
                return this.inferTemplate(node, depth + 1);
            case 'UnaryExpression':
                return this.inferUnary(node, depth + 1);
            case 'BinaryExpression':
                return this.inferBinary(node, depth + 1);
            case 'ConditionalExpression':
                return this.inferConditional(node, depth + 1);
            case 'LogicalExpression':
                return this.inferLogical(node, depth + 1);
            default:
                return this.unknownValue();
        }
    },

    /** @description Recognizes undefined, NaN, and Infinity without resolving user-defined names. */
    inferIdentifier(name)
    {
        switch(name)
        {
            case 'undefined':
                return this.constantValue();
            case 'NaN':
                return this.constantValue(Number.NaN);
            case 'Infinity':
                return this.constantValue(Infinity);
            default:
                return this.unknownValue();
        }
    },

    /** @description Resolves supported Math constants without reading arbitrary object properties. */
    inferMember(node)
    {
        if(!node.computed && node.object.type === 'Identifier' && node.object.name === 'Math' && MATH_CONSTANTS.has(node.property.name))
        {
            return this.constantValue(MATH_CONSTANTS.get(node.property.name));
        }

        return this.unknownValue();
    },

    /** @description Infers a template string and calculates its value when every interpolation is known. */
    inferTemplate(node, depth)
    {
        let value = node.quasis[0].value.cooked;
        for(let i = 0; i < node.expressions.length; ++i)
        {
            const expression = this.inferNode(node.expressions[i], depth);
            if(!expression.known)
            {
                return this.unknownValue(Types.STRING);
            }

            value += String(expression.value) + node.quasis[i + 1].value.cooked;
        }

        return this.constantValue(value);
    },

    /** @description Infers a unary expression using its operand's type and any known value. */
    inferUnary(node, depth)
    {
        const argument = this.inferNode(node.argument, depth);
        switch(node.operator)
        {
            case '!':
                if(argument.known)
                {
                    return this.constantValue(!argument.value);
                }

                return this.unknownValue(Types.BOOLEAN);
            case 'typeof':
                if(argument.known)
                {
                    return this.constantValue(typeof argument.value);
                }

                return this.unknownValue(Types.STRING);
            case 'void':
                return this.constantValue();
            case '+':
                if(argument.known)
                {
                    return this.constantValue(+argument.value);
                }

                return this.unknownValue(Types.NUMBER);
            case '-':
            case '~':
                if(argument.known)
                {
                    if(node.operator === '-')
                    {
                        return this.constantValue(-argument.value);
                    }

                    return this.constantValue(~argument.value);
                }

                if([ Types.STRING, Types.BOOLEAN, Types.NUMBER ].includes(argument.type))
                {
                    return this.unknownValue(Types.NUMBER);
                }

                return this.unknownValue(argument.type);
            default:
                return this.unknownValue();
        }
    },

    /** @description Calculates known primitive operands or infers a binary expression from their types. */
    inferBinary(node, depth)
    {
        const left = this.inferNode(node.left, depth);
        const right = this.inferNode(node.right, depth);
        if(left.known && right.known)
        {
            return this.calculateBinary(node.operator, left.value, right.value);
        }

        if(COMPARISON_OPERATORS.includes(node.operator))
        {
            return this.unknownValue(Types.BOOLEAN);
        }

        if(node.operator === '+' && (left.type === Types.STRING || right.type === Types.STRING))
        {
            return this.unknownValue(Types.STRING);
        }

        if(left.type === right.type && [ Types.NUMBER, 'bigint' ].includes(left.type))
        {
            return this.unknownValue(left.type);
        }

        return this.unknownValue();
    },

    /** @description Infers the selected conditional branch or a type shared by both possible branches. */
    inferConditional(node, depth)
    {
        const condition = this.inferNode(node.test, depth);
        if(condition.known)
        {
            if(condition.value)
            {
                return this.inferNode(node.consequent, depth);
            }

            return this.inferNode(node.alternate, depth);
        }

        const consequent = this.inferNode(node.consequent, depth);
        const alternate = this.inferNode(node.alternate, depth);
        if(consequent.type === alternate.type)
        {
            return this.unknownValue(consequent.type);
        }

        return this.unknownValue();
    },

    /** @description Infers logical and nullish expressions using JavaScript short-circuit semantics. */
    inferLogical(node, depth)
    {
        const left = this.inferNode(node.left, depth);
        if(left.known)
        {
            if(node.operator === '&&' && !left.value)
            {
                return left;
            }

            if(node.operator === '||' && left.value)
            {
                return left;
            }

            if(node.operator === '??' && left.value !== null && typeof left.value !== 'undefined')
            {
                return left;
            }

            return this.inferNode(node.right, depth);
        }

        const right = this.inferNode(node.right, depth);
        if(left.type === right.type)
        {
            return this.unknownValue(left.type);
        }

        return this.unknownValue();
    },

    /** @description Records an inferred type when no constant value is known. */
    unknownValue(type = Types.ANY)
    {
        return { type: type, known: false };
    },

    /** @description Carries only primitive constants; source objects and functions are never evaluated. */
    constantValue(value)
    {
        let type = typeof value;
        if(value === null || typeof value === 'undefined')
        {
            type = Types.ANY;
        }

        if(type === 'bigint' && value.toString(2).length > MAX_BIGINT_BITS)
        {
            return this.unknownValue(type);
        }

        if(type === Types.STRING && value.length > MAX_EXPRESSION_LENGTH)
        {
            return this.unknownValue(type);
        }

        return { type: type, known: true, value: value };
    },

    /** @description Applies supported operators to primitives constructed from syntax, without executing source text. */
    calculateBinary(operator, left, right)
    {
        if(typeof left === 'bigint' && typeof right === 'bigint' && [ '**', '<<', '>>' ].includes(operator))
        {
            if(operator === '**' && right < 0)
            {
                return this.unknownValue();
            }

            const limit = globalThis.BigInt(MAX_BIGINT_BITS);
            if(right > limit || right < -limit)
            {
                return this.unknownValue('bigint');
            }
        }

        switch(operator)
        {
            case '+':
                return this.constantValue(left + right);
            case '-':
                return this.constantValue(left - right);
            case '*':
                return this.constantValue(left * right);
            case '/':
                return this.constantValue(left / right);
            case '%':
                return this.constantValue(left % right);
            case '**':
                return this.constantValue(left ** right);
            case '&':
                return this.constantValue(left & right);
            case '|':
                return this.constantValue(left | right);
            case '^':
                return this.constantValue(left ^ right);
            case '<<':
                return this.constantValue(left << right);
            case '>>':
                return this.constantValue(left >> right);
            case '>>>':
                return this.constantValue(left >>> right);
            case '===':
                return this.constantValue(left === right);
            case '!==':
                return this.constantValue(left !== right);
            case '<':
                return this.constantValue(left < right);
            case '>':
                return this.constantValue(left > right);
            case '<=':
                return this.constantValue(left <= right);
            case '>=':
                return this.constantValue(left >= right);
            default:
                return this.unknownValue(Types.BOOLEAN);
        }
    },

    /**
     * @description Infers an expression's type without executing it, falling back to any for unsupported input.
     * @param {string} expression JavaScript expression text, optionally ending with a semicolon.
     * @returns {string} The inferred primitive type or any.
     */
    infer(expression)
    {
        if(expression.length > MAX_EXPRESSION_LENGTH)
        {
            return Types.ANY;
        }

        try
        {
            const expressionSource = expression.trim().replace(/;$/, '');
            return this.inferNode(parseExpression(expressionSource)).type;
        }
        catch
        {
            return Types.ANY;
        }
    }
};

module.exports = ExpressionType;
