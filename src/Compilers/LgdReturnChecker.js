const LgdAmbientTypes = require('./LgdAmbientTypes');
const parser = require('@babel/parser');
const LgdCastSyntax = require('./LgdCastSyntax');
const LgdEnumSyntax = require('./LgdEnumSyntax');
const traverse = require('@babel/traverse').default;
const LgdSourceMap = require('./LgdSourceMap');
const LgdReturnFlow = require('./LgdReturnFlow');
const { inferExpression, UNKNOWN } = require('./LgdInfer');
const { tsTypeMap, baseTypeName, isNullableType, rootTypeName, elementTypeName, canonicalTypeName, arrayCompatibility } = require('./LgdTypeMaps');
const LgdBindingFlow = require('./LgdBindingFlow');
const LgdBindingTypes = require('./LgdBindingTypes');
const LgdClassMemberSemantics = require('./LgdClassMemberSemantics');

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
        const tree = options.tree || parser.parse(emitted.code, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
        const context = {
            content: content,
            casts: options.casts || [],
            projectId: options.projectId || null,
            declarations: declarations,
            code: emitted.code,
            map: LgdSourceMap.create(emitted.segments),
            errors: [],
            signatures: this.signatures(declarations, inherited),
            tree: tree,
            flow: LgdBindingFlow.create(tree),
            externalsByName: new Map(),
            ambient: externals.ambient || LgdAmbientTypes.forSource(externals.sourceContext?.sourcePath),
            externals: externals
        };
        for(const info of externals.values())
        {
            context.externalsByName.set(info.exportName, { keyword: info.enumValueType || info.keyword, kind: 'external' });
        }

        context.bindings = LgdBindingTypes.create(context);
        context.members = LgdClassMemberSemantics.create(context);
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
        const baseType = rootTypeName(declared);
        const root = baseType.split('.')[0];
        const binding = path.parentPath.scope.getBinding(root);
        const builtin = Object.hasOwn(tsTypeMap, baseType) || declared === 'void';
        const nominal = !declared.includes('.') && binding && context.bindings.descriptor(binding);
        const external = declared.includes('.') && binding;
        const erased = !builtin && !nominal && context.bindings.erasedType(baseType, typeStart);
        const ambient = !binding && context.ambient.resolve(rootTypeName(declared));
        const knownType = builtin || nominal || external || erased || ambient || group.opaqueReturn;
        if(!knownType)
        {
            report(`Unknown return type '${declared}'.`);
            return;
        }

        const returnFix = this.returnTypeFix(path, signature, context);
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
                    const nonnullable = type !== 'null' && type !== 'undefined';
                    const returnContract = { nullable: false, typeOffset: typeStart, freshArray: argument.isArrayExpression() };
                    const inheritedCompatible = nonnullable && context.members.compatible(declared, type, argument, returnContract);
                    if(!this.compatible(declared, type, group.opaqueReturn, argument.isArrayExpression()) && !inheritedCompatible)
                    {
                        const node = argument.node || returned.node;
                        const error = {
                            offset: context.map.toSource(node.start),
                            endOffset: context.map.toSource(node.end),
                            code: 'lgd.return.typeMismatch',
                            message: `Cannot return ${type} from a ${declared} method.`
                        };
                        if(returnFix)
                        {
                            error.quickFix = { ...returnFix, returnStart: error.offset, returnEnd: error.endOffset };
                        }

                        context.errors.push(error);
                    }
                }
            }
        });

        if(declared !== 'void' && LgdReturnFlow.statement(path.node.body).has('normal'))
        {
            report(`Method '${group.name}' must return ${declared} on every normal path.`);
        }
    },

    /** @description Supplies exact Number-to-String return provenance only when every reachable result is provably String. */
    returnTypeFix(path, signature, context)
    {
        const { declaration, group } = signature;
        const unsupported = group.inherited || group.async || group.accessor || group.generator || group.abstract;
        const offset = declaration.initializerStart + group.returnTypeStart;
        const endOffset = declaration.initializerStart + group.returnTypeEnd;
        if(unsupported || group.returnTypeName !== 'Number' || context.content.slice(offset, endOffset) !== 'Number')
        {
            return null;
        }

        if(!this.returnsOnly(path, signature, context, 'String'))
        {
            return null;
        }

        return { kind: 'changeReturnType', declarationStart: declaration.headStart, groupStart: group.start,
            methodName: group.name, offset: offset, endOffset: endOffset, oldTypeName: 'Number', newTypeName: 'String' };
    },

    /** @description Requires an explicit consistent result on every normal path without trusting unknown-compatible returns. */
    returnsOnly(path, signature, context, expected)
    {
        if(signature.group.async || signature.group.generator || signature.group.accessor || LgdReturnFlow.statement(path.node.body).has('normal'))
        {
            return false;
        }

        let foundReturn = false;
        let consistent = true;
        path.get('body').traverse({
            Function: nested => nested.skip(),

            /** @description Rejects null, undefined, mixed, unknown and captured-write values in directly owned returns. */
            ReturnStatement: returned =>
            {
                if(!context.flow.reachable(returned))
                {
                    return;
                }

                foundReturn = true;
                const argument = returned.get('argument');
                const proofContext = { ...context, strictReturnProof: true };
                const types = argument.node ? this.expressionTypes(argument, signature, proofContext) : ['undefined'];
                if(types.length === 0 || types.some(type => type !== expected))
                {
                    consistent = false;
                }
            },

            /** @description Withholds proof when a captured binding can be changed outside the method's direct flow. */
            Identifier: referenced =>
            {
                if(!referenced.isReferencedIdentifier())
                {
                    return;
                }

                const binding = referenced.scope.getBinding(referenced.node.name);
                if(binding?.constantViolations.some(write => write.getFunctionParent() !== path))
                {
                    consistent = false;
                }
            }
        });
        return foundReturn && consistent;
    },

    /** @description Checks known returned values without inventing types for unknown calls or members. */
    compatible(declared, inferred, opaque = false, freshArray = false)
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
            return inferred === 'null' && isNullableType(declared);
        }

        if(isNullableType(inferred))
        {
            return isNullableType(declared) && this.compatible(declared, baseTypeName(inferred), opaque);
        }

        declared = baseTypeName(declared);
        if(declared === 'Object')
        {
            return true;
        }

        inferred = canonicalTypeName(inferred);
        const array = arrayCompatibility(declared, inferred, (expected, actual) => this.compatible(expected, actual, opaque, freshArray), freshArray);
        if(array !== null)
        {
            return array;
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
    expressionTypes(path, signature, context, inference = null)
    {
        inference ||= { active: new Set(), cache: new Map(), awaitedCache: new Map(), cycles: 0, scope: path.scope };
        if(inference.active.has(path.node))
        {
            inference.cycles++;
            return [UNKNOWN];
        }

        const cache = signature.group.async ? inference.awaitedCache : inference.cache;
        if(cache.has(path.node))
        {
            return cache.get(path.node);
        }

        const cycles = inference.cycles;
        inference.active.add(path.node);
        let types;
        try
        {
            types = this._expressionTypes(path, signature, context, inference);
        }
        finally
        {
            inference.active.delete(path.node);
        }

        const expanded = types.flatMap(type =>
        {
            if(isNullableType(type))
            {
                return [ baseTypeName(type), 'null' ];
            }

            return [type];
        });

        const binding = path.isIdentifier() && path.scope.getBinding(path.node.name);
        const narrowed = binding ? context.flow.narrowTypes(path, binding, expanded) : expanded;
        const unique = [...new Set(narrowed)];

        // Results that depend on an active cycle are branch-local, so never cache them.
        // Other shared subgraphs can be reused within this request and async mode.
        if(inference.cycles === cycles)
        {
            cache.set(path.node, unique);
        }

        return unique;
    },

    /** @description Infers one expression with branch-local cycle protection for binding origins. */
    _expressionTypes(path, signature, context, inference)
    {
        const cast = LgdCastSyntax.forPath(path, context);
        if(cast)
        {
            return [cast.typeName];
        }

        if(path.isIdentifier() && LgdEnumSyntax.receiver(path, context))
        {
            return ['Object'];
        }

        const enumType = LgdEnumSyntax.memberType(path, context);
        if(enumType)
        {
            return [enumType];
        }

        const node = path.node;
        const memberType = context.members.expressionType(path, signature);
        if(memberType)
        {
            return [memberType];
        }

        if(path.isArrayExpression())
        {
            if(elementTypeName(signature.group.returnTypeName) === null && !signature.group.arrayElements)
            {
                return ['Array'];
            }

            const elements = path.get('elements');
            const types = elements.flatMap(element =>
            {
                if(!element.node)
                {
                    return ['undefined'];
                }

                if(element.isSpreadElement())
                {
                    return this.expressionTypes(element.get('argument'), signature, context, inference).map(type => elementTypeName(type) || UNKNOWN);
                }

                return this.expressionTypes(element, signature, context, inference);
            });

            return [...new Set(types.length === 0 ? [UNKNOWN] : types)].map(type => `${type}[]`);
        }

        if(path.isMemberExpression() || path.isOptionalMemberExpression())
        {
            const receiver = path.get('object');
            const indexed = { ...signature, group: { ...signature.group, arrayElements: true } };
            const receiverTypes = this.expressionTypes(receiver, indexed, context, inference);
            const propertyTypes = path.node.computed && this.expressionTypes(path.get('property'), signature, context, inference);
            const numericIndex = path.node.computed && propertyTypes.every(type => type === 'Number');
            const length = !path.node.computed && path.node.property.name === 'length';
            if(length && receiverTypes.every(type => elementTypeName(type) !== null || type === 'Array'))
            {
                return ['Number'];
            }

            if(numericIndex)
            {
                return receiverTypes.map(type => elementTypeName(type) || UNKNOWN);
            }
        }

        const literals = { NumericLiteral: 'Number', StringLiteral: 'String', BooleanLiteral: 'Boolean',
            BigIntLiteral: 'BigInt', TemplateLiteral: 'String', ObjectExpression: 'Object',
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

            const expected = baseTypeName(signature.group.returnTypeName);
            const primitive = [ 'void', 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'Object' ].includes(expected);
            return [primitive ? 'Object' : UNKNOWN];
        }

        if(node.type === 'RegExpLiteral')
        {
            const consumerScope = inference.scope || path.scope;
            const shadowed = path.scope.getBinding('RegExp') || consumerScope.getBinding('RegExp');
            const known = !shadowed && context.ambient.resolve('RegExp');
            return [known ? 'RegExp' : 'Object'];
        }

        if(node.type === 'ThisExpression')
        {
            const owner = signature.declaration.name;
            return [baseTypeName(signature.group.returnTypeName) === owner ? owner : 'Object'];
        }

        if(node.type === 'UpdateExpression')
        {
            const types = this.expressionTypes(path.get('argument'), signature, context, inference);
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
                return this.expressionTypes(path.get('right'), signature, context, inference);
            }

            return this.operatorTypes(path, signature, context, inference);
        }

        if(node.type === 'BinaryExpression' || node.type === 'LogicalExpression')
        {
            return this.operatorTypes(path, signature, context, inference);
        }

        if(node.type === 'UnaryExpression')
        {
            return this.unaryTypes(path, signature, context, inference);
        }

        if(node.type === 'ConditionalExpression')
        {
            const truth = context.flow.truth(path.get('test'));
            if(truth !== null)
            {
                return this.expressionTypes(path.get(truth ? 'consequent' : 'alternate'), signature, context, inference);
            }

            return [ ...this.expressionTypes(path.get('consequent'), signature, context, inference),
                ...this.expressionTypes(path.get('alternate'), signature, context, inference) ];
        }

        if(node.type === 'SequenceExpression')
        {
            const expressions = path.get('expressions');
            return this.expressionTypes(expressions[expressions.length - 1], signature, context, inference);
        }

        if(node.type === 'AwaitExpression')
        {
            const awaited = { ...signature, group: { ...signature.group, async: true } };
            return this.expressionTypes(path.get('argument'), awaited, context, inference);
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
                return argument ? this.expressionTypes(argument, signature, context, inference) : ['undefined'];
            }

            const declaredCall = this.methodCallType(path, signature, context);
            if(declaredCall !== UNKNOWN)
            {
                return [declaredCall];
            }

            return this.ambientCallTypes(path, signature, context, inference) || [UNKNOWN];
        }

        if(node.type === 'Identifier')
        {
            return this.identifierTypes(path, signature, context, inference);
        }

        return [UNKNOWN];
    },

    /** @description Infers unary results from their operand without visiting unrelated lexical bindings. */
    unaryTypes(path, signature, context, inference)
    {
        const operator = path.node.operator;
        const fixedTypes = { void: 'undefined', typeof: 'String', delete: 'Boolean', '!': 'Boolean', '+': 'Number' };
        if(Object.hasOwn(fixedTypes, operator))
        {
            return [fixedTypes[operator]];
        }

        const scope = context.bindings.scope(path);
        return this.expressionTypes(path.get('argument'), signature, context, inference).map(inferred =>
        {
            const type = Object.hasOwn(tsTypeMap, inferred) ? inferred : scope.get(inferred)?.keyword || inferred;
            const keyword = type === 'null' || type === 'undefined' ? 'Null' : type;
            return inferExpression(`${operator} operand`, new Map([[ 'operand', { keyword: keyword } ]]), new Map());
        });
    },

    /** @description Evaluates operator results from current operand values, not declaration labels. */
    operatorTypes(path, signature, context, inference)
    {
        const operator = path.isAssignmentExpression() ? path.node.operator.slice(0, -1) : path.node.operator;
        const left = this.expressionTypes(path.get('left'), signature, context, inference);
        const right = this.expressionTypes(path.get('right'), signature, context, inference);
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

    /** @description Recovers diagnosed rejected writes for ordinary diagnostics while retaining runtime values for strict return proof. */
    currentBindingTypes(point, signature, context, inference)
    {
        const { path, binding } = point;
        const declared = context.bindings.type(binding, signature);
        const offset = context.map.toSource(binding.identifier.start);
        const declaration = context.declarations.find(candidate => candidate.nameStart === offset);
        if(declaration?.kind === 'class' || declaration?.kind === 'enum')
        {
            return [declared];
        }

        if(elementTypeName(declared) !== null)
        {
            return [canonicalTypeName(declared)];
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

            const types = typeof origin === 'string' ? [origin] : this.expressionTypes(origin, signature, context, inference);
            const key = typeof origin === 'string' ? origin : origin.node;
            const rejected = !context.strictReturnProof && context.rejectedWrites?.get(binding)?.get(key);
            if(!rejected)
            {
                return types;
            }

            return types.map(type =>
            {
                if(rejected.has(type))
                {
                    return declared;
                }

                return type;
            });
        });

        if(declaration?.name === baseTypeName(declaration?.typeName) && declaration)
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

        if(signature.group.assignment && declaration && !Object.hasOwn(tsTypeMap, declaration.name))
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

    /** @description Resolves native member calls only for known, unchanged receiver types and supported overloads. */
    ambientCallTypes(path, signature, context, inference)
    {
        if(context.strictReturnProof)
        {
            return null;
        }

        const callee = path.get('callee');
        if(!callee.isMemberExpression() || callee.node.computed)
        {
            return null;
        }

        const receiver = callee.get('object');
        const binding = receiver.isIdentifier() && receiver.scope.getBinding(receiver.node.name);
        if(binding)
        {
            const owner = context.declarations.find(declaration => declaration.nameStart === context.map.toSource(binding.identifier.start));
            if(owner && context.bindings.methodChanged(owner, callee.node.property.name))
            {
                return null;
            }
        }

        const types = this.expressionTypes(receiver, signature, context, inference);
        if(types.length === 0 || types.some(type => type === UNKNOWN || type === 'null' || type === 'undefined'))
        {
            return null;
        }

        const result = [];
        const scope = context.bindings.scope(receiver);
        const argumentTypes = path.get('arguments').map(argument =>
        {
            if(argument.isRegExpLiteral())
            {
                return ['RegExp'];
            }

            return this.expressionTypes(argument, signature, context, inference).map(type => scope.get(type)?.ref || scope.get(type)?.keyword || type);
        });

        for(const inferred of types)
        {
            const type = scope.get(inferred)?.ref || scope.get(inferred)?.keyword || inferred;
            if(!context.bindings.nativeUnchanged(type))
            {
                return null;
            }

            const declared = binding && context.bindings.descriptor(binding);
            if(declared && ![ 'keyword', 'ambient' ].includes(declared.kind))
            {
                return null;
            }

            const returns = context.ambient.memberReturnTypes(type, callee.node.property.name, argumentTypes);
            if(!returns)
            {
                return null;
            }

            result.push(...returns);
        }

        return [...new Set(result)];
    },

    /** @description Resolves calls to annotated methods on the current or a directly bound object. */
    methodCallType(path, signature, context)
    {
        if(context.strictReturnProof)
        {
            return UNKNOWN;
        }

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
    identifierTypes(path, signature, context, inference)
    {
        const binding = path.scope.getBinding(path.node.name);
        if(!binding)
        {
            return [path.node.name === 'undefined' ? 'undefined' : UNKNOWN];
        }

        return this.currentBindingTypes({ path: path, binding: binding }, signature, context, inference);
    }
};

module.exports = LgdReturnChecker;
