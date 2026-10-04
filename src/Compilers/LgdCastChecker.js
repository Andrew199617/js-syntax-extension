const traverse = require('@babel/traverse').default;
const LgdReturnChecker = require('./LgdReturnChecker');
const LgdAccessibility = require('./LgdAccessibility');
const { baseTypeName, isNullableType } = require('./LgdTypeMaps');

/** @description Checks known cast incompatibilities while leaving uncertain reference downcasts free of runtime overhead. */
const LgdCastChecker = {
    /** @description Associates real operand expressions with source spans, retaining nested assertions independently. */
    check(context)
    {
        if(!context.casts?.length)
        {
            return [];
        }

        const paths = new Map();
        traverse(context.tree, {
            /** @description Captures the largest real operand beginning at each exact source position. */
            Expression: path =>
            {
                const offset = context.map.toSource(path.node.start);
                if(context.content[offset] === context.code[path.node.start] && !paths.has(offset))
                {
                    paths.set(offset, path);
                }
            }
        });
        const errors = [];
        for(const cast of context.casts)
        {
            if(!cast.known || !Number.isInteger(cast.end))
            {
                continue;
            }

            const nested = context.casts.find(candidate => candidate.start === cast.operandStart);
            let operand = paths.get(cast.operandStart);
            let nestedOperand = nested;
            while(!operand && nestedOperand)
            {
                operand = paths.get(nestedOperand.operandStart);
                const nestedStart = nestedOperand.operandStart;
                nestedOperand = context.casts.find(candidate => candidate.start === nestedStart);
            }

            if(!operand)
            {
                continue;
            }

            const ignoredCasts = new Set(context.casts.filter(candidate => candidate.start <= cast.start && cast.end <= candidate.end)
                .map(candidate => candidate.start));
            const checking = { ...context, ignoredCasts: ignoredCasts };
            checking.members = Object.create(context.members);
            checking.members._context = checking;
            const signature = { declaration: {}, group: { params: [], async: false, returnTypeName: cast.typeName } };
            const expressions = nested ? [operand] : this.branches(operand, checking);
            let incompatible;
            for(const expression of expressions)
            {
                const types = nested ? [nested.typeName] : LgdReturnChecker.expressionTypes(expression, signature, checking);
                let receiver = checking.members.receiver(expression);
                if(nested)
                {
                    receiver = nested.target?.kind === 'class' ? { declaration: nested.target, kind: 'instance' } : null;
                }

                incompatible = types.find(type => !this.compatible(cast, type, receiver, checking));
                if(incompatible)
                {
                    break;
                }
            }

            const redundant = !incompatible && !nested && this.redundant(cast, operand, checking, signature);
            if(redundant)
            {
                errors.push(redundant);
            }

            if(incompatible)
            {
                errors.push({ offset: cast.typeStart, endOffset: cast.typeEnd, code: 'lgd.cast.incompatibleType',
                    message: `Cannot cast ${incompatible} to ${cast.typeName}. Only Number casts convert values; reference casts do not change the value.` });
            }
        }

        return errors;
    },

    /** @description Offers removal only for an unchanged local constant with the exact existing class contract. */
    redundant(cast, operand, context, signature)
    {
        if(!operand.isIdentifier() || baseTypeName(cast.typeName) === 'Number' || cast.typeName.endsWith('?'))
        {
            return null;
        }

        const target = cast.target;
        const binding = operand.scope.getBinding(operand.node.name);
        if(target?.kind !== 'class' || !context.declarations.includes(target) || !binding?.constant || binding.kind !== 'const')
        {
            return null;
        }

        const offset = context.map.toSource(binding.identifier.start);
        const declaration = context.declarations.find(candidate => candidate.nameStart === offset);
        const receiver = context.members.receiver(operand);
        if(declaration?.typeName !== cast.typeName || receiver?.declaration !== target || receiver.kind !== 'instance')
        {
            return null;
        }

        const types = LgdReturnChecker.expressionTypes(operand, signature, context);
        const head = context.content.slice(cast.start, cast.headEnd);
        if(types.length !== 1 || types[0] !== cast.typeName || (/\/\*|\/\//).test(head))
        {
            return null;
        }

        return { offset: cast.typeStart, endOffset: cast.typeEnd, code: 'lgd.cast.redundant', category: 'style', severity: 'warning',
            message: `The expression already has type ${cast.typeName}; this cast is unnecessary.`,
            quickFix: { kind: 'removeRedundantCast', offset: cast.start, endOffset: cast.headEnd, typeName: cast.typeName } };
    },

    /** @description Keeps nominal identity on conditional and sequence results instead of reducing them to names. */
    branches(path, context)
    {
        if(context.members.castReceiver(path))
        {
            return [path];
        }

        if(path.isConditionalExpression())
        {
            return [ ...this.branches(path.get('consequent'), context), ...this.branches(path.get('alternate'), context) ];
        }

        if(path.isSequenceExpression())
        {
            return this.branches(path.get('expressions').slice(-1)[0], context);
        }

        return [path];
    },

    /** @description Preserves JavaScript Number conversion while rejecting proven incompatible non-converting assertions. */
    compatible(cast, inferred, receiver, context)
    {
        const expected = baseTypeName(cast.typeName);
        const actual = baseTypeName(inferred);
        if(expected === 'Number' && !cast.target || actual === 'Unknown')
        {
            return true;
        }

        const primitiveTypes = [ 'Number', 'String', 'Boolean', 'BigInt', 'Symbol' ];
        const nominal = cast.target?.kind === 'class';
        const reference = nominal || !primitiveTypes.includes(expected);
        if(actual === 'null')
        {
            return reference || isNullableType(cast.typeName);
        }

        if(actual === 'undefined')
        {
            return false;
        }

        if(isNullableType(inferred))
        {
            return this.compatible(cast, actual, receiver, context);
        }

        if(expected === 'Object' && !nominal)
        {
            return true;
        }

        if(primitiveTypes.includes(expected) && !nominal)
        {
            return expected === actual || actual === 'Object';
        }

        if(primitiveTypes.includes(actual) && !receiver)
        {
            return false;
        }

        const target = cast.target;
        if(target?.kind === 'class' && receiver?.kind === 'instance')
        {
            const source = receiver.declaration;
            return LgdAccessibility.derives(source, target, context.members) || LgdAccessibility.derives(target, source, context.members);
        }

        if(expected === actual || actual === 'Object' || target?.kind === 'interface' || target?.contractKind === 'interface')
        {
            return true;
        }

        return ![ 'Array', 'Function' ].includes(expected) && ![ 'Array', 'Function' ].includes(actual);
    }
};

module.exports = LgdCastChecker;
