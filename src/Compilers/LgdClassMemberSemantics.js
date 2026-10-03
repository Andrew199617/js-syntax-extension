const LgdConstructorSignatures = require('./LgdConstructorSignatures');
const LgdMemberTypeGraph = require('./LgdMemberTypeGraph');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { collectContractBindings } = require('./LgdContractBindings');
const { visibleBindings } = require('./LgdBaseChecker');
const { maskCode } = require('./LgdInfer');
const LgdClassMemberInference = require('./LgdClassMemberInference');
const { tsTypeMap, baseTypeName } = require('./LgdTypeMaps');
const LgdSourceMap = require('./LgdSourceMap');
const { skipTrivia } = require('./LgdMethodSignature');
const LgdInterfaceErasure = require('./LgdInterfaceErasure');

/** @description Shares lexical class member identities between emission, type checking, and editor metadata. */
const LgdClassMemberSemantics = {
    ...LgdClassMemberInference,

    /** @description Creates a source-aware member registry, optionally with mapped JavaScript paths. */
    create(context)
    {
        const registry = Object.create(this);
        registry._context = context;
        registry._bindings = collectContractBindings(context.content, context.declarations, context.externals || new Map());
        registry._tables = new Map();
        registry._memberTypes = new WeakMap();
        registry._declaringTypes = new WeakMap();
        registry._externalTypes = LgdMemberTypeGraph.imports(context.externals || new Map());
        registry._memberTypeOffsets = new WeakMap();
        return registry;
    },

    /** @description Describes own and inherited members without leaking parser offsets into export signatures. */
    describeMembers(content, declarations, declaration, externals = new Map())
    {
        return this.create({ content: content, declarations: declarations, externals: externals }).members(declaration);
    },

    /** @description Collects effective field and method metadata while stopping incomplete or cyclic ancestry. */
    members(declaration, visiting = new Set())
    {
        if(this._tables.has(declaration))
        {
            return this._tables.get(declaration);
        }

        if(visiting.has(declaration))
        {
            return [];
        }

        if(!this._context.declarations.includes(declaration))
        {
            return declaration.members || [];
        }

        const resolving = new Set(visiting);
        resolving.add(declaration);
        const inherited = declaration.baseName ? this.base(declaration) : null;
        const members = new Map((inherited ? this.members(inherited, resolving) : []).map(member => [ member.name, member ]));
        for(const member of declaration.classMembers || [])
        {
            if(member.isConstructor)
            {
                continue;
            }

            const previous = members.get(member.name);
            const valueType = member.propertyTypeName || member.returnTypeName || null;
            const initializer = Number.isInteger(member.initializerStart)
                ? this._context.content.slice(member.initializerStart, member.initializerEnd).trim()
                : null;
            const referenceDefault = ![ 'Number', 'Boolean', 'BigInt' ].includes(member.propertyTypeName);
            const defaultNull = member.kind === 'field' && (initializer === 'null' || initializer === null && referenceDefault);
            const description = {
                name: member.name, kind: member.kind, typeName: valueType,
                propertyTypeName: member.propertyTypeName || null, returnTypeName: member.returnTypeName || null,
                defaultNull: defaultNull, static: Boolean(member.static), readonly: Boolean(member.readonly), async: Boolean(member.async),
                accessor: Boolean(member.accessor), declaringType: declaration.name,
                accessibility: member.accessibility || 'public', explicitAccessibility: member.accessibilityStart !== null,
                getterAccessibility: member.getter ? member.getterAccessibility || member.accessibility : null,
                setterAccessibility: member.setter ? member.setterAccessibility || member.accessibility : null,
                declaringNameStart: declaration.nameStart, declaringProjectId: declaration.projectId || null,
                declaringSourcePath: declaration.sourcePath || null, nameStart: member.nameStart, nameEnd: member.nameEnd,
                params: (member.params || []).map(parameter => ({ name: parameter.name, typeName: parameter.typeName,
                    rest: Boolean(parameter.rest), optional: Boolean(parameter.optional), defaultText: parameter.defaultText ?? null }))
            };

            if(member.accessor && this._declaringTypes.get(previous) === declaration)
            {
                description.explicitAccessibility ||= previous.explicitAccessibility;
                description.getterAccessibility ||= previous.getterAccessibility;
                description.setterAccessibility ||= previous.setterAccessibility;
                description.typeName ||= previous.typeName;
                description.returnTypeName ||= previous.returnTypeName;
            }

            const memberType = valueType && this._type(valueType, declaration.headStart);
            const previousType = previous && this._memberTypes.get(previous);
            description.typeIdentity = LgdMemberTypeGraph.key(memberType || previousType);
            this._declaringTypes.set(description, declaration);
            this._memberTypes.set(description, memberType || previousType || null);
            this._memberTypeOffsets.set(description, declaration.headStart);
            members.set(member.name, description);
        }

        if(declaration.kind === 'class')
        {
            const factory = { name: 'create', kind: 'method', static: true, typeName: declaration.name,
                returnTypeName: declaration.name, declaringType: declaration.name, params: declaration.constructorMember?.params || [],
                accessibility: declaration.constructorMember?.accessibility || 'public',
                explicitAccessibility: Number.isInteger(declaration.constructorMember?.accessibilityStart),
                constructorSignatures: LgdConstructorSignatures.describeAll(declaration),
                declaringNameStart: declaration.nameStart, declaringSourcePath: declaration.sourceIdentityPath || declaration.sourcePath || null,
                declaringProjectId: declaration.projectId || null };
            this._declaringTypes.set(factory, declaration);
            members.set('create', factory);
        }

        const result = [...members.values()];
        this._tables.set(declaration, result);
        return result;
    },

    /** @description Resolves an immediate base using the declaration's own lexical source scope. */
    base(declaration)
    {
        if(!this._context.declarations.includes(declaration))
        {
            return null;
        }

        return visibleBindings(this._bindings, declaration.headStart ?? declaration.start).get(declaration.baseName) || null;
    },

    /** @description Rejects field collisions before either JavaScript object model is emitted. */
    checkDeclarations(content, declarations, externals = new Map())
    {
        const registry = this.create({ content: content, declarations: declarations, externals: externals });
        const errors = [];
        for(const declaration of declarations.filter(candidate => candidate.kind === 'class'))
        {
            const own = new Map();
            const base = declaration.baseName && registry.base(declaration);
            const inherited = base ? registry.members(base) : [];
            declaration.baseIsLgdClass = base?.kind === 'class';
            const ownFields = (declaration.classMembers || []).some(member => member.kind === 'field' && !member.static);
            const inheritedFields = inherited.some(member => member.kind === 'field' && !member.static);
            declaration.hasDeclaredInstanceFieldsInHierarchy = ownFields || inheritedFields;
            if(declaration.baseName && base?.kind !== 'class' && declaration.hasDeclaredInstanceFieldsInHierarchy)
            {
                errors.push({ offset: declaration.baseStart, endOffset: declaration.baseEnd, code: 'lgd.member.foreignBaseFields',
                    message: 'Declared instance fields require a known LGD class base; foreign or unresolved object factory initialization is not supported.' });
            }

            if(base?.kind === 'class' && registry._context.declarations.includes(base) && base.headStart > declaration.headStart)
            {
                errors.push({ offset: declaration.baseStart, endOffset: declaration.baseEnd, code: 'lgd.member.baseDeclarationOrder',
                    message: `Base class '${declaration.baseName}' must be declared before '${declaration.name}'.` });
            }

            for(const member of declaration.classMembers || [])
            {
                if(member.isConstructor)
                {
                    continue;
                }

                const fieldType = member.propertyTypeName;
                const visible = visibleBindings(registry._bindings, declaration.headStart);
                const unknownField = member.kind === 'field' && !Object.hasOwn(tsTypeMap, baseTypeName(fieldType)) && !visible.has(baseTypeName(fieldType).split('.')[0]);
                if(unknownField)
                {
                    const typeStart = declaration.initializerStart + member.propertyTypeStart;
                    errors.push({ offset: typeStart, endOffset: declaration.initializerStart + member.propertyTypeEnd,
                        code: 'lgd.member.unknownType', message: `Unknown field type '${fieldType}'.` });
                }

                if(member.kind === 'field' && [ declaration.name, 'create', 'constructor', '__proto__' ].includes(member.name))
                {
                    errors.push({ offset: member.nameStart, endOffset: member.nameEnd, code: 'lgd.member.reservedName',
                        message: `Field name '${member.name}' is reserved by the LGD class runtime.` });
                }

                const previous = own.get(member.name);
                const accessorPair = member.accessor && previous?.accessor && member.accessorKind !== previous.accessorKind && Boolean(member.static) === Boolean(previous.static);
                const ancestor = inherited.find(candidate => candidate.name === member.name);
                const fieldCollision = ancestor && (!member.static && member.kind === 'field' || !ancestor.static && ancestor.kind === 'field');
                if(previous && !accessorPair || fieldCollision)
                {
                    errors.push({ offset: member.nameStart, endOffset: member.nameEnd, code: 'lgd.member.collision',
                        message: `Member '${member.name}' conflicts with ${fieldCollision ? 'an inherited instance field or member' : 'another declaration in this class'}.` });
                }

                own.set(member.name, member);
            }
        }

        return errors;
    },

    _offset(path)
    {
        return this._context.map.toSource(path.node.start);
    },

    _type(name, offset, excluded = null)
    {
        const bindings = excluded ? this._bindings.filter(binding => binding.declaration !== excluded) : this._bindings;
        const declaration = visibleBindings(bindings, offset).get(baseTypeName(name));
        return declaration?.kind === 'class' ? declaration : null;
    },

    /** @description Finds the source class member that owns a mapped expression, including lexical arrows. */
    enclosing(path)
    {
        const offset = this._offset(path);
        let found = null;
        for(const declaration of this._context.declarations)
        {
            if(declaration.kind !== 'class' || offset < declaration.initializerStart || offset >= declaration.initializerEnd)
            {
                continue;
            }

            for(const member of declaration.classMembers || [])
            {
                if(member.start <= offset && offset < member.bodyEnd && (!found || member.start > found.member.start))
                {
                    found = { declaration: declaration, member: member };
                }
            }
        }

        if(!found)
        {
            return null;
        }

        for(let current = path.parentPath; current; current = current.parentPath)
        {
            const nativeField = current.isClassProperty() || current.isClassPrivateProperty();
            const inFieldValue = nativeField && current.node.value && current.node.value.start <= path.node.start;
            if(inFieldValue || current.isStaticBlock())
            {
                return null;
            }

            if(current.isFunction() && !current.isArrowFunctionExpression())
            {
                const bodyOffset = this._context.map.toSource(current.node.body.start);
                if(bodyOffset > found.member.bodyStart && bodyOffset < found.member.bodyEnd)
                {
                    return null;
                }

                break;
            }
        }

        return found;
    },

    /** @description Allows readonly initialization in the declaring instance constructor or static field initializer. */
    canAssignReadonly(path, member)
    {
        const owner = this.enclosing(path);
        if(!owner || this._declaringTypes.get(member) !== owner.declaration)
        {
            return false;
        }

        const offset = this._offset(path);
        if(owner.member.kind === 'field')
        {
            // Lowering assigns the initializer to its own field; source writes remain checked separately.
            if(offset === owner.member.nameStart && owner.member.name === member.name)
            {
                return true;
            }

            const callable = path.getFunctionParent();
            const bodyOffset = callable && this._context.map.toSource(callable.node.body.start);
            const nestedFunction = callable && owner.member.initializerStart <= bodyOffset && bodyOffset < owner.member.initializerEnd;
            return member.static && owner.member.static && !nestedFunction;
        }

        if(member.static || !owner.member.isConstructor || !path.get('object').isThisExpression() || offset <= owner.member.bodyStart)
        {
            return false;
        }

        const callable = path.getFunctionParent();
        const bodyOffset = callable && this._context.map.toSource(callable.node.body.start);
        return callable && owner.member.start <= bodyOffset && bodyOffset <= owner.member.bodyStart;
    },

    _bindingReceiver(binding, path, visited)
    {
        if(visited.has(binding))
        {
            return null;
        }

        const next = new Set(visited);
        next.add(binding);
        const offset = this._context.map.toSource(binding.identifier.start);
        const declaration = this._context.declarations.find(candidate => candidate.nameStart === offset);
        if(declaration?.kind === 'class')
        {
            return { declaration: declaration, kind: 'type', reference: binding.identifier.name };
        }

        const parameter = this._parameterType(binding, offset);
        const declaredType = declaration?.typeName || parameter?.typeName || this._context.bindings?.type(binding);
        const annotationOffset = parameter?.offset ?? declaration?.typeStart ?? this._offset(path);
        const type = declaredType && this._type(declaredType, annotationOffset, declaration);
        if(type)
        {
            return { declaration: type, kind: 'instance', reference: binding.identifier.name };
        }

        if(binding.constant && binding.path.isVariableDeclarator() && binding.path.node.init)
        {
            const initializer = binding.path.get('init');
            const receiver = this.receiver(initializer, next);
            return receiver?.kind === 'type' ? { ...receiver, reference: binding.identifier.name } : receiver;
        }

        const origins = this._context.flow?.origins(path, binding);
        const receivers = origins?.map(origin =>
        {
            if(typeof origin === 'string')
            {
                return null;
            }

            return this.receiver(origin, next);
        });

        const receiver = receivers?.[0];
        if(receiver && receivers.every(candidate => candidate?.declaration === receiver.declaration && candidate?.kind === receiver.kind))
        {
            return { ...receiver, reference: binding.identifier.name };
        }

        return null;
    },

    _parameterType(binding, offset)
    {
        if(binding.kind !== 'param')
        {
            return null;
        }

        for(const declaration of this._context.declarations)
        {
            const groups = [ declaration.typedParams, ...declaration.methodTypedParams || [] ].filter(Boolean);
            for(const group of groups)
            {
                const parameter = group.params.find(candidate =>
                {
                    const start = skipTrivia(this._context.content, declaration.initializerStart + candidate.typeEnd);
                    return candidate.name === binding.identifier.name && candidate.typeName && start === offset;
                });

                if(parameter)
                {
                    return { typeName: parameter.rest ? 'Array' : parameter.typeName, offset: declaration.initializerStart + group.start };
                }
            }
        }

        return null;
    },

    /** @description Resolves one fixed-name member access and retains invalid receiver-kind evidence for diagnostics. */
    resolve(path, visited = new Set())
    {
        const property = path.get('property');
        const name = path.node.computed ? this._constantMemberName(property) : property.node.name;
        if(typeof name !== 'string')
        {
            return null;
        }

        const receiver = this.receiver(path.get('object'), visited);
        const member = receiver && this.members(receiver.declaration).find(candidate => candidate.name === name);
        if(!member)
        {
            return null;
        }

        const valid = receiver.kind !== 'staticThis' && Boolean(member.static) === (receiver.kind === 'type');
        return { receiver: receiver, member: member, valid: valid };
    },

    _constantMemberName(path, visited = new Set())
    {
        if(path.isStringLiteral())
        {
            return path.node.value;
        }

        const binding = path.isIdentifier() && path.scope.getBinding(path.node.name);
        if(!binding?.constant || !binding.path.isVariableDeclarator() || !binding.path.node.init || visited.has(binding))
        {
            return null;
        }

        const next = new Set(visited);
        next.add(binding);
        return this._constantMemberName(binding.path.get('init'), next);
    },

    _isAssignmentTarget(path)
    {
        let current = path;
        for(let parent = current.parentPath; parent; parent = current.parentPath)
        {
            if(parent.isAssignmentExpression())
            {
                return parent.node.left === current.node;
            }

            if(parent.isForXStatement())
            {
                return parent.node.left === current.node;
            }

            if(parent.isUpdateExpression())
            {
                return true;
            }

            const valueProperty = parent.isObjectProperty() && current.key === 'value' && parent.parentPath.isObjectPattern();
            const defaultTarget = parent.isAssignmentPattern() && current.key === 'left';
            if(!valueProperty && !defaultTarget && !parent.isObjectPattern() && !parent.isArrayPattern() && !parent.isRestElement())
            {
                return false;
            }

            current = parent;
        }

        return false;
    },

    _hasDynamicScope()
    {
        if(this._dynamicScope !== undefined)
        {
            return this._dynamicScope;
        }

        this._dynamicScope = false;
        traverse(this._context.tree, {
            /** @description Rejects dynamically scoped with statements from automatic receiver fixes. */
            WithStatement: () => { this._dynamicScope = true; },

            /** @description Rejects evaluated code that can change class or instance identities. */
            Identifier: path =>
            {
                if([ 'eval', 'Function' ].includes(path.node.name) && path.isReferencedIdentifier())
                {
                    this._dynamicScope = true;
                }
            },

            /** @description Includes dynamic evaluators accessed through fixed-name properties. */
            MemberExpression: path =>
            {
                const property = path.node.property;
                const name = path.node.computed ? property.value : property.name;
                if([ 'eval', 'Function' ].includes(name))
                {
                    this._dynamicScope = true;
                }
            }
        });
        return this._dynamicScope;
    },

    _staticReceiverFix(path, resolved, error)
    {
        if(this._hasDynamicScope())
        {
            return null;
        }

        const object = path.get('object');
        const simple = object.isIdentifier() || object.isThisExpression();
        const owner = this.enclosing(object);
        const external = !this._context.declarations.includes(resolved.receiver.declaration);
        const incomplete = external && (resolved.receiver.declaration.methodsKnown === false || resolved.receiver.declaration.contractsKnown === false);
        const sourceInitializerThis = object.isThisExpression() && owner?.member.kind === 'field';
        if(!resolved.member.static || resolved.receiver.kind !== 'instance' || !simple || path.isOptionalMemberExpression() || incomplete || sourceInitializerThis)
        {
            return null;
        }

        const context = this._context;
        const offset = context.map.toSource(object.node.start);
        const endOffset = context.map.toSource(object.node.end);
        const receiverName = object.isIdentifier() ? object.node.name : 'this';
        if(context.content.slice(offset, endOffset) !== receiverName)
        {
            return null;
        }

        for(const [ name, binding ] of Object.entries(path.scope.getAllBindings()))
        {
            const candidate = this._bindingReceiver(binding, path, new Set());
            const nameStart = context.map.toSource(binding.identifier.start);
            const sourceBinding = context.content.slice(nameStart, nameStart + name.length) === name;
            if(sourceBinding && candidate?.kind === 'type' && candidate.declaration === resolved.receiver.declaration)
            {
                return { kind: 'useStaticTypeReceiver', offset: offset, endOffset: endOffset, receiverName: receiverName,
                    typeName: name, memberName: resolved.member.name, memberOffset: error.offset, memberEndOffset: error.endOffset };
            }
        }

        return null;
    },

    /** @description Reports invalid instance/static accesses, implicit instance references, and static this expressions. */
    check(context)
    {
        const errors = [];
        const reportAccess = path =>
        {
            const resolved = this.resolve(path);
            const parent = path.parentPath;
            const dispatch = parent.isCallExpression() && parent.node.arguments[1] === path.node && parent.get('callee').matchesPattern('Oloo.base');
            if(resolved && !resolved.valid && !dispatch && resolved.receiver.kind !== 'staticThis')
            {
                const kind = resolved.member.static ? 'Static' : 'Instance';
                const error = { offset: context.map.toSource(path.node.property.start), endOffset: context.map.toSource(path.node.property.end),
                    code: 'lgd.member.receiverKind', message: `${kind} member '${resolved.member.name}' requires ${resolved.member.static ? 'a type' : 'an instance'} receiver.` };
                const fix = this._staticReceiverFix(path, resolved, error);
                if(fix)
                {
                    error.quickFix = fix;
                }

                errors.push(error);
            }
        };

        traverse(context.tree, {
            MemberExpression: reportAccess,
            OptionalMemberExpression: reportAccess,

            /** @description Validates source-level this usage in static bodies and field initializers. */
            ThisExpression: path =>
            {
                const owner = this.enclosing(path);
                const offset = context.map.toSource(path.node.start);
                const sourceThis = context.content.slice(offset, offset + 'this'.length) === 'this';
                if(owner?.member.kind === 'field' && sourceThis)
                {
                    errors.push({ offset: offset, endOffset: offset + 'this'.length, code: 'lgd.member.fieldInitializerThis',
                        message: "A field initializer cannot use 'this'. Use a static member or an explicit other instance." });
                }
                else if(owner?.member.static && sourceThis)
                {
                    errors.push({ offset: context.map.toSource(path.node.start), endOffset: context.map.toSource(path.node.end),
                        code: 'lgd.member.staticThis', message: "A static member cannot use 'this'. Use an explicit instance reference." });
                }
            },

            /** @description Diagnoses unbound instance members in a static context. */
            Identifier: path =>
            {
                const assigned = this._isAssignmentTarget(path);
                if(!path.isReferencedIdentifier() && !assigned || path.scope.getBinding(path.node.name) || path.findParent(parent => parent.isWithStatement()))
                {
                    return;
                }

                const owner = this.enclosing(path);
                const member = owner && this.members(owner.declaration).find(candidate => candidate.name === path.node.name);
                if((owner?.member.static || owner?.member.kind === 'field') && member && !member.static)
                {
                    errors.push({ offset: context.map.toSource(path.node.start), endOffset: context.map.toSource(path.node.end),
                        code: owner.member.kind === 'field' ? 'lgd.member.fieldInitializerInstance' : 'lgd.member.staticInstance',
                        message: `${owner.member.kind === 'field' ? 'Field initializers' : 'Static members'} cannot implicitly access instance member '${member.name}'. Use an explicit instance reference.` });
                }
            }
        });
        return errors;
    },

    /** @description Checks each declared field initializer once against its typed member contract. */
    checkFieldInitializers(context, infer)
    {
        const fields = context.declarations.flatMap(declaration => (declaration.classMembers || [])
            .filter(member => member.kind === 'field' && Number.isInteger(member.initializerStart))
            .map(member => ({ declaration: declaration, member: member })));

        const checked = new Set();
        const errors = [];
        traverse(context.tree, {
            /** @description Locates the mapped top-level expression of a declared field initializer. */
            Expression: path =>
            {
                const start = context.map.toSource(path.node.start);
                const end = context.map.toSource(path.node.end);
                const field = fields.find(record =>
                {
                    const inRange = record.member.initializerStart <= start && end <= record.member.initializerEnd;
                    const leading = maskCode(context.content.slice(record.member.initializerStart, start), true);
                    const trailing = maskCode(context.content.slice(end, record.member.initializerEnd), true);
                    const wrapsExpression = (/^[\s(]*$/).test(leading) && (/^[\s)]*$/).test(trailing);
                    return !checked.has(record.member) && inRange && wrapsExpression;
                });

                if(!field)
                {
                    return;
                }

                checked.add(field.member);
                const expected = field.member.propertyTypeName;
                const signature = { declaration: field.declaration, group: { params: [], async: false, assignment: true, returnTypeName: expected } };
                for(const type of new Set(infer(path, signature)))
                {
                    if(!this.compatible(expected, type, path))
                    {
                        errors.push({ offset: start, endOffset: end, code: 'lgd.assignment.typeMismatch',
                            message: `Cannot assign ${type} to ${expected} member '${field.member.name}'.` });
                    }
                }
            }
        });
        return errors;
    },

    _declaringReference(resolved, path)
    {
        const { member, receiver } = resolved;
        if(this._declaresMember(receiver.declaration, member))
        {
            return receiver.reference;
        }

        for(const [ name, binding ] of Object.entries(path.scope.getAllBindings()))
        {
            const candidate = this._bindingReceiver(binding, path, new Set());
            const declaration = candidate?.declaration;
            if(candidate?.kind === 'type' && this._declaresMember(declaration, member))
            {
                return name;
            }
        }

        return receiver.reference;
    },

    _declaresMember(declaration, member)
    {
        const local = this._declaringTypes.get(member);
        if(local)
        {
            return declaration === local;
        }

        const sameName = (declaration.name || declaration.exportName) === member.declaringType;
        return sameName && (!member.declaringSourcePath || declaration.sourcePath === member.declaringSourcePath);
    },

    _needsRewrite(content, declarations, externals)
    {
        const registry = this.create({ content: content, declarations: declarations, externals: externals });
        const masked = maskCode(content, true);
        for(const declaration of declarations.filter(candidate => candidate.kind === 'class'))
        {
            const names = new Set(registry.members(declaration).map(member => member.name));
            for(const member of declaration.classMembers || [])
            {
                const start = member.kind === 'field' ? member.initializerStart : member.bodyStart + 1;
                const end = member.kind === 'field' ? member.initializerEnd : member.bodyEnd - 1;
                if(!Number.isInteger(start))
                {
                    continue;
                }

                const defaults = (member.params || []).map(parameter => maskCode(parameter.defaultText || '', true)).join('\n');
                const baseArguments = Number.isInteger(member.baseArgumentsStart) ? masked.slice(member.baseArgumentsStart, member.baseArgumentsEnd) : '';
                const body = [ masked.slice(start, end), defaults, baseArguments ].join('\n');
                for(const token of body.matchAll(/(?<![\w$.])(?<name>[$A-Z_a-z][\w$]*)/g))
                {
                    if(names.has(token.groups.name))
                    {
                        return true;
                    }
                }
            }
        }

        return false;
    },

    /** @description Rewrites implicit member references while preserving exact surrounding source mappings. */
    rewrite(emitted, content, declarations, externals = new Map())
    {
        if(!this._needsRewrite(content, declarations, externals))
        {
            return emitted;
        }

        let tree;
        try
        {
            tree = parser.parse(emitted.code, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
        }
        catch
        {
            return emitted;
        }

        const context = { content: content, declarations: declarations, externals: externals, tree: tree,
            map: LgdSourceMap.create(emitted.segments) };
        const registry = this.create(context);
        const edits = [];
        traverse(tree, {
            /** @description Rewrites only unbound references owned by a class member. */
            Identifier: path =>
            {
                const assignmentTarget = registry._isAssignmentTarget(path);
                if(!path.isReferencedIdentifier() && !assignmentTarget || path.scope.getBinding(path.node.name) || path.findParent(parent => parent.isWithStatement()))
                {
                    return;
                }

                const owner = registry.enclosing(path);
                const member = owner && registry.members(owner.declaration).find(candidate => candidate.name === path.node.name);
                const forbidsInstance = owner && (owner.member.static || owner.member.kind === 'field');
                if(!member || forbidsInstance && !member.static)
                {
                    return;
                }

                const resolved = { member: member, receiver: { declaration: owner.declaration, kind: 'type', reference: owner.declaration.runtimeClassName || owner.declaration.name } };
                const reference = member.static ? registry._declaringReference(resolved, path) : 'this';
                const property = path.parentPath.isAssignmentPattern() ? path.parentPath.parentPath : path.parentPath;
                if(property.isObjectProperty() && property.node.shorthand)
                {
                    edits.push({ start: path.node.start, end: path.node.end, text: `${path.node.name}: ${reference}.${member.name}` });
                }
                else
                {
                    edits.push({ start: path.node.start, end: path.node.end, text: `${reference}.${member.name}` });
                }
            }
        });
        const unique = new Map(edits.map(edit => [ `${edit.start}:${edit.end}`, edit ]));
        const segments = emitted.segments.map(segment => ({ ...segment }));
        const code = LgdInterfaceErasure.rewrite(emitted.code, segments, [...unique.values()]);
        return { code: code, segments: segments };
    }
};

module.exports = LgdClassMemberSemantics;
