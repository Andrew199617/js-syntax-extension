const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const LgdSourceMap = require('./LgdSourceMap');
const LgdReturnFlow = require('./LgdReturnFlow');
const { inferExpression, maskCode, UNKNOWN } = require('./LgdInfer');
const { tsTypeMap } = require('./LgdTypeMaps');
const LgdBindingFlow = require('./LgdBindingFlow');
const LgdBindingTypes = require('./LgdBindingTypes');

/** @description Checks explicit named return contracts against the mapped JavaScript function bodies. */
const LgdReturnChecker = {
    /** @description Collects annotated method signatures independently of parameter annotations. */
    signatures(declarations, inherited = [])
    {
        const explicit = declarations.flatMap(declaration => (declaration.methodTypedParams || [])
            .filter(group => group.returnTypeName && !group.abstract)
            .map(group => ({ declaration: declaration, group: group })));

        return [ ...explicit, ...inherited ];
    },

    /** @description Builds one shared syntax and lexical-value analysis for assignments and returns. */
    createContext(content, declarations, emitted, options = {})
    {
        const { inherited = [], externals = new Map() } = options;
        const tree = parser.parse(emitted.code, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
        const context = {
            content: content,
            declarations: declarations,
            code: emitted.code,
            map: LgdSourceMap.create(emitted.segments),
            errors: [],
            signatures: this.signatures(declarations, inherited),
            tree: tree,
            flow: LgdBindingFlow.create(tree),
            externalsByName: new Map(),
            externals: externals
        };
        for(const info of externals.values())
        {
            context.externalsByName.set(info.exportName, { keyword: info.keyword, kind: 'external' });
        }

        context.bindings = LgdBindingTypes.create(context);
        return context;
    },

    /** @description Validates explicit return annotations using shared syntax-aware function boundaries. */
    check(context)
    {
        const byBody = new Map(context.signatures.map(signature => [
            context.map.toOutput(signature.declaration.initializerStart + signature.group.bodyStart), signature
        ]));

        context.errors = [];
        traverse(context.tree, {
            /** @description Matches a generated function to its explicit source signature. */
            Function: path =>
            {
                const signature = byBody.get(path.node.body.start);
                if(signature)
                {
                    this.checkFunction(path, signature, context);
                }
            }
        });
        return context.errors;
    },

    /** @description Validates one named method and its directly owned return statements. */
    checkFunction(path, signature, context)
    {
        const group = signature.group;
        const typeStart = group.inherited ? group.reportStart : signature.declaration.initializerStart + group.returnTypeStart;
        const typeEnd = group.inherited ? group.reportEnd : signature.declaration.initializerStart + group.returnTypeEnd;
        function report(message)
        {
            context.errors.push({ offset: typeStart, endOffset: typeEnd, message: message });
        }

        if(group.accessor && signature.declaration.kind !== 'class' || group.generator)
        {
            report('Explicit return annotations on accessors and generators are not supported yet.');
            return;
        }

        const declared = group.returnTypeName;
        const root = declared.split('.')[0];
        const binding = path.scope.getBinding(root);
        const builtin = Object.hasOwn(tsTypeMap, declared) || declared === 'void';
        const nominal = !declared.includes('.') && binding && context.bindings.descriptor(binding);
        const external = declared.includes('.') && binding;
        const knownType = builtin || nominal || external || group.opaqueReturn;
        if(!knownType)
        {
            report(`Unknown return type '${declared}'.`);
            return;
        }

        path.get('body').traverse({
            Function: nested => nested.skip(),

            /** @description Checks only returns belonging to this method. */
            ReturnStatement: returned =>
            {
                if(!context.flow.reachable(returned))
                {
                    return;
                }

                const argument = returned.get('argument');
                const types = argument.node ? this.expressionTypes(argument, signature, context) : ['undefined'];
                for(const type of new Set(types))
                {
                    if(!this.compatible(declared, type, group.opaqueReturn))
                    {
                        const node = argument.node || returned.node;
                        context.errors.push({
                            offset: context.map.toSource(node.start),
                            endOffset: context.map.toSource(node.end),
                            message: `Cannot return ${type} from a ${declared} method.`
                        });
                    }
                }
            }
        });

        if(declared !== 'void' && LgdReturnFlow.statement(path.node.body).has('normal'))
        {
            report(`Method '${group.name}' must return ${declared} on every normal path.`);
        }
    },

    /** @description Checks known returned values without inventing types for unknown calls or members. */
    compatible(declared, inferred, opaque = false)
    {
        if(inferred === UNKNOWN)
        {
            return true;
        }

        if(declared === 'void')
        {
            return inferred === 'undefined';
        }

        if(inferred === 'undefined' || inferred === 'null')
        {
            return false;
        }

        if(declared === 'Object')
        {
            return true;
        }

        if(opaque)
        {
            const reference = [ 'Object', 'Array', 'Function' ].includes(inferred);
            const named = !Object.hasOwn(tsTypeMap, inferred) && inferred !== 'void';
            return reference || named;
        }

        if(declared.includes('.'))
        {
            return [ declared, 'Object', 'Array', 'Function' ].includes(inferred);
        }

        return declared === inferred;
    },

    /** @description Infers each possible expression result while retaining null and undefined distinctions. */
    expressionTypes(path, signature, context, visited = new Set())
    {
        const node = path.node;
        const literals = { NumericLiteral: 'Number', StringLiteral: 'String', BooleanLiteral: 'Boolean',
            BigIntLiteral: 'BigInt', TemplateLiteral: 'String', ObjectExpression: 'Object', ArrayExpression: 'Array',
            FunctionExpression: 'Function', ArrowFunctionExpression: 'Function' };
        if(literals[node.type])
        {
            return [literals[node.type]];
        }

        if(node.type === 'NullLiteral')
        {
            return ['null'];
        }

        if(node.type === 'NewExpression')
        {
            const constructorName = node.callee.type === 'Identifier' ? node.callee.name : null;
            const nativeConstructor = constructorName && !path.scope.getBinding(constructorName) && context.bindings.nativeUnchanged(constructorName);
            if(nativeConstructor && [ 'Array', 'Function' ].includes(node.callee.name))
            {
                return [node.callee.name];
            }

            const expected = signature.group.returnTypeName;
            const primitive = [ 'void', 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'Object' ].includes(expected);
            return [primitive ? 'Object' : UNKNOWN];
        }

        if(node.type === 'RegExpLiteral')
        {
            return ['Object'];
        }

        if(node.type === 'ThisExpression')
        {
            const owner = signature.declaration.name;
            return [signature.group.returnTypeName === owner ? owner : 'Object'];
        }

        if(node.type === 'UpdateExpression')
        {
            const types = this.expressionTypes(path.get('argument'), signature, context, visited);
            const scope = context.bindings.scope(path);
            return types.map(inferred =>
            {
                const type = Object.hasOwn(tsTypeMap, inferred) ? inferred : scope.get(inferred)?.keyword || inferred;
                if(type === 'BigInt' || type === UNKNOWN)
                {
                    return type;
                }

                return 'Number';
            });
        }

        if(node.type === 'AssignmentExpression')
        {
            if(node.operator === '=')
            {
                return this.expressionTypes(path.get('right'), signature, context, visited);
            }

            return this.operatorTypes(path, signature, context, visited);
        }

        if(node.type === 'BinaryExpression' || node.type === 'LogicalExpression')
        {
            return this.operatorTypes(path, signature, context, visited);
        }

        if(node.type === 'UnaryExpression' && node.operator === 'void')
        {
            return ['undefined'];
        }

        if(node.type === 'ConditionalExpression')
        {
            const truth = context.flow.truth(path.get('test'));
            if(truth !== null)
            {
                return this.expressionTypes(path.get(truth ? 'consequent' : 'alternate'), signature, context, visited);
            }

            return [ ...this.expressionTypes(path.get('consequent'), signature, context, visited),
                ...this.expressionTypes(path.get('alternate'), signature, context, visited) ];
        }

        if(node.type === 'SequenceExpression')
        {
            const expressions = path.get('expressions');
            return this.expressionTypes(expressions[expressions.length - 1], signature, context, visited);
        }

        if(node.type === 'AwaitExpression')
        {
            const awaited = { ...signature, group: { ...signature.group, async: true } };
            return this.expressionTypes(path.get('argument'), awaited, context, visited);
        }

        if(node.type === 'CallExpression')
        {
            if(this.isPromiseResolve(path, context))
            {
                if(!signature.group.async)
                {
                    return ['Promise'];
                }

                const argument = path.get('arguments')[0];
                return argument ? this.expressionTypes(argument, signature, context, visited) : ['undefined'];
            }

            return [this.methodCallType(path, signature, context)];
        }

        if(node.type === 'Identifier')
        {
            return this.identifierTypes(path, signature, context, visited);
        }

        const scope = new Map();
        for(const [ name, binding ] of Object.entries(path.scope.getAllBindings()))
        {
            const types = this.currentBindingTypes({ path: path, binding: binding }, signature, context, visited);
            const unique = new Set(types);
            scope.set(name, { keyword: unique.size === 1 ? types[0] : UNKNOWN });
        }

        const expression = context.code.slice(node.start, node.end);
        const inferred = inferExpression(maskCode(expression, true), scope, new Map());
        return [scope.has(inferred) ? scope.get(inferred).keyword : inferred];
    },

    /** @description Evaluates operator results from current operand values, not declaration labels. */
    operatorTypes(path, signature, context, visited)
    {
        const operator = path.isAssignmentExpression() ? path.node.operator.slice(0, -1) : path.node.operator;
        const left = this.expressionTypes(path.get('left'), signature, context, visited);
        const right = this.expressionTypes(path.get('right'), signature, context, visited);
        if([ '&&', '||', '??' ].includes(operator))
        {
            const fact = operator === '??' ? context.flow.nullish(path.get('left')) : context.flow.truth(path.get('left'));
            if(fact !== null)
            {
                const takeRight = operator === '||' ? !fact : fact;
                return takeRight ? right : left;
            }

            const retained = operator === '??' ? left.filter(type => type !== 'null' && type !== 'undefined') : left;
            return [ ...retained, ...right ];
        }

        return left.flatMap(leftType => right.map(rightType =>
        {
            const scope = context.bindings.scope(path);
            const first = Object.hasOwn(tsTypeMap, leftType) ? leftType : scope.get(leftType)?.keyword || leftType;
            const second = Object.hasOwn(tsTypeMap, rightType) ? rightType : scope.get(rightType)?.keyword || rightType;
            const numeric = [ 'Number', 'String', 'Boolean', 'null', 'undefined' ];
            const arithmetic = [ '-', '*', '/', '%', '**', '|', '&', '^', '<<', '>>', '>>>' ].includes(operator);
            if(arithmetic && numeric.includes(first) && numeric.includes(second))
            {
                return 'Number';
            }

            const operands = new Map([
                [ 'leftValue', { keyword: first === 'null' || first === 'undefined' ? 'Null' : first } ],
                [ 'rightValue', { keyword: second === 'null' || second === 'undefined' ? 'Null' : second } ]
            ]);
            const inferred = inferExpression(`leftValue ${operator} rightValue`, operands, new Map());
            return operands.has(inferred) ? operands.get(inferred).keyword : inferred;
        }));
    },

    /** @description Reads all reaching values of one binding at the current expression. */
    currentBindingTypes(point, signature, context, visited)
    {
        const { path, binding } = point;
        const declared = context.bindings.type(binding, signature);
        const offset = context.map.toSource(binding.identifier.start);
        const declaration = context.declarations.find(candidate => candidate.nameStart === offset);
        if(declaration?.kind === 'class')
        {
            return [declared];
        }

        const origins = context.flow.origins(path, binding);
        if(!origins)
        {
            return [declared || UNKNOWN];
        }

        const inferred = origins.flatMap(origin =>
        {
            if(origin === '__declared__')
            {
                return [declared || UNKNOWN];
            }

            return typeof origin === 'string' ? [origin] : this.expressionTypes(origin, signature, context, visited);
        });

        if(declaration?.name === declaration?.typeName && declaration)
        {
            return inferred.map(type =>
            {
                if([ 'Object', 'Array', 'Function' ].includes(type))
                {
                    return declaration.name;
                }

                return type;
            });
        }

        if(signature.group.assignment && declaration)
        {
            const entry = context.bindings.descriptor(binding);
            return inferred.map(type =>
            {
                if(type === entry.keyword)
                {
                    return entry.ref || declaration.name;
                }

                return type;
            });
        }

        return inferred;
    },

    /** @description Resolves calls to annotated methods on the current or a directly bound object. */
    methodCallType(path, signature, context)
    {
        const callee = path.node.callee;
        if(callee.type === 'Identifier' && callee.name === 'require' && !path.scope.getBinding('require'))
        {
            const specifier = path.node.arguments[0];
            const external = specifier?.type === 'StringLiteral' && context.externals.get(specifier.value);
            return external ? external.exportName : UNKNOWN;
        }

        if(callee.type !== 'MemberExpression' || callee.computed)
        {
            return UNKNOWN;
        }

        let owner = null;
        if(callee.object.type === 'ThisExpression')
        {
            owner = signature.declaration;
        }
        else if(callee.object.type === 'Identifier')
        {
            const binding = path.scope.getBinding(callee.object.name);
            if(binding)
            {
                if(binding.constantViolations.length > 0)
                {
                    return UNKNOWN;
                }

                const offset = context.map.toSource(binding.identifier.start);
                owner = context.declarations.find(declaration => declaration.nameStart === offset);
                const origins = context.flow.origins(path, binding);
                const initial = binding.path.isVariableDeclarator() && binding.path.node.init;
                if(origins?.some(origin => typeof origin === 'string' || origin.node !== initial))
                {
                    return UNKNOWN;
                }
            }
        }

        if(!owner)
        {
            return UNKNOWN;
        }

        if(context.bindings.methodChanged(owner, callee.property.name))
        {
            return UNKNOWN;
        }

        if(owner.kind === 'class' && callee.property.name === 'create')
        {
            return owner.name;
        }

        const method = context.signatures.find(candidate => candidate.declaration === owner && candidate.group.name === callee.property.name)?.group;
        if(!method)
        {
            return UNKNOWN;
        }

        if(method.async && !signature.group.async)
        {
            return 'Promise';
        }

        return method.returnTypeName === 'void' ? 'undefined' : method.returnTypeName;
    },

    /** @description Recognizes the built-in Promise.resolve without assuming a shadowed Promise is native. */
    isPromiseResolve(path, context)
    {
        const callee = path.node.callee;
        if(callee.type !== 'MemberExpression' || callee.computed || callee.object.type !== 'Identifier')
        {
            return false;
        }

        const nativePromise = callee.object.name === 'Promise' && !path.scope.getBinding('Promise') && context.bindings.nativeUnchanged('Promise');
        return nativePromise && callee.property.name === 'resolve';
    },

    /** @description Resolves identifiers from their actual lexical binding and preserves shadowing. */
    identifierTypes(path, signature, context, visited)
    {
        const binding = path.scope.getBinding(path.node.name);
        if(!binding)
        {
            return [path.node.name === 'undefined' ? 'undefined' : UNKNOWN];
        }

        if(visited.has(path.node))
        {
            return [UNKNOWN];
        }

        const next = new Set(visited);
        next.add(path.node);
        return this.currentBindingTypes({ path: path, binding: binding }, signature, context, next);
    }
};

module.exports = LgdReturnChecker;
