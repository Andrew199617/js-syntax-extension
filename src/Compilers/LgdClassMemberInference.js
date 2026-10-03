const traverse = require('@babel/traverse').default;
const { UNKNOWN, maskCode } = require('./LgdInfer');
const { tsTypeMap } = require('./LgdTypeMaps');

/** @description Infers member values conservatively from shared class identities and mapped lexical effects. */
const LgdClassMemberInference = {
    /** @description Infers annotated fields, methods, and class construction without confusing type objects with instances. */
    expressionType(path, signature)
    {
        if(path.isThisExpression())
        {
            const receiver = this.receiver(path);
            return receiver?.kind === 'instance' ? receiver.declaration.name : null;
        }

        if(path.isNewExpression())
        {
            const receiver = this.receiver(path);
            return receiver ? this._nominalName(receiver) : null;
        }

        if(path.isMemberExpression() || path.isOptionalMemberExpression())
        {
            const resolved = this.resolve(path);
            if(resolved?.valid)
            {
                if(resolved.member.kind === 'method')
                {
                    return 'Function';
                }

                const defaultType = this._nullFieldType(resolved);
                if(defaultType)
                {
                    return defaultType;
                }

                return resolved.member.propertyTypeName || resolved.member.typeName || UNKNOWN;
            }
        }

        if(path.isCallExpression() || path.isOptionalCallExpression())
        {
            const callee = path.get('callee');
            if(callee.isMemberExpression() || callee.isOptionalMemberExpression())
            {
                const resolved = this.resolve(callee);
                if(resolved?.valid)
                {
                    if(this._methodChanged(resolved, callee))
                    {
                        return UNKNOWN;
                    }

                    if(resolved.member.async && !signature.group.async)
                    {
                        return 'Promise';
                    }

                    const type = resolved.member.name === 'create' ? this._nominalName(resolved.receiver) : resolved.member.returnTypeName;
                    return type === 'void' ? 'undefined' : type || UNKNOWN;
                }
            }
        }

        return null;
    },

    _methodChanged(resolved)
    {
        const context = this._context;
        const owner = this._methodIdentity(resolved);
        const receiverChanged = context.bindings?.methodChanged(resolved.receiver.declaration, resolved.member.name);
        if(receiverChanged || context.bindings?.methodChanged(owner, resolved.member.name))
        {
            return true;
        }

        if(!this._methodWrites && context.tree)
        {
            this._methodWrites = new Map();
            const record = assigned =>
            {
                const target = assigned.isAssignmentExpression() ? assigned.get('left') : assigned.get('argument');
                if(!target.isMemberExpression())
                {
                    return;
                }

                let access = this.resolve(target);
                if(!access && target.get('object').isMemberExpression())
                {
                    const prototype = target.get('object');
                    const type = this.receiver(prototype.get('object'));
                    const prototypeName = prototype.node.computed ? prototype.node.property.value : prototype.node.property.name;
                    const memberName = target.node.computed ? target.node.property.value : target.node.property.name;
                    const knownPrototype = type?.kind === 'type' && prototypeName === 'prototype';
                    const member = knownPrototype ? this.members(type.declaration).find(candidate => candidate.name === memberName && !candidate.static) : null;
                    if(member)
                    {
                        access = { receiver: { ...type, kind: 'instance' }, member: member, valid: true };
                    }
                }

                if(access?.valid && access.member.kind === 'method')
                {
                    const identity = this._methodIdentity(access);
                    const names = this._methodWrites.get(identity) || new Set();
                    names.add(access.member.name);
                    this._methodWrites.set(identity, names);
                }
            };

            traverse(context.tree, { AssignmentExpression: record, UpdateExpression: record });
        }

        return Boolean(this._methodWrites?.get(owner)?.has(resolved.member.name));
    },

    _methodIdentity(resolved)
    {
        let current = resolved.receiver.declaration;
        const visited = new Set();
        while(current && !visited.has(current) && this._context.declarations.includes(current))
        {
            if(current.name === resolved.member.declaringType)
            {
                return current;
            }

            visited.add(current);
            current = current.baseName && this.base(current);
        }

        this._externalMethodOwners ||= new Map();
        const path = resolved.member.declaringSourcePath || current?.sourcePath || '';
        const key = `${path}:${resolved.member.declaringType}`;
        if(!this._externalMethodOwners.has(key))
        {
            this._externalMethodOwners.set(key, {});
        }

        return this._externalMethodOwners.get(key);
    },

    _sourceCall(path)
    {
        const callee = path.node.callee;
        const property = callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression' ? callee.property : callee;
        const name = property.name || property.value;
        if(typeof name !== 'string')
        {
            return false;
        }

        const offset = this._context.map.toSource(property.start);
        const source = this._context.content;
        const raw = property.extra?.raw;
        const computed = raw && source.slice(offset, offset + raw.length) === raw;
        const direct = source.slice(offset, offset + name.length) === name || computed;
        const rewritten = source.slice(Math.max(0, offset - name.length), offset) === name && (/^\s*\(/).test(source.slice(offset));
        return direct || rewritten;
    },

    _documentEffects()
    {
        if(this._documentHasEffects !== undefined)
        {
            return this._documentHasEffects;
        }

        this._documentHasEffects = false;
        const inspect = path =>
        {
            if(!this._sourceCall(path))
            {
                return;
            }

            const callee = path.get('callee');
            const member = callee.isMemberExpression() || callee.isOptionalMemberExpression() ? this.resolve(callee) : null;
            const trusted = member?.valid && member.member.kind === 'method' && !this._methodChanged(member);
            if(!trusted)
            {
                this._documentHasEffects = true;
            }
        };

        traverse(this._context.tree, { CallExpression: inspect, OptionalCallExpression: inspect });
        return this._documentHasEffects;
    },

    _nominalName(receiver)
    {
        return this._context.declarations.includes(receiver.declaration) ? receiver.declaration.name : receiver.reference || receiver.declaration.exportName;
    },

    _sourceEffects(declaration, visiting = new Set())
    {
        if(visiting.has(declaration) || !this._context.declarations.includes(declaration))
        {
            return true;
        }

        const next = new Set(visiting);
        next.add(declaration);
        const masked = maskCode(this._context.content, true);
        for(const member of declaration.classMembers || [])
        {
            const start = member.kind === 'field' ? member.initializerStart : member.bodyStart + 1;
            const end = member.kind === 'field' ? member.initializerEnd : member.bodyEnd - 1;
            if(!Number.isInteger(start))
            {
                continue;
            }

            const body = masked.slice(start, end);
            for(const call of body.matchAll(/\b(?<callee>[$A-Z_a-z][\w$]*(?:\s*\.\s*[$A-Z_a-z][\w$]*)*)\s*\(/g))
            {
                if(![ 'if', 'while', 'switch', 'for', 'catch', 'with' ].includes(call.groups.callee))
                {
                    return true;
                }
            }
        }

        const base = declaration.baseName && this.base(declaration);
        return Boolean(base && this._sourceEffects(base, next));
    },

    _nullFieldType(resolved)
    {
        const member = resolved.member;
        if(!member.defaultNull || !this._context.declarations.includes(resolved.receiver.declaration))
        {
            return null;
        }

        if(this._sourceEffects(resolved.receiver.declaration) || this._documentEffects())
        {
            return UNKNOWN;
        }

        if(!this._writes)
        {
            this._writes = new Set();
            const recordWrite = path =>
            {
                const target = path.isAssignmentExpression() ? path.get('left') : path.get('argument');
                const targets = target.isPattern() ? this._context.flow.originsForTarget(target, ['Unknown']).map(entry => entry.target) : [target];
                for(const memberTarget of targets)
                {
                    if(!memberTarget.isMemberExpression())
                    {
                        continue;
                    }

                    const access = this.resolve(memberTarget);
                    const enclosing = this.enclosing(memberTarget);
                    const syntheticInitializer = enclosing?.member.kind === 'field' && enclosing.member.name === access?.member.name;
                    if(access?.valid && !syntheticInitializer)
                    {
                        this._writes.add(`${access.member.declaringType}:${access.member.name}`);
                    }
                }
            };

            traverse(this._context.tree, { AssignmentExpression: recordWrite, UpdateExpression: recordWrite });
        }

        return this._writes.has(`${member.declaringType}:${member.name}`) ? null : 'null';
    },

    /** @description Checks primitive and known nominal inheritance compatibility for member contracts. */
    compatible(expected, inferred, path, options = {})
    {
        const { nullable = true, typeOffset = null, expectedIdentity = null, inferredIdentity = null, unresolvedIdentity = false } = options;
        if(inferred === UNKNOWN || nullable && [ 'null', 'undefined' ].includes(inferred) || expected === 'Object' || expected === inferred)
        {
            return true;
        }

        if(expected.includes('.'))
        {
            return [ 'Object', 'Array', 'Function' ].includes(inferred);
        }

        const expectedType = expectedIdentity || !unresolvedIdentity && this._type(expected, typeOffset ?? this._offset(path));
        if(Object.hasOwn(tsTypeMap, expected))
        {
            return false;
        }

        if(!expectedType)
        {
            return ![ 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'null', 'undefined', 'void' ].includes(inferred);
        }

        let type = inferredIdentity || this._type(inferred, typeOffset ?? this._offset(path));
        if(!type && !Object.hasOwn(tsTypeMap, inferred) && ![ 'null', 'undefined', 'void' ].includes(inferred))
        {
            return true;
        }

        const visited = new Set();
        while(type && !visited.has(type))
        {
            const sameSource = type.sourcePath && expectedType.sourcePath && type.sourcePath === expectedType.sourcePath;
            const sameExport = sameSource && (type.name || type.exportName) === (expectedType.name || expectedType.exportName);
            if(type === expectedType || sameExport)
            {
                return true;
            }

            visited.add(type);
            const base = type.baseName && this.base(type);
            if(type.baseName && !base && !this._context.declarations.includes(type))
            {
                return true;
            }

            type = base;
        }

        return false;
    }
};

module.exports = LgdClassMemberInference;
