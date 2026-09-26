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

function unknownValue(type = Types.ANY)
{
    return { type: type, known: false };
}

/** @description Carries only primitive constants; source objects and functions are never evaluated. */
function constantValue(value)
{
    let type = typeof value;
    if(value === null || typeof value === 'undefined')
    {
        type = Types.ANY;
    }

    if(type === 'bigint' && value.toString(2).length > MAX_BIGINT_BITS)
    {
        return unknownValue(type);
    }

    if(type === Types.STRING && value.length > MAX_EXPRESSION_LENGTH)
    {
        return unknownValue(type);
    }

    return { type: type, known: true, value: value };
}

/** @description Applies supported operators to primitives constructed from syntax, without executing source text. */
function calculateBinary(operator, left, right)
{
    if(typeof left === 'bigint' && typeof right === 'bigint' && [ '**', '<<', '>>' ].includes(operator))
    {
        if(operator === '**' && right < 0)
        {
            return unknownValue();
        }

        const limit = globalThis.BigInt(MAX_BIGINT_BITS);
        if(right > limit || right < -limit)
        {
            return unknownValue('bigint');
        }
    }

    switch(operator)
    {
        case '+':
            return constantValue(left + right);
        case '-':
            return constantValue(left - right);
        case '*':
            return constantValue(left * right);
        case '/':
            return constantValue(left / right);
        case '%':
            return constantValue(left % right);
        case '**':
            return constantValue(left ** right);
        case '&':
            return constantValue(left & right);
        case '|':
            return constantValue(left | right);
        case '^':
            return constantValue(left ^ right);
        case '<<':
            return constantValue(left << right);
        case '>>':
            return constantValue(left >> right);
        case '>>>':
            return constantValue(left >>> right);
        case '===':
            return constantValue(left === right);
        case '!==':
            return constantValue(left !== right);
        case '<':
            return constantValue(left < right);
        case '>':
            return constantValue(left > right);
        case '<=':
            return constantValue(left <= right);
        case '>=':
            return constantValue(left >= right);
        default:
            return unknownValue(Types.BOOLEAN);
    }
}

/** @description Combines constant calculation with type inference for unresolved expressions. */
const ExpressionInference = {
    infer(node, depth = 0)
    {
        if(depth >= MAX_EXPRESSION_DEPTH)
        {
            return unknownValue();
        }

        switch(node.type)
        {
            case 'StringLiteral':
            case 'NumericLiteral':
            case 'BooleanLiteral':
                return constantValue(node.value);
            case 'NullLiteral':
                return constantValue(null);
            case 'BigIntLiteral':
                if(node.value.length > MAX_BIGINT_BITS)
                {
                    return unknownValue('bigint');
                }

                return constantValue(globalThis.BigInt(node.value));
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
                return unknownValue();
        }
    },

    inferIdentifier(name)
    {
        switch(name)
        {
            case 'undefined':
                return constantValue(undefined);
            case 'NaN':
                return constantValue(NaN);
            case 'Infinity':
                return constantValue(Infinity);
            default:
                return unknownValue();
        }
    },

    inferMember(node)
    {
        if(!node.computed && node.object.type === 'Identifier' && node.object.name === 'Math' && MATH_CONSTANTS.has(node.property.name))
        {
            return constantValue(MATH_CONSTANTS.get(node.property.name));
        }

        return unknownValue();
    },

    inferTemplate(node, depth)
    {
        let value = node.quasis[0].value.cooked;
        for(let i = 0; i < node.expressions.length; ++i)
        {
            const expression = this.infer(node.expressions[i], depth);
            if(!expression.known)
            {
                return unknownValue(Types.STRING);
            }

            value += String(expression.value) + node.quasis[i + 1].value.cooked;
        }

        return constantValue(value);
    },

    inferUnary(node, depth)
    {
        const argument = this.infer(node.argument, depth);
        switch(node.operator)
        {
            case '!':
                if(argument.known)
                {
                    return constantValue(!argument.value);
                }

                return unknownValue(Types.BOOLEAN);
            case 'typeof':
                if(argument.known)
                {
                    return constantValue(typeof argument.value);
                }

                return unknownValue(Types.STRING);
            case 'void':
                return constantValue(undefined);
            case '+':
                if(argument.known)
                {
                    return constantValue(+argument.value);
                }

                return unknownValue(Types.NUMBER);
            case '-':
            case '~':
                if(argument.known)
                {
                    if(node.operator === '-')
                    {
                        return constantValue(-argument.value);
                    }

                    return constantValue(~argument.value);
                }

                if([ Types.STRING, Types.BOOLEAN, Types.NUMBER ].includes(argument.type))
                {
                    return unknownValue(Types.NUMBER);
                }

                return unknownValue(argument.type);
            default:
                return unknownValue();
        }
    },

    inferBinary(node, depth)
    {
        const left = this.infer(node.left, depth);
        const right = this.infer(node.right, depth);
        if(left.known && right.known)
        {
            return calculateBinary(node.operator, left.value, right.value);
        }

        if(COMPARISON_OPERATORS.includes(node.operator))
        {
            return unknownValue(Types.BOOLEAN);
        }

        if(node.operator === '+' && (left.type === Types.STRING || right.type === Types.STRING))
        {
            return unknownValue(Types.STRING);
        }

        if(left.type === right.type && [ Types.NUMBER, 'bigint' ].includes(left.type))
        {
            return unknownValue(left.type);
        }

        return unknownValue();
    },

    inferConditional(node, depth)
    {
        const condition = this.infer(node.test, depth);
        if(condition.known)
        {
            if(condition.value)
            {
                return this.infer(node.consequent, depth);
            }

            return this.infer(node.alternate, depth);
        }

        const consequent = this.infer(node.consequent, depth);
        const alternate = this.infer(node.alternate, depth);
        if(consequent.type === alternate.type)
        {
            return unknownValue(consequent.type);
        }

        return unknownValue();
    },

    inferLogical(node, depth)
    {
        const left = this.infer(node.left, depth);
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

            return this.infer(node.right, depth);
        }

        const right = this.infer(node.right, depth);
        if(left.type === right.type)
        {
            return unknownValue(left.type);
        }

        return unknownValue();
    }
};

function inferExpressionType(expression)
{
    if(expression.length > MAX_EXPRESSION_LENGTH)
    {
        return Types.ANY;
    }

    try
    {
        const expressionSource = expression.trim().replace(/;$/, '');
        return ExpressionInference.infer(parseExpression(expressionSource)).type;
    }
    catch
    {
        return Types.ANY;
    }
}

module.exports = inferExpressionType;
