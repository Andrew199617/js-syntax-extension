const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const LgdSourceMap = require('./LgdSourceMap');
const LgdReturnFlow = require('./LgdReturnFlow');
const { inferExpression, maskCode, UNKNOWN } = require('./LgdInfer');
const { tsTypeMap } = require('./LgdTypeMaps');

/** @description Checks explicit named return contracts against the mapped JavaScript function bodies. */
const LgdReturnChecker = {
    /** @description Collects annotated method signatures independently of parameter annotations. */
    signatures(declarations)
    {
        return declarations.flatMap(declaration => (declaration.methodTypedParams || [])
            .filter(group => group.returnTypeName)
            .map(group => ({ declaration: declaration, group: group })));
    },

    /** @description Validates explicit return annotations using syntax-aware function boundaries. */
    check(content, declarations, emitted)
    {
        const signatures = this.signatures(declarations);
        if(signatures.length === 0)
        {
            return [];
        }

        const map = LgdSourceMap.create(emitted.segments);
        const errors = [];
        const context = { content: content, declarations: declarations, code: emitted.code, map: map, errors: errors };
        const byBody = new Map(signatures.map(signature => [
            map.toOutput(signature.declaration.initializerStart + signature.group.bodyStart), signature
        ]));

        let tree;
        try
        {
            tree = parser.parse(emitted.code, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
        }
        catch(error)
        {
            const offset = map.toSource(error.pos || 0);
            return [{ offset: offset, message: `Cannot validate return annotations: ${error.message}` }];
        }

        traverse(tree, {
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
        return errors;
    },

    /** @description Validates one named method and its directly owned return statements. */
    checkFunction(path, signature, context)
    {
        const group = signature.group;
        const typeStart = signature.declaration.initializerStart + group.returnTypeStart;
        const typeEnd = signature.declaration.initializerStart + group.returnTypeEnd;
        function report(message)
        {
            context.errors.push({ offset: typeStart, endOffset: typeEnd, message: message });
        }

        if(group.accessor || group.generator)
        {
            report('Explicit return annotations on accessors and generators are not supported yet.');
            return;
        }

        const declared = group.returnTypeName;
        const root = declared.split('.')[0];
        const binding = path.scope.getBinding(root);
        const builtin = Object.hasOwn(tsTypeMap, declared) || declared === 'void';
        const nominal = context.declarations.some(declaration => declaration.name === declared);
        const external = declared.includes('.') && binding;
        const knownType = builtin || nominal || external;
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
                const argument = returned.get('argument');
                const types = argument.node ? this.expressionTypes(argument, signature, context) : ['undefined'];
                for(const type of new Set(types))
                {
                    if(!this.compatible(declared, type))
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
    compatible(declared, inferred)
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
        if(node.type === 'NullLiteral')
        {
            return ['null'];
        }

        if(node.type === 'NewExpression' || node.type === 'RegExpLiteral')
        {
            return ['Object'];
        }

        if(node.type === 'UnaryExpression' && node.operator === 'void')
        {
            return ['undefined'];
        }

        if(node.type === 'ConditionalExpression')
        {
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
            return this.expressionTypes(path.get('argument'), signature, context, visited);
        }

        if(node.type === 'CallExpression')
        {
            if(this.isPromiseResolve(path))
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
            const type = this.bindingType(binding, signature, context);
            if(type)
            {
                scope.set(name, { keyword: type });
            }
        }

        const expression = context.code.slice(node.start, node.end);
        const inferred = inferExpression(maskCode(expression, true), scope, new Map());
        return [scope.has(inferred) ? scope.get(inferred).keyword : inferred];
    },

    /** @description Resolves calls to annotated methods on the current or a directly bound object. */
    methodCallType(path, signature, context)
    {
        const callee = path.node.callee;
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
                const offset = context.map.toSource(binding.identifier.start);
                owner = context.declarations.find(declaration => declaration.nameStart === offset);
            }
        }

        if(!owner)
        {
            return UNKNOWN;
        }

        if(owner.kind === 'class' && callee.property.name === 'create')
        {
            return owner.name;
        }

        const method = (owner.methodTypedParams || []).find(group => group.name === callee.property.name && group.returnTypeName);
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
    isPromiseResolve(path)
    {
        const callee = path.node.callee;
        if(callee.type !== 'MemberExpression' || callee.computed || callee.object.type !== 'Identifier')
        {
            return false;
        }

        const nativePromise = callee.object.name === 'Promise' && !path.scope.getBinding('Promise');
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

        const declared = this.bindingType(binding, signature, context);
        if(declared)
        {
            return [declared];
        }

        if(binding.constant && binding.path.isVariableDeclarator() && binding.path.node.init && !visited.has(binding))
        {
            const next = new Set(visited);
            next.add(binding);
            return this.expressionTypes(binding.path.get('init'), signature, context, next);
        }

        return [UNKNOWN];
    },

    /** @description Maps local and parameter bindings to their explicit LGD types. */
    bindingType(binding, signature, context)
    {
        const offset = context.map.toSource(binding.identifier.start);
        const declaration = context.declarations.find(candidate => candidate.nameStart === offset);
        if(declaration)
        {
            return declaration.kind === 'class' ? declaration.name : declaration.typeName;
        }

        const group = signature.group;
        const relative = offset - signature.declaration.initializerStart;
        if(relative >= group.start && relative < group.end)
        {
            const parameter = group.params.find(candidate => candidate.name === binding.identifier.name);
            if(parameter && parameter.rest)
            {
                return 'Array';
            }

            return parameter ? parameter.typeName : null;
        }

        return null;
    }
};

module.exports = LgdReturnChecker;
