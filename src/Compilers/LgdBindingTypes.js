const traverse = require('@babel/traverse').default;
const { tsTypeMap } = require('./LgdTypeMaps');
const { UNKNOWN } = require('./LgdInfer');
const { skipTrivia } = require('./LgdMethodSignature');

/** @description Resolves declared types and method identities through actual JavaScript lexical bindings. */
const LgdBindingTypes = {
    /** @description Builds a registry for one mapped JavaScript analysis. */
    create(context)
    {
        const registry = Object.create(this);
        registry._context = context;
        registry._entries = new WeakMap();
        registry._changedMethods = new Map();
        traverse(context.tree, {
            AssignmentExpression: path => registry.recordMutation(path.get('left')),
            UpdateExpression: path => registry.recordMutation(path.get('argument'))
        });
        return registry;
    },

    /** @description Reports whether a known method property can be overwritten anywhere in its owning scope. */
    methodChanged(owner, name)
    {
        const changed = this._changedMethods.get(owner);
        return Boolean(changed?.has(name) || changed?.has('*'));
    },

    /** @description Records writes to known method properties without assuming immutable object identity. */
    recordMutation(target)
    {
        const context = this._context;
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
        const empty = { declaration: {}, group: { inherited: false } };
        const type = this.type(binding, empty);
        if(!type)
        {
            return null;
        }

        const offset = context.map.toSource(binding.identifier.start);
        const declaration = context.declarations.find(candidate => candidate.nameStart === offset);
        const descriptor = { keyword: UNKNOWN, readonly: Boolean(declaration?.readonly), kind: 'unknown', typeName: type, ref: null };
        this._entries.set(binding, descriptor);
        if(Object.hasOwn(tsTypeMap, type))
        {
            descriptor.kind = 'keyword';
            descriptor.keyword = type;
        }
        else if(declaration?.kind === 'class' || declaration?.name === declaration?.typeName && declaration)
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
            const typeBinding = binding.scope.getBinding(type);
            const target = typeBinding && this.descriptor(typeBinding);
            if(target)
            {
                descriptor.kind = 'nominal';
                descriptor.keyword = target.keyword;
                descriptor.ref = type;
            }
        }

        return descriptor;
    },

    /** @description Resolves nominal assignment tokens only through currently visible lexical bindings. */
    scope(path)
    {
        const context = this._context;
        const scope = new Map(context.externalsByName);
        for(const [ name, binding ] of Object.entries(path.scope.getAllBindings()))
        {
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
