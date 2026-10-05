const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const LgdClassMemberSemantics = require('../Compilers/LgdClassMemberSemantics');
const LgdConstructorCallChecker = require('../Compilers/LgdConstructorCallChecker');
const LgdConstructorSignatures = require('../Compilers/LgdConstructorSignatures');
const LgdAccessibility = require('../Compilers/LgdAccessibility');

/** @description Describes actual construction sites without replacing ordinary type and argument hovers. */
const LgdConstructorHover = {
    /** @description Resolves the innermost current constructor callee or erroneous constructor argument. */
    get(state, position)
    {
        if(!state.jsDocument || state.compiledVersion !== state.document.version || state.compiledText !== state.document.getText())
        {
            return null;
        }

        let tree;
        try
        {
            tree = parse(state.jsDocument.getText(), { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
        }
        catch
        {
            return null;
        }

        const content = state.document.getText();
        const offset = state.document.offsetAt(position);
        const context = { content: content, declarations: state.declarations, externals: state.externals || new Map(), map: state.map, state: state, tree: tree };
        context.members = LgdClassMemberSemantics.create(context);
        let target = null;
        const inspect = path =>
        {
            const site = this.loweredSite(path, state);
            const start = site?.start ?? state.map.toSource(path.node.start);
            const end = state.map.toSource(path.node.end);
            if(offset < start || offset >= end || target && end - start >= target.callEnd - target.callStart)
            {
                return;
            }

            const calleeEnd = state.map.toSource(path.node.callee.end);
            const argumentIndex = path.node.arguments.findIndex(argument =>
            {
                const argumentStart = state.map.toSource(argument.start);
                const argumentEnd = state.map.toSource(argument.end);
                return argumentStart <= offset && offset < argumentEnd;
            });

            const diagnostic = state.errors.find(error => error.code === 'lgd.constructor.argumentType' && error.offset <= offset && offset < error.endOffset);
            const argumentError = argumentIndex !== -1 && Boolean(diagnostic);
            if(offset >= calleeEnd && !argumentError)
            {
                return;
            }

            const native = path.isNewExpression();
            if(native && !content.startsWith('new', start))
            {
                return;
            }

            const receiver = native ? context.members.receiver(path.get('callee')) : LgdConstructorCallChecker.factory(path.get('callee'), context);
            if(receiver?.kind !== 'type' || receiver.declaration.kind !== 'class')
            {
                return;
            }

            target = this.describe(path, receiver, context, argumentError ? argumentIndex : -1);
        };

        traverse(tree, { NewExpression: inspect, CallExpression: inspect, OptionalCallExpression: inspect });
        return target;
    },

    /** @description Restores original new-call spelling for a lowered factory call in the editor mirror. */
    loweredSite(path, state)
    {
        if(!path.isCallExpression())
        {
            return null;
        }

        const start = state.map.toSource(path.node.start);
        const end = state.map.toSource(path.node.callee.end);
        return state.constructionSites?.find(site => site.calleeStart === start && site.calleeEnd === end) || null;
    },

    /** @description Filters signatures with the compiler's lexical access rules and retains the source call spelling. */
    describe(path, receiver, context, argumentIndex)
    {
        const state = context.state;
        const declaration = receiver.declaration;
        const site = this.loweredSite(path, state);
        const start = site?.start ?? state.map.toSource(path.node.start);
        const end = state.map.toSource(path.node.end);
        const calleeEnd = state.map.toSource(path.node.callee.end);
        const lexicalOwner = LgdAccessibility.lexicalOwner(start, state.declarations);
        const options = { registry: context.members, lexicalOwner: lexicalOwner, receiver: receiver, projectId: state.projectId, isConstructor: true };
        const typeAccessible = LgdAccessibility.allowed(LgdAccessibility.visibility(declaration), declaration, options);
        const allSignatures = LgdConstructorSignatures.get(declaration);
        const signatures = allSignatures.filter(signature => typeAccessible && LgdAccessibility.allowed(signature.accessibility, declaration, options));
        const spread = path.node.arguments.some(argument => argument.type === 'SpreadElement');
        const matches = spread ? [] : signatures.filter(signature => LgdConstructorSignatures.accepts(signature, path.node.arguments.length));
        const selected = matches.length === 1 ? matches[0] : null;
        const argument = path.node.arguments[argumentIndex];
        let parameter = null;
        if(selected && argument)
        {
            parameter = selected.params[argumentIndex] || selected.params.find(candidate => candidate.rest);
        }

        return {
            name: context.content.slice(start, calleeEnd).replace(/\s+/g, ' ').trim(),
            signatures: signatures,
            native: path.isNewExpression() || Boolean(site),
            selected: selected,
            parameter: parameter,
            argumentIndex: argumentIndex,
            abstract: declaration.abstract,
            start: argument ? state.map.toSource(argument.start) : start,
            end: argument ? state.map.toSource(argument.end) : calleeEnd,
            callStart: start,
            callEnd: end
        };
    },

    /** @description Preserves parameter names, nullable types, rest markers, and default values in source syntax. */
    formatParameter(parameter)
    {
        if(!parameter.name)
        {
            return parameter.raw?.trim() || '?';
        }

        const type = parameter.typeName ? `${parameter.typeName} ` : '';
        const rest = parameter.rest ? '...' : '';
        const name = parameter.name;
        const defaultValue = parameter.defaultText;
        if(defaultValue !== null && defaultValue !== undefined)
        {
            return `${rest}${type}${name} = ${defaultValue.trim()}`;
        }

        return `${rest}${type}${name}${parameter.optional && !parameter.rest ? '?' : ''}`;
    },

    /** @description Shows accessible overloads, placing the active erroneous argument's constructor first. */
    render(detail)
    {
        if(detail.signatures.length === 0)
        {
            return 'No constructors are accessible here.';
        }

        let signatures = detail.signatures;
        if(detail.parameter)
        {
            signatures = [ detail.selected, ...signatures.filter(signature => signature !== detail.selected) ];
        }

        const lines = signatures.map(signature => `${detail.name}(${signature.params.map(this.formatParameter).join(', ')})`);
        const language = detail.native ? 'lgd-constructor' : 'lgd';
        const paragraphs = [[ `\`\`\`${language}`, ...lines, '```' ].join('\n')];
        if(detail.parameter)
        {
            paragraphs.push(`Argument ${detail.argumentIndex + 1}: \`${this.formatParameter(detail.parameter)}\``);
        }

        if(detail.abstract)
        {
            paragraphs.push('Abstract classes cannot be constructed directly.');
        }

        return paragraphs.join('\n\n');
    }
};

module.exports = LgdConstructorHover;
