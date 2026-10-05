const LgdConstructorSignatures = require('./LgdConstructorSignatures');
const traverse = require('@babel/traverse').default;
const { visibleBindings } = require('./LgdBaseChecker');
const { rootTypeName } = require('./LgdTypeMaps');

/** @description Checks compile-time accessibility using source identities and the shared lexical member registry. */
const LgdAccessibility = {
    /** @description Preserves the existing public default for declarations without an explicit modifier. */
    visibility(declaration) { return declaration.accessibility || 'public'; },

    /** @description Carries stable source identities across imports without resolving names in a consumer scope. */
    identity(declaration)
    {
        return { name: declaration.name || declaration.exportName, sourcePath: declaration.sourceIdentityPath || declaration.sourcePath || null,
            nameStart: declaration.nameStart, projectId: declaration.projectId || null };
    },

    /** @description Compares actual declarations or canonical source locations, never class names alone. */
    sameType(left, right)
    {
        if(!left || !right)
        {
            return false;
        }

        const leftSource = left.sourceIdentityPath || left.sourcePath;
        const rightSource = right.sourceIdentityPath || right.sourcePath;
        const sameSource = leftSource && leftSource === rightSource;
        const samePosition = Number.isInteger(left.nameStart) && left.nameStart === right.nameStart;
        return left === right || Boolean(sameSource && samePosition);
    },

    /** @description Retains complete known ancestry when a class crosses a module boundary. */
    ancestry(declaration, registry, visited = new Set())
    {
        if(!declaration || visited.has(declaration))
        {
            return [];
        }

        if(!registry._context.declarations.includes(declaration))
        {
            return declaration.ancestry || [this.identity(declaration)];
        }

        const next = new Set(visited);
        next.add(declaration);
        const base = declaration.baseName && registry.base(declaration);
        return [ this.identity(declaration), ...this.ancestry(base, registry, next) ];
    },

    /** @description Tests nominal derivation without borrowing an imported base name from the caller. */
    derives(declaration, ancestor, registry, visited = new Set())
    {
        if(!declaration || visited.has(declaration))
        {
            return false;
        }

        if(this.sameType(declaration, ancestor))
        {
            return true;
        }

        if(!registry._context.declarations.includes(declaration))
        {
            return Boolean(declaration.ancestry?.some(candidate => this.sameType(candidate, ancestor)));
        }

        const next = new Set(visited);
        next.add(declaration);
        return this.derives(declaration.baseName && registry.base(declaration), ancestor, registry, next);
    },

    /** @description Finds lexical class privilege, including ordinary nested functions with explicit receivers. */
    lexicalOwner(offset, declarations)
    {
        const owners = declarations.filter(declaration =>
        {
            const contains = declaration.initializerStart < offset && offset < declaration.initializerEnd;
            return declaration.kind === 'class' && contains;
        });

        return owners.sort((left, right) => right.initializerStart - left.initializerStart)[0] || null;
    },

    /** @description Resolves the original member owner, preserving private ownership through inheritance. */
    memberOwner(member, registry)
    {
        const local = registry._declaringTypes.get(member);
        return local || { name: member.declaringType, sourcePath: member.declaringSourcePath, nameStart: member.declaringNameStart, projectId: member.declaringProjectId };
    },

    /** @description Enforces public, project-internal, lexical-private, and C#-style protected receiver access. */
    allowed(accessibility, owner, context)
    {
        const { registry, lexicalOwner, receiver, projectId, baseCall = false, isConstructor = false } = context;
        if(accessibility === 'public')
        {
            return true;
        }

        if(accessibility === 'internal')
        {
            return owner.projectId ? owner.projectId === projectId : registry._context.declarations.includes(owner);
        }

        if(this.sameType(lexicalOwner, owner))
        {
            return true;
        }

        if(accessibility !== 'protected' || !this.derives(lexicalOwner, owner, registry))
        {
            return false;
        }

        if(baseCall)
        {
            return true;
        }

        if(isConstructor)
        {
            return false;
        }

        return receiver?.kind === 'type' || this.derives(receiver?.declaration, lexicalOwner, registry);
    },

    /** @description Creates one token-sized visibility diagnostic for both source and imported declarations. */
    diagnostic(offset, endOffset, name, accessibility)
    {
        return { offset: offset, endOffset: endOffset, code: 'lgd.access.inaccessible',
            message: `'${name}' is ${accessibility} and is not accessible here.` };
    },

    /** @description Associates local declarations with their caller-established source and project identities. */
    prepareDeclarations(registry, options)
    {
        for(const declaration of registry._context.declarations)
        {
            declaration.sourceIdentityPath = options.sourcePath || null;
            declaration.projectId = options.projectId || null;
        }

        return this.checkDeclarations(registry);
    },

    /** @description Validates inherited construction, signature exposure, and source-level type use before emission. */
    checkDeclarations(registry)
    {
        const { declarations } = registry._context;
        const errors = [];
        for(const declaration of declarations)
        {
            if(![ 'class', 'interface' ].includes(declaration.kind))
            {
                continue;
            }

            const bindings = visibleBindings(registry._bindings, declaration.headStart);
            const base = declaration.baseName && bindings.get(declaration.baseName);
            const visibility = this.visibility(declaration);
            for(const heritage of declaration.heritage || [])
            {
                const inherited = bindings.get(heritage.name);
                if(!inherited)
                {
                    continue;
                }

                if(this.visibility(inherited) === 'internal' && inherited.projectId && inherited.projectId !== declaration.projectId)
                {
                    errors.push(this.diagnostic(heritage.start, heritage.end, heritage.name, 'internal'));
                }
                else if(visibility === 'public' && this.visibility(inherited) === 'internal' && (inherited.kind === 'class' || declaration.kind === 'interface'))
                {
                    errors.push({ offset: heritage.start, endOffset: heritage.end, code: 'lgd.access.signature',
                        message: `Public ${declaration.kind} '${declaration.name}' cannot inherit less accessible ${inherited.kind} '${heritage.name}'.` });
                }
            }

            if(declaration.kind === 'class' && base?.kind === 'class')
            {
                const constructors = declaration.constructorMembers?.length ? declaration.constructorMembers : [declaration.constructorMember];
                for(const constructor of constructors)
                {
                    const selected = LgdConstructorSignatures.selectBase(base, constructor, registry._context.content);
                    const access = selected?.accessibility;
                    const allowed = this.allowed(access, base, { registry: registry, lexicalOwner: declaration,
                        projectId: declaration.projectId, baseCall: true, isConstructor: true });
                    if(access && !allowed)
                    {
                        const start = constructor?.baseArgumentsStart ?? declaration.baseStart;
                        const end = constructor?.baseArgumentsEnd ?? declaration.baseEnd;
                        errors.push(this.diagnostic(start, end, `${declaration.baseName} constructor`, access));
                    }
                }
            }

            for(const member of declaration.classMembers || [])
            {
                const accessibility = this.visibility(member);
                if(accessibility === 'private' && (member.virtual || member.abstract || member.override))
                {
                    errors.push({ offset: member.accessibilityStart, endOffset: member.accessibilityEnd,
                        code: 'lgd.access.privateVirtual', message: 'A private member cannot be virtual, abstract, or override.' });
                }

                if(declaration.kind === 'interface' && accessibility !== 'public')
                {
                    errors.push({ offset: member.accessibilityStart, endOffset: member.accessibilityEnd,
                        code: 'lgd.access.interfaceMember', message: 'LGD interface contracts must be public.' });
                }

                const types = [];
                for(const parameter of member.params || [])
                {
                    if(parameter.typeName)
                    {
                        types.push({ name: parameter.typeName, start: parameter.typeStart, end: parameter.typeEnd });
                    }
                }

                if(member.propertyTypeName || member.returnTypeName)
                {
                    types.push({ name: member.propertyTypeName || member.returnTypeName,
                        start: member.propertyTypeStart ?? member.returnTypeStart, end: member.propertyTypeEnd ?? member.returnTypeEnd });
                }

                for(const type of types)
                {
                    const target = bindings.get(rootTypeName(type.name));
                    if(this.visibility(target || {}) !== 'internal')
                    {
                        continue;
                    }

                    const start = declaration.initializerStart + type.start;
                    const end = declaration.initializerStart + type.end;
                    if(target.projectId && target.projectId !== declaration.projectId)
                    {
                        errors.push(this.diagnostic(start, end, type.name, 'internal'));
                    }
                    else if(visibility === 'public' && [ 'public', 'protected' ].includes(accessibility))
                    {
                        errors.push({ offset: start, endOffset: end, code: 'lgd.access.signature',
                            message: `${accessibility} member '${member.name}' cannot expose internal type '${type.name}'.` });
                    }
                }
            }
        }

        return errors;
    },

    /** @description Checks mapped member reads, writes, constructor calls, and imported internal types. */
    check(context)
    {
        const registry = context.members;
        const errors = [];
        const projectId = context.projectId;
        const inspectMember = path =>
        {
            const resolved = registry.resolve(path);
            if(!resolved)
            {
                return;
            }

            const member = resolved.member;
            let offset = context.map.toSource(path.node.property.start);
            const endOffset = context.map.toSource(path.node.property.end);
            if(offset === endOffset && context.content.slice(offset - member.name.length, offset) === member.name)
            {
                offset -= member.name.length;
            }

            const lexicalOwner = this.lexicalOwner(offset, context.declarations);
            const parent = path.parentPath;
            const baseCall = parent.isCallExpression() && parent.get('callee').matchesPattern('Oloo.base') && parent.node.arguments[1] === path.node;
            if(!resolved.valid && !baseCall)
            {
                return;
            }

            const receiverType = resolved.receiver.declaration;
            const typeAccess = this.visibility(receiverType);
            if(!this.allowed(typeAccess, receiverType, { registry: registry, lexicalOwner: lexicalOwner, projectId: projectId }))
            {
                errors.push(this.diagnostic(offset, endOffset, receiverType.name || receiverType.exportName, typeAccess));
                return;
            }

            if(member.name === 'create' && LgdConstructorSignatures.get(receiverType).length > 1)
            {
                const accessible = LgdConstructorSignatures.get(receiverType).some(signature => this.allowed(
                    signature.accessibility, receiverType,
                    { registry: registry, lexicalOwner: lexicalOwner, receiver: resolved.receiver, projectId: projectId, isConstructor: true }
                ));

                if(!accessible)
                {
                    errors.push(this.diagnostic(offset, endOffset, `${receiverType.name || receiverType.exportName} constructor`, this.visibility(member)));
                }

                return;
            }

            const writing = registry._isAssignmentTarget(path);
            const reading = !writing || parent.isUpdateExpression() || parent.isAssignmentExpression() && parent.node.operator !== '=';
            const accesses = [];
            if(member.accessor)
            {
                if(reading)
                {
                    accesses.push(member.getterAccessibility || this.visibility(member));
                }

                if(writing)
                {
                    accesses.push(member.setterAccessibility || this.visibility(member));
                }
            }
            else
            {
                accesses.push(this.visibility(member));
            }

            for(const accessibility of new Set(accesses))
            {
                const owner = this.memberOwner(member, registry);
                if(!this.allowed(accessibility, owner, { registry: registry, lexicalOwner: lexicalOwner,
                    receiver: resolved.receiver, projectId: projectId, baseCall: baseCall, isConstructor: member.name === 'create' }))
                {
                    errors.push(this.diagnostic(offset, endOffset, member.name === 'create' ? `${member.declaringType} constructor` : member.name, accessibility));
                }
            }
        };

        const inspectPattern = (pattern, receiver) =>
        {
            if(!pattern.isObjectPattern() || !receiver)
            {
                return;
            }

            for(const property of pattern.get('properties'))
            {
                if(!property.isObjectProperty())
                {
                    continue;
                }

                const key = property.get('key');
                const name = property.node.computed ? registry._constantMemberName(key) : key.node.name || key.node.value;
                const member = registry.members(receiver.declaration).find(candidate => candidate.name === name);
                if(!member || Boolean(member.static) !== (receiver.kind === 'type'))
                {
                    continue;
                }

                const offset = context.map.toSource(key.node.start);
                const endOffset = context.map.toSource(key.node.end);
                const accessibility = member.getterAccessibility || this.visibility(member);
                const owner = this.memberOwner(member, registry);
                const lexicalOwner = this.lexicalOwner(offset, context.declarations);
                if(!this.allowed(accessibility, owner, { registry: registry, lexicalOwner: lexicalOwner, receiver: receiver, projectId: projectId, isConstructor: member.name === 'create' }))
                {
                    errors.push(this.diagnostic(offset, endOffset, name, accessibility));
                }

                const type = registry.memberType({ member: member, receiver: receiver });
                inspectPattern(property.get('value'), type ? { declaration: type, kind: 'instance' } : null);
            }
        };

        traverse(context.tree, {
            MemberExpression: inspectMember,
            OptionalMemberExpression: inspectMember,

            /** @description Applies the same read checks to named destructuring projections. */
            VariableDeclarator: path =>
            {
                if(path.node.init)
                {
                    inspectPattern(path.get('id'), registry.receiver(path.get('init')));
                }
            },

            AssignmentExpression: path => inspectPattern(path.get('left'), registry.receiver(path.get('right'))),

            /** @description Checks direct native construction independently from the source factory syntax. */
            NewExpression: path =>
            {
                const sourceStart = context.map.toSource(path.node.start);
                if(context.content.slice(sourceStart, sourceStart + 'new'.length) !== 'new')
                {
                    return;
                }

                const receiver = registry.receiver(path.get('callee'));
                if(receiver?.kind !== 'type')
                {
                    return;
                }

                const owner = receiver.declaration;
                if(LgdConstructorSignatures.get(owner).length > 1)
                {
                    return;
                }

                const accessibility = owner.constructorAccessibility || this.visibility(owner.constructorMember || {});
                const offset = context.map.toSource(path.node.callee.start);
                const endOffset = context.map.toSource(path.node.callee.end);
                const lexicalOwner = this.lexicalOwner(offset, context.declarations);
                if(!this.allowed(accessibility, owner, { registry: registry, lexicalOwner: lexicalOwner,
                    receiver: receiver, projectId: projectId, isConstructor: true }))
                {
                    errors.push(this.diagnostic(offset, endOffset, `${owner.name || owner.exportName} constructor`, accessibility));
                }
            },

            /** @description Rejects importing an internal type from a different declared compilation project. */
            CallExpression: path =>
            {
                if(!path.get('callee').isIdentifier({ name: 'require' }) || path.scope.getBinding('require'))
                {
                    return;
                }

                const argument = path.node.arguments[0];
                const external = argument?.type === 'StringLiteral' && context.externals.get(argument.value);
                if(external && this.visibility(external) === 'internal' && (!external.projectId || external.projectId !== projectId))
                {
                    errors.push(this.diagnostic(context.map.toSource(argument.start), context.map.toSource(argument.end), external.exportName, 'internal'));
                }
            }
        });
        return errors;
    }
};

module.exports = LgdAccessibility;
