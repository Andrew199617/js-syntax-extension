const LgdEnumSyntax = require('./LgdEnumSyntax');
const traverse = require('@babel/traverse').default;
const { tsTypeMap, baseTypeName } = require('./LgdTypeMaps');
const { UNKNOWN } = require('./LgdInfer');
const { skipTrivia } = require('./LgdMethodSignature');
const { collectContractBindings } = require('./LgdContractBindings');
const { visibleBindings } = require('./LgdBaseChecker');

/** @description Native objects whose known behavior is used by expression inference. */
const inferredNatives = [ 'Array', 'Function', 'Promise' ];

/** @description Unshadowed global namespaces can expose those same native objects. */
const globalNamespaces = [ 'globalThis', 'global', 'window', 'self' ];

/** @description Resolves declared types and method identities through actual JavaScript lexical bindings. */
const LgdBindingTypes = {
    /** @description Builds a registry for one mapped JavaScript analysis. */
    create(context)
    {
        const registry = Object.create(this);
        registry._context = context;
        registry._entries = new WeakMap();
        registry._changedMethods = new Map();
        registry._changedNatives = new Set();
        traverse(context.tree, {
            AssignmentExpression: path => registry.recordMutation(path.get('left')),
            UpdateExpression: path => registry.recordMutation(path.get('argument')),
            CallExpression: path => registry.recordNativeArguments(path.get('arguments')),
            OptionalCallExpression: path => registry.recordNativeArguments(path.get('arguments')),
            TaggedTemplateExpression: path => registry.recordNativeArguments(path.get('quasi').get('expressions')),
            NewExpression: path => registry.recordNativeArguments(path.get('arguments'))
        });
        return registry;
    },

    /** @description Reports whether a known method property can be overwritten anywhere in its owning scope. */
    methodChanged(owner, name)
    {
        const changed = this._changedMethods.get(owner);
        return Boolean(changed?.has(name) || changed?.has('*'));
    },

    /** @description Resolves erased interface names through the existing compile-time lexical binding table. */
    erasedType(name, offset)
    {
        if(!this._sourceBindings)
        {
            const context = this._context;
            this._sourceBindings = collectContractBindings(context.content, context.declarations, context.externals);
        }

        const declaration = visibleBindings(this._sourceBindings, offset).get(name);
        const interfaceType = declaration?.kind === 'interface' || declaration?.contractKind === 'interface';
        return interfaceType ? declaration : null;
    },

    /** @description Retains native behavior only when no explicit mutation or escape can invalidate it. */
    nativeUnchanged(name)
    {
        return !this._changedNatives.has(name);
    },

    /** @description Passing a native object to an unknown call can allow its behavior to change. */
    recordNativeArguments(argumentsPaths)
    {
        for(const argument of argumentsPaths)
        {
            this._recordNative(this._nativeReference(argument));
        }
    },

    _recordNative(name)
    {
        if(inferredNatives.includes(name))
        {
            this._changedNatives.add(name);
        }
        else if(globalNamespaces.includes(name) || name === '*')
        {
            for(const native of inferredNatives)
            {
                this._changedNatives.add(native);
            }
        }
    },

    _nativeReference(path, visited = new Set())
    {
        if(path.isMemberExpression() || path.isOptionalMemberExpression())
        {
            const receiver = this._nativeReference(path.get('object'), visited);
            if(!globalNamespaces.includes(receiver))
            {
                return receiver;
            }

            const property = path.node.property;
            const name = path.node.computed ? property.value : property.name;
            if(name === undefined)
            {
                return '*';
            }

            return inferredNatives.includes(name) ? name : null;
        }

        if(!path.isIdentifier())
        {
            return null;
        }

        const binding = path.scope.getBinding(path.node.name);
        if(!binding)
        {
            return inferredNatives.includes(path.node.name) || globalNamespaces.includes(path.node.name) ? path.node.name : null;
        }

        if(binding.constant && binding.path.isVariableDeclarator() && binding.path.node.init && !visited.has(binding))
        {
            const next = new Set(visited);
            next.add(binding);
            return this._nativeReference(binding.path.get('init'), next);
        }

        return null;
    },

    /** @description Records writes to known method properties without assuming immutable object identity. */
    recordMutation(target)
    {
        const context = this._context;
        this._recordNative(this._nativeReference(target));
        if(!target.isMemberExpression() && !target.isOptionalMemberExpression())
        {
            return;
        }

        const receiver = target.get('object');
        let owner;
        if(receiver.isIdentifier())
        {
            const binding = receiver.scope.getBinding(receiver.node.name);
            const offset = binding && context.map.toSource(binding.identifier.start);
            owner = context.declarations.find(declaration => declaration.nameStart === offset);
        }
        else if(receiver.isThisExpression())
        {
            const offset = context.map.toSource(receiver.node.start);
            const owners = context.declarations.filter(declaration => declaration.initializerStart < offset && offset < declaration.initializerEnd);
            owner = owners.sort((left, right) => right.initializerStart - left.initializerStart)[0];
        }

        if(owner)
        {
            const names = this._changedMethods.get(owner) || new Set();
            const property = target.node.property;
            const name = target.node.computed ? property.value : property.name;
            names.add(name || '*');
            this._changedMethods.set(owner, names);
        }
    },

    /** @description Resolves a lexical binding's explicit assignment contract without confusing namesakes. */
    descriptor(binding)
    {
        if(this._entries.has(binding))
        {
            return this._entries.get(binding);
        }

        const context = this._context;
        const enumDeclaration = binding.path.isVariableDeclarator() && LgdEnumSyntax.receiver(binding.path.get('id'), context);
        if(enumDeclaration)
        {
            const entry = { keyword: enumDeclaration.enumValueType || 'Object', kind: 'keyword', typeName: 'Object',
                readonly: true, ref: null, enumIdentity: enumDeclaration.name };
            this._entries.set(binding, entry);
            return entry;
        }

        const empty = { declaration: {}, group: { inherited: false } };
        const importedClass = this._importedClass(binding);
        const type = importedClass ? binding.identifier.name : this.type(binding, empty);
        if(!type)
        {
            return null;
        }

        const offset = context.map.toSource(binding.identifier.start);
        const declaration = context.declarations.find(candidate => candidate.nameStart === offset);
        const baseType = baseTypeName(type);
        const descriptor = { keyword: UNKNOWN, readonly: Boolean(declaration?.readonly), kind: 'unknown', typeName: type, ref: null };
        this._entries.set(binding, descriptor);
        if(Object.hasOwn(tsTypeMap, baseType) && !importedClass && declaration?.kind !== 'class')
        {
            descriptor.kind = 'keyword';
            descriptor.keyword = baseType;
        }
        else if(importedClass || declaration?.kind === 'class' || declaration?.name === baseTypeName(declaration?.typeName) && declaration)
        {
            descriptor.kind = 'self';
            descriptor.keyword = 'Object';
        }
        else if(type.includes('.'))
        {
            descriptor.kind = 'opaque';
            descriptor.keyword = 'Object';
        }
        else
        {
            const typeScope = binding.kind === 'param' ? binding.scope.parent : binding.scope;
            const typeBinding = typeScope?.getBinding(baseType);
            const target = typeBinding && this.descriptor(typeBinding);
            if(target)
            {
                descriptor.kind = 'nominal';
                descriptor.keyword = target.keyword;
                descriptor.ref = target.enumIdentity || baseType;
            }
        }

        return descriptor;
    },

    _importedClass(binding)
    {
        if(!binding.constant || !binding.path.isVariableDeclarator())
        {
            return null;
        }

        const initializer = binding.path.node.init;
        const callee = initializer?.callee;
        const directRequire = initializer?.type === 'CallExpression' && callee.type === 'Identifier' && callee.name === 'require';
        if(!directRequire || binding.path.scope.getBinding('require'))
        {
            return null;
        }

        const specifier = initializer.arguments[0];
        const external = specifier?.type === 'StringLiteral' && this._context.externals.get(specifier.value);
        return external?.kind === 'class' ? external : null;
    },

    /** @description Resolves nominal assignment tokens only through currently visible lexical bindings. */
    scope(path)
    {
        const context = this._context;
        const scope = new Map(context.externalsByName);
        for(const [ name, binding ] of Object.entries(path.scope.getAllBindings()))
        {
            if(Object.hasOwn(tsTypeMap, name))
            {
                continue;
            }

            const entry = this.descriptor(binding);
            if(entry)
            {
                scope.set(name, entry);
            }
        }

        return scope;
    },

    /** @description Maps local and parameter bindings to their explicit LGD types. */
    type(binding, signature = { declaration: {}, group: { inherited: false } })
    {
        const context = this._context;
        const offset = context.map.toSource(binding.identifier.start);
        const declaration = context.declarations.find(candidate => candidate.nameStart === offset);
        if(declaration)
        {
            return declaration.kind === 'class' ? declaration.name : declaration.typeName;
        }

        const groups = context.declarations.flatMap(owner =>
        {
            const parameters = owner.typedParams ? [owner.typedParams] : [];
            return [ ...parameters, ...owner.methodTypedParams || [] ].map(group => ({ owner: owner, group: group }));
        });

        for(const record of groups)
        {
            const relative = offset - record.owner.initializerStart;
            const group = record.group;
            if(binding.kind === 'param' && relative >= group.start && relative < group.end)
            {
                const parameter = group.params.find(candidate =>
                {
                    if(!candidate.typeName || candidate.name !== binding.identifier.name)
                    {
                        return false;
                    }

                    const nameStart = skipTrivia(context.content, record.owner.initializerStart + candidate.typeEnd);
                    return nameStart === offset;
                });

                if(parameter)
                {
                    return parameter.rest ? 'Array' : parameter.typeName;
                }
            }
        }

        if(!signature.group.inherited || binding.kind !== 'param')
        {
            return null;
        }

        const parameter = signature.group.params.find(candidate => candidate.name === binding.identifier.name);
        const bodyStart = context.map.toOutput(signature.declaration.initializerStart + signature.group.bodyStart);
        if(parameter?.typeStart === -1 && binding.scope.path.node.body.start === bodyStart)
        {
            return parameter.rest ? 'Array' : parameter.typeName;
        }

        return null;
    }
};

module.exports = LgdBindingTypes;
