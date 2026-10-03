const traverse = require('@babel/traverse').default;
const LgdReturnChecker = require('./LgdReturnChecker');
const LgdTypeChecker = require('./LgdTypeChecker');
const { NULL } = require('./LgdInfer');
const { isNullableType } = require('./LgdTypeMaps');
const { skipTrivia } = require('./LgdMethodSignature');

/** @description Checks all writes against the annotation on their actual JavaScript lexical binding. */
const LgdAssignmentChecker = {
    /** @description Validates writes, parameter defaults, and current-value local initializers using one shared analysis. */
    check(context)
    {
        const errors = [];
        context.rejectedWrites = new Map();
        traverse(context.tree, {
            /** @description Checks every simple, compound, and destructuring assignment, including nested captures. */
            AssignmentExpression: path =>
            {
                const value = path.node.operator === '=' ? path.get('right') : path;
                this.checkTarget(path.get('left'), value, context, { errors: errors });
            },

            /** @description Checks numeric updates and readonly writes. */
            UpdateExpression: path => this.checkTarget(path.get('argument'), path, context, { errors: errors }),

            /** @description Checks readonly member targets in for-in and for-of assignments. */
            ForXStatement: path => this.checkTarget(path.get('left'), 'Unknown', context, { errors: errors }),

            /** @description Rejects deletion of known readonly fields without freezing their referenced values. */
            UnaryExpression: path =>
            {
                if(path.node.operator === 'delete')
                {
                    this.checkTarget(path.get('argument'), 'Unknown', context, { errors: errors, removing: true });
                }
            },

            /** @description Checks declared local values at their lexical program point. */
            VariableDeclarator: path =>
            {
                if(path.node.init)
                {
                    this.checkTarget(path.get('id'), path.get('init'), context, { errors: errors, initializing: true });
                }
            },

            /** @description Checks typed parameter defaults without treating them as outer assignments. */
            AssignmentPattern: path =>
            {
                const owner = path.findParent(parent => parent.isFunction());
                const inParams = owner?.node.params.some(parameter => parameter.start <= path.node.start && path.node.end <= parameter.end);
                if(inParams)
                {
                    this.checkTarget(path.get('left'), path.get('right'), context, { errors: errors, initializing: true });
                }
            }
        });
        errors.push(...context.members.checkFieldInitializers(context, (path, signature) => LgdReturnChecker.expressionTypes(path, signature, context)));
        return errors;
    },

    /** @description Projects known literal destructuring values and resolves simple targets through Babel scopes. */
    checkTarget(target, value, context, options)
    {
        const { errors, initializing = false } = options;
        if(target.isPattern() || target.isRestElement())
        {
            const origins = [value];
            const projected = context.flow.originsForTarget(target, origins);
            for(const entry of projected)
            {
                for(const origin of entry.origins)
                {
                    this.checkTarget(entry.target, origin, context, options);
                }
            }

            return;
        }

        if(target.isMemberExpression() || target.isOptionalMemberExpression())
        {
            this.checkMemberTarget(target, value, context, options);
            return;
        }

        if(!target.isIdentifier())
        {
            return;
        }

        const binding = target.scope.getBinding(target.node.name);
        if(binding?.kind === 'const' && !initializing)
        {
            errors.push({ offset: context.map.toSource(target.node.start), endOffset: context.map.toSource(target.node.end),
                message: `Cannot assign to const variable '${target.node.name}'.` });
            return;
        }

        const descriptor = binding && context.bindings.descriptor(binding);
        if(!descriptor)
        {
            return;
        }

        const bindingOffset = context.map.toSource(binding.identifier.start);
        const declaration = context.declarations.find(candidate => candidate.nameStart === bindingOffset);
        if(initializing && declaration?.kind === 'class')
        {
            return;
        }

        let reportNode = typeof value === 'string' ? target.node : value.node;
        if(typeof value !== 'string' && value.isAssignmentExpression())
        {
            reportNode = value.node.right;
        }

        if(descriptor.readonly && !initializing)
        {
            errors.push({ offset: context.map.toSource(target.node.start), endOffset: context.map.toSource(target.node.end),
                message: `Cannot assign to const variable '${target.node.name}'.` });
            return;
        }

        const signature = { declaration: {}, group: { params: [], async: false, assignment: true, returnTypeName: descriptor.typeName } };
        const scope = context.bindings.scope(target);
        const types = typeof value === 'string' ? [value] : LgdReturnChecker.expressionTypes(value, signature, context);
        for(const type of new Set(types))
        {
            // Preserve legacy undefined assignments while keeping explicit Type? contracts precise.
            const legacyUndefined = type === 'undefined' && !isNullableType(descriptor.typeName);
            const inferred = type === 'null' || legacyUndefined ? NULL : type;
            if(!LgdTypeChecker.isAssignableTo(descriptor, inferred, scope, context.externalsByName))
            {
                const keyword = descriptor.kind === 'keyword' && scope.get(type)?.kind === 'keyword';
                const display = keyword ? scope.get(type).keyword : type;
                const error = { offset: context.map.toSource(reportNode.start), endOffset: context.map.toSource(reportNode.end),
                    code: 'lgd.assignment.typeMismatch', message: `Cannot assign ${display} to ${descriptor.typeName}.` };
                const fix = this.parameterTypeFix(target, binding, context, { descriptor: descriptor, types: types, initializing: initializing });
                if(fix)
                {
                    error.quickFix = { ...fix, assignmentStart: error.offset, assignmentEnd: error.endOffset };
                }

                errors.push(error);
                this.recordRejectedWrite(binding, value, type, context);
            }
        }
    },

    /** @description Validates typed member writes through their resolved instance or static owner. */
    checkMemberTarget(target, value, context, options)
    {
        const resolved = context.members.resolve(target);
        if(!resolved?.valid || resolved.member.kind === 'method')
        {
            return;
        }

        const member = resolved.member;
        const expected = member.propertyTypeName || member.typeName;
        if(!expected)
        {
            return;
        }

        if(member.readonly && (options.removing || !context.members.canAssignReadonly(target, member)))
        {
            const initialization = member.static ? 'a static field initializer in the declaring type' : "its declaration or the declaring type's constructor";
            const message = options.removing
                ? `Cannot delete readonly field '${member.name}'.`
                : `Cannot assign to readonly field '${member.name}' outside ${initialization}.`;
            options.errors.push({ offset: context.map.toSource(target.node.start), endOffset: context.map.toSource(target.node.end),
                code: 'lgd.member.readonly', message: message });
            return;
        }

        const signature = { declaration: resolved.receiver.declaration, group: { params: [], async: false, assignment: true, returnTypeName: expected } };
        const types = typeof value === 'string' ? [value] : LgdReturnChecker.expressionTypes(value, signature, context);
        let reportNode = typeof value === 'string' ? target.node : value.node;
        if(typeof value !== 'string' && value.isAssignmentExpression())
        {
            reportNode = value.node.right;
        }

        for(const type of new Set(types))
        {
            const compatibility = context.members.memberTypeOptions(resolved, value);
            if(!context.members.compatible(expected, type, target, compatibility))
            {
                options.errors.push({ offset: context.map.toSource(reportNode.start), endOffset: context.map.toSource(reportNode.end),
                    code: 'lgd.assignment.typeMismatch', message: `Cannot assign ${type} to ${expected} member '${member.name}'.` });
            }
        }
    },

    /** @description Recovers only the exact incompatible value types whose writes retain a blocking diagnostic. */
    recordRejectedWrite(binding, value, type, context)
    {
        let origin = value;
        if(typeof value !== 'string' && value.isAssignmentExpression() && [ '&&=', '||=', '??=' ].includes(value.node.operator))
        {
            origin = value.get('right');
        }

        const key = typeof origin === 'string' ? origin : origin.node;
        let writes = context.rejectedWrites.get(binding);
        if(!writes)
        {
            writes = new Map();
            context.rejectedWrites.set(binding, writes);
        }

        const rejected = writes.get(key) || new Set();
        rejected.add(type);
        writes.set(key, rejected);
    },

    /** @description Identifies one explicit parameter annotation through its exact lexical binding and source spans. */
    parameterTypeFix(target, binding, context, options)
    {
        const { descriptor, types, initializing } = options;
        const owner = binding.scope.path;
        const assignment = target.parentPath;
        const simpleWrite = assignment.isAssignmentExpression({ operator: '=' }) && assignment.node.left === target.node;
        const ownParameter = binding.kind === 'param' && owner.isFunction() && target.getFunctionParent() === owner;
        const stringMismatch = descriptor.typeName === 'Number' && new Set(types).size === 1 && types[0] === 'String';
        const plainSingleParameter = owner.isFunction() && owner.node.params.length === 1 && owner.node.params[0] === binding.identifier;
        if(initializing || owner.node.id || !ownParameter || !simpleWrite || !stringMismatch || !plainSingleParameter)
        {
            return null;
        }

        const signature = { declaration: {}, group: { params: [], async: false, assignment: true, returnTypeName: descriptor.typeName } };
        for(const write of binding.constantViolations)
        {
            const directAssignment = write.isAssignmentExpression({ operator: '=' }) && write.get('left').isIdentifier({ name: binding.identifier.name });
            if(!directAssignment || write.getFunctionParent() !== owner)
            {
                return null;
            }

            const writtenTypes = LgdReturnChecker.expressionTypes(write.get('right'), signature, context);
            if(new Set(writtenTypes).size !== 1 || writtenTypes[0] !== 'String')
            {
                return null;
            }
        }

        const nameOffset = context.map.toSource(binding.identifier.start);
        for(const declaration of context.declarations)
        {
            const groups = [ ...declaration.typedParams ? [declaration.typedParams] : [], ...declaration.methodTypedParams || [] ];
            for(const group of groups)
            {
                if(group.params.length !== 1 || group.accessor || group.generator || group.abstract)
                {
                    continue;
                }

                const parameter = group.params[0];
                const offset = declaration.initializerStart + parameter.typeStart;
                const endOffset = declaration.initializerStart + parameter.typeEnd;
                const parameterOffset = skipTrivia(context.content, endOffset);
                const sameParameter = parameter.name === binding.identifier.name && parameterOffset === nameOffset;
                const plainNumber = parameter.typeName === 'Number' && !parameter.rest && parameter.defaultText === null;
                if(!sameParameter || !plainNumber || context.content.slice(offset, endOffset) !== 'Number')
                {
                    continue;
                }

                return { kind: 'changeParameterType', declarationStart: declaration.headStart, groupStart: group.start,
                    parameterName: parameter.name, parameterOffset: parameterOffset, offset: offset, endOffset: endOffset,
                    oldTypeName: 'Number', newTypeName: 'String' };
            }
        }

        return null;
    }
};

module.exports = LgdAssignmentChecker;
