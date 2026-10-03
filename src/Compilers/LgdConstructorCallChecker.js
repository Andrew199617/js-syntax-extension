const traverse = require('@babel/traverse').default;
const LgdConstructorSignatures = require('./LgdConstructorSignatures');
const LgdReturnChecker = require('./LgdReturnChecker');
const LgdAccessibility = require('./LgdAccessibility');

/** @description Checks overload calls through lexical class/factory identities using shared expression inference. */
const LgdConstructorCallChecker = {
    /** @description Resolves direct factories and unchanged local aliases without guessing dynamic properties. */
    factory(path, context, visited = new Set())
    {
        if(path.isMemberExpression() || path.isOptionalMemberExpression())
        {
            const resolved = context.members.resolve(path);
            return resolved?.valid && resolved.member.name === 'create' && resolved.receiver.kind === 'type' ? resolved.receiver : null;
        }

        const binding = path.isIdentifier() && path.scope.getBinding(path.node.name);
        if(!binding?.constant || !binding.path.isVariableDeclarator() || !binding.path.node.init || visited.has(binding))
        {
            return null;
        }

        const next = new Set(visited);
        next.add(binding);
        return this.factory(binding.path.get('init'), context, next);
    },

    /** @description Reports count, type, and per-overload accessibility problems only for known overloaded classes. */
    check(context)
    {
        const errors = [];
        const inspect = path =>
        {
            const offset = context.map.toSource(path.node.start);
            const source = context.content.slice(offset, context.map.toSource(path.node.end));
            if(path.isNewExpression() && !source.startsWith('new'))
            {
                return;
            }

            const receiver = path.isNewExpression() ? context.members.receiver(path.get('callee')) : this.factory(path.get('callee'), context);
            if(receiver?.kind !== 'type' || receiver.declaration.kind !== 'class')
            {
                return;
            }

            const declaration = receiver.declaration;
            const signatures = LgdConstructorSignatures.get(declaration);
            if(signatures.length < 2 || path.node.arguments.some(argument => argument.type === 'SpreadElement'))
            {
                return;
            }

            const selected = LgdConstructorSignatures.select(declaration, path.node.arguments.length);
            const name = declaration.name || declaration.exportName;
            const endOffset = context.map.toSource(path.node.callee.end);
            if(!selected)
            {
                errors.push({ offset: offset, endOffset: endOffset, code: 'lgd.constructor.argumentCount',
                    message: `No constructor overload for '${name}' accepts ${path.node.arguments.length} argument(s).` });
                return;
            }

            const lexicalOwner = LgdAccessibility.lexicalOwner(offset, context.declarations);
            if(!LgdAccessibility.allowed(selected.accessibility, declaration, { registry: context.members,
                lexicalOwner: lexicalOwner, receiver: receiver, projectId: context.projectId, isConstructor: true }))
            {
                errors.push(LgdAccessibility.diagnostic(offset, endOffset, `${name} constructor`, selected.accessibility));
            }

            const argumentsPaths = path.get('arguments');
            const rest = selected.params.find(parameter => parameter.rest);
            for(let index = 0; index < argumentsPaths.length; index++)
            {
                const parameter = selected.params[index] || rest;
                if(!parameter?.typeName)
                {
                    continue;
                }

                const argument = argumentsPaths[index];
                const signature = { declaration: declaration, group: { params: [], returnTypeName: parameter.typeName } };
                for(const actual of new Set(LgdReturnChecker.expressionTypes(argument, signature, context)))
                {
                    if(!context.members.compatible(parameter.typeName, actual, argument))
                    {
                        errors.push({ offset: context.map.toSource(argument.node.start), endOffset: context.map.toSource(argument.node.end),
                            code: 'lgd.constructor.argumentType', message: `Constructor '${name}' argument ${index + 1} must be ${parameter.typeName}, but received ${actual}.` });
                    }
                }
            }
        };

        traverse(context.tree, { CallExpression: inspect, OptionalCallExpression: inspect, NewExpression: inspect });
        return errors;
    }
};

module.exports = LgdConstructorCallChecker;
