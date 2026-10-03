const { maskCode } = require('./LgdInfer');
const { collectScopes, collectBindings, visibleBindings } = require('./LgdBaseChecker');
const { parseExpression } = require('@babel/parser');
const { typedParamGroups } = require('./LgdTypedParams');
const LgdObjectInheritance = require('./LgdObjectInheritance');

/** @description Shares proven legacy allocation recognition between diagnostics and manual migration actions. */
const LgdFactoryMigration = {
    /** @description Reads an offset-preserving JavaScript view while retaining every original LGD method body. */
    read(source, declaration, declarations)
    {
        try
        {
            const { object, start } = this._sourceView(source, declaration, declarations);
            const methods = object.properties;
            const ordinaryMethods = methods?.every(method =>
            {
                if(declaration.kind === 'class')
                {
                    return method.type === 'ClassMethod';
                }

                return this._ordinaryMethod(method);
            });

            if(!ordinaryMethods || !declaration.kind && object.type !== 'ObjectExpression')
            {
                return null;
            }

            const names = methods.map(method => method.key.name);
            if(!declaration.kind && (new Set(names).size !== names.length || names.includes('constructor')))
            {
                return null;
            }

            const reserved = methods.filter(method => [ 'create', 'constructor', declaration.name ].includes(method.key.name));
            if(reserved.length > 1)
            {
                return null;
            }

            const factory = reserved[0];
            const factoryMember = declaration.classMembers?.find(member => member.name === factory?.key.name);
            if(factoryMember && (factoryMember.modifierSpans.length > 0 || factoryMember.accessor || factoryMember.generator))
            {
                return null;
            }

            const header = this._headerShape(declaration, object, factory, start);
            if(!factory)
            {
                return header;
            }

            if(factory.async || factory.params.some(parameter => !this._simpleParameter(parameter)))
            {
                return null;
            }

            const root = this._rootFactory(factory, declaration, start, object.comments || []);
            if(root && this._globalRootAllocation(source, declaration, declarations, factory))
            {
                return { object: object, factory: factory, ...root, start: start };
            }

            const statements = factory.body.body;
            const local = statements[0]?.declarations?.[0];
            const directReturn = statements.length === 1 && statements[0].type === 'ReturnStatement';
            const call = directReturn ? statements[0].argument : local?.init;
            const baseCall = call?.arguments?.[0];
            const returned = statements[1]?.argument;
            const hasComments = object.comments?.some(comment => comment.start > factory.body.start && comment.end < factory.body.end);
            const allocation = statements.length === 2 && statements[0].type === 'VariableDeclaration' && statements[0].declarations.length === 1;
            const returnedLocal = local?.id?.type === 'Identifier' && returned?.type === 'Identifier' && returned.name === local.id.name;
            const returnsLocal = statements[1]?.type === 'ReturnStatement' && returnedLocal;
            const assignment = this._memberCall(call, 'Oloo', 'assign') && call.arguments.length === 2;
            const target = call?.arguments?.[1];
            const targetMatches = target?.type === 'Identifier' && target.name === declaration.name;
            const baseName = baseCall?.callee?.object?.name;
            const createsBase = typeof baseName === 'string' && this._memberCall(baseCall, baseName, 'create');
            const knownLifecycle = directReturn || allocation && returnsLocal;
            if(!knownLifecycle || !assignment || !targetMatches || !createsBase || hasComments || factory.body.directives.length > 0)
            {
                return header;
            }

            if(this._usesFactoryReceiver([ ...factory.params, ...baseCall.arguments ]))
            {
                return null;
            }

            return { object: object, factory: factory, baseCall: baseCall, baseName: baseCall.callee.object.name, start: start };
        }
        catch
        {
            return null;
        }
    },

    /** @description Builds one offset-preserving class or object view shared by lifecycle and base-dispatch checks. */
    _sourceView(source, declaration, declarations)
    {
        const start = declaration.initializerStart;
        let normalized = source.slice(start, declaration.initializerEnd);
        for(const child of declarations.slice().sort((left, right) => right.headStart - left.headStart))
        {
            if(child.headStart <= start || child.nameStart >= declaration.initializerEnd || child.kind)
            {
                continue;
            }

            const headStart = child.bindingStart ?? child.typeStart;
            const length = child.nameStart - headStart;
            if(length < 'let '.length)
            {
                return null;
            }

            normalized = normalized.slice(0, headStart - start) + 'let '.padEnd(length) + normalized.slice(child.nameStart - start);
        }

        normalized = this._eraseSignatureTypes(normalized, declaration, declarations);
        const prefix = declaration.kind === 'class' ? 'class _ ' : '';
        const parsed = parseExpression(prefix + normalized);
        const object = declaration.kind === 'class' ? { properties: parsed.body?.body, comments: parsed.comments } : parsed;
        return { object: object, start: start - prefix.length };
    },

    /** @description Proves that a class base initializes state without observing or escaping its changing receiver. */
    safeClassBase(source, declaration, declarations, shape)
    {
        if(declaration.baseName)
        {
            return false;
        }

        const childNames = new Set(shape.object.properties.map(member => member.key.name));
        const fields = declaration.classMembers.filter(member => member.kind === 'field' && !member.static);
        if(fields.some(field => childNames.has(field.name)))
        {
            return false;
        }

        try
        {
            const view = this._sourceView(source, declaration, declarations);
            const constructors = view.object.properties.filter(member => member.key.name === declaration.name);
            if(constructors.length > 1)
            {
                return false;
            }

            const constructor = constructors[0];
            if(!constructor)
            {
                return true;
            }

            if(this._usesFactoryReceiver(constructor.params))
            {
                return false;
            }

            return constructor.body.body.every(statement =>
            {
                if(statement.type === 'ReturnStatement' && !statement.argument)
                {
                    return true;
                }

                const assignment = statement.expression;
                const target = assignment?.left;
                const directAssignment = statement.type === 'ExpressionStatement' && assignment?.type === 'AssignmentExpression' && assignment.operator === '=';
                const directReceiver = target?.type === 'MemberExpression' && target.object.type === 'ThisExpression' && !target.computed;
                if(!directAssignment || !directReceiver || childNames.has(target.property.name))
                {
                    return false;
                }

                return !this._usesFactoryReceiver([assignment.right]);
            });
        }
        catch
        {
            return false;
        }
    },

    /** @description Requires the built-in root allocator rather than a local, parameter, or nested-scope replacement. */
    _globalRootAllocation(source, declaration, declarations, factory)
    {
        if(factory.params.some(parameter => this._containsName(parameter, 'Object')))
        {
            return false;
        }

        const masked = maskCode(source, true);
        const scopes = collectScopes(masked);
        if(scopes.some(scope => scope.start >= 0 && scope.start < declaration.headStart && declaration.headStart < scope.end))
        {
            return false;
        }

        const bindings = collectBindings({ content: source, masked: masked, declarations: declarations, scopes: scopes, externals: new Map() });
        const actual = bindings.filter(binding => !declarations.some(candidate =>
        {
            const typedHead = candidate.bindingStart <= binding.offset && binding.offset < candidate.nameStart;
            return candidate.name !== binding.name && typedHead;
        }));

        const destructured = (/\b(?:const|let|var)\s*[[{][^;=]*\bObject\b[^;=]*=/).test(masked.slice(0, declaration.headStart));
        return !destructured && !visibleBindings(actual, declaration.headStart).has('Object');
    },

    /** @description Keeps valid completed constructors intact when only their inheritance annotation needs migration. */
    _headerShape(declaration, object, factory, start)
    {
        if(declaration.kind !== 'class' || factory?.key.name === 'create' || !LgdObjectInheritance.tags(declaration)[0]?.baseTypeName)
        {
            return null;
        }

        const constructorNode = factory?.key.name === 'constructor' ? factory : null;
        return { object: object, factory: null, constructorNode: constructorNode, baseCall: null, baseName: null, start: start };
    },

    /** @description Rewrites only nonescaping root allocations with ordered direct property initializers. */
    _rootFactory(factory, declaration, start, comments)
    {
        if(declaration.kind !== 'class' || declaration.baseName || LgdObjectInheritance.tags(declaration).length > 0 || this._usesFactoryReceiver(factory.params))
        {
            return null;
        }

        const statements = factory.body.body;
        const allocation = statements[0];
        const local = allocation?.declarations?.[0];
        const returned = statements.at(-1);
        const directReturn = statements.length === 1 && allocation.type === 'ReturnStatement';
        const call = directReturn ? allocation.argument : local?.init;
        if(!this._memberCall(call, 'Object', 'create') || call.arguments.length !== 1 || call.arguments[0].type !== 'Identifier' || call.arguments[0].name !== declaration.name)
        {
            return null;
        }

        const removesComment = comments.some(comment => [ allocation, returned ].some(statement => statement.start <= comment.start && comment.end <= statement.end));
        if(removesComment)
        {
            return null;
        }

        if(directReturn)
        {
            return { rootFactory: true, initializationEdits: [{ start: start + allocation.start, end: start + allocation.end, text: '' }] };
        }

        const returnsLocal = returned?.type === 'ReturnStatement' && returned.argument?.type === 'Identifier' && returned.argument.name === local?.id?.name;
        if(statements.length < 2 || allocation.type !== 'VariableDeclaration' || allocation.declarations.length !== 1 || local.id.type !== 'Identifier' || !returnsLocal)
        {
            return null;
        }

        const edits = [ { start: start + allocation.start, end: start + allocation.end, text: '' },
            { start: start + returned.start, end: start + returned.end, text: '' } ];
        for(const statement of statements.slice(1, -1))
        {
            const assignment = statement.expression;
            const receiver = assignment?.left?.object;
            const directProperty = assignment?.left?.type === 'MemberExpression' && !assignment.left.computed && assignment.left.property.type === 'Identifier';
            const safeValue = !this._containsName(assignment?.right, local.id.name) && !this._usesFactoryReceiver([assignment?.right]);
            const simpleAssignment = statement.type === 'ExpressionStatement' && assignment?.type === 'AssignmentExpression' && assignment.operator === '=';
            const localReceiver = receiver?.type === 'Identifier' && receiver.name === local.id.name;
            if(!simpleAssignment || !directProperty || !localReceiver || !safeValue)
            {
                return null;
            }

            edits.push({ start: start + receiver.start, end: start + receiver.end, text: 'this' });
        }

        return { rootFactory: true, initializationEdits: edits };
    },

    /** @description Rejects an allocated alias anywhere in a value expression rather than guessing escape behavior. */
    _containsName(node, name)
    {
        if(!node || typeof node !== 'object')
        {
            return false;
        }

        return node.type === 'Identifier' && node.name === name || Object.values(node).flat().some(value => this._containsName(value, name));
    },

    /** @description Declines receiver-dependent arguments whose meaning would change from factory to instance initialization. */
    _usesFactoryReceiver(nodes)
    {
        return nodes.some(node =>
        {
            if(!node || typeof node !== 'object')
            {
                return false;
            }

            if([ 'ThisExpression', 'Super', 'MetaProperty', 'AwaitExpression', 'YieldExpression' ].includes(node.type))
            {
                return true;
            }

            return this._usesFactoryReceiver(Object.values(node).flat());
        });
    },

    /** @description Masks compiler-recognized LGD signature types without moving source offsets or changing the replacement. */
    _eraseSignatureTypes(normalized, declaration, declarations)
    {
        const ranges = [];
        for(const current of [ declaration, ...declarations.filter(candidate => candidate !== declaration) ])
        {
            const start = current.initializerStart - declaration.initializerStart;
            if(start < 0 || start >= normalized.length)
            {
                continue;
            }

            for(const member of current.classMembers || [])
            {
                if(member.kind === 'field' || member.abstract)
                {
                    ranges.push({ start: member.start - declaration.initializerStart, end: member.bodyEnd - declaration.initializerStart });
                    continue;
                }

                for(const span of member.modifierSpans || [])
                {
                    ranges.push({ start: span.start - declaration.initializerStart, end: span.end - declaration.initializerStart });
                }

                if(member.baseArgumentsStart !== null)
                {
                    ranges.push({ start: member.paramEnd - declaration.initializerStart, end: member.bodyStart - declaration.initializerStart });
                }
            }

            for(const group of typedParamGroups(current))
            {
                if(group.returnTypeName)
                {
                    ranges.push({ start: start + group.returnTypeStart, end: start + group.returnTypeEnd });
                }

                for(const parameter of group.params)
                {
                    if(parameter.typeName)
                    {
                        ranges.push({ start: start + parameter.typeStart, end: start + parameter.typeEnd });
                    }
                }
            }
        }

        for(const range of ranges)
        {
            const erased = normalized.slice(range.start, range.end).replace(/[^\n\r]/g, ' ');
            normalized = normalized.slice(0, range.start) + erased + normalized.slice(range.end);
        }

        return normalized;
    },

    /** @description Retains simple identifier, defaulted and rest parameters exactly in the generated constructor. */
    _simpleParameter(parameter)
    {
        if(parameter.type === 'Identifier')
        {
            return true;
        }

        if(parameter.type === 'AssignmentPattern')
        {
            return parameter.left.type === 'Identifier';
        }

        return parameter.type === 'RestElement' && parameter.argument.type === 'Identifier';
    },

    /** @description Recognizes an ordinary nonoptional call without computed member access. */
    _memberCall(call, owner, name)
    {
        if(call?.type !== 'CallExpression' || call.callee.type !== 'MemberExpression' || call.callee.computed)
        {
            return false;
        }

        const ownerMatches = call.callee.object.type === 'Identifier' && call.callee.object.name === owner;
        return ownerMatches && call.callee.property.type === 'Identifier' && call.callee.property.name === name;
    },

    /** @description Excludes accessors, computed names, generators and property initializers. */
    _ordinaryMethod(method)
    {
        const methodKind = method.kind === 'method' || method.type === 'ClassMethod' && method.kind === 'constructor';
        const ordinary = (method.type === 'ObjectMethod' || method.type === 'ClassMethod') && !method.computed && methodKind;
        return ordinary && !method.static && !method.generator && method.key.type === 'Identifier';
    }
};

module.exports = LgdFactoryMigration;
