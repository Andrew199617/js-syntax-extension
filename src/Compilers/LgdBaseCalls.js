const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { maskCode } = require('./LgdInfer');
const { skipTrivia } = require('./LgdMethodSignature');
const LgdSourceMap = require('./LgdSourceMap');
const LgdBaseChecker = require('./LgdBaseChecker');
const LgdOverrideChecker = require('./LgdOverrideChecker');

/** @description Validates lexical base method calls and records mapped OLOO rewrites without shared dispatch state. */
const LgdBaseCalls = {
    /** @description Checks whether a class could contain a base member access worth parsing. */
    hasCalls(content, declarations)
    {
        return declarations.some(declaration => declaration.kind === 'class') && (/\bbase\s*(?:\.|\[|\?\.)/).test(maskCode(content, true));
    },

    /** @description Locates the innermost class and method containing an original source offset. */
    ownerAt(declarations, offset)
    {
        const classes = declarations.filter(declaration => declaration.kind === 'class' && declaration.initializerStart <= offset && offset < declaration.initializerEnd);

        classes.sort((left, right) => right.initializerStart - left.initializerStart);
        const declaration = classes[0];
        if(!declaration)
        {
            return null;
        }

        const member = declaration.classMembers.find(candidate => candidate.bodyStart <= offset && offset < candidate.bodyEnd);
        return { declaration: declaration, member: member };
    },

    /** @description Confirms lexical this is retained through arrow callbacks up to the defining method body. */
    hasLexicalReceiver(path, member, map)
    {
        let current = path.getFunctionParent();
        while(current)
        {
            if(map.toSource(current.node.body.start) === member.bodyStart)
            {
                return true;
            }

            if(!current.isArrowFunctionExpression())
            {
                return false;
            }

            current = current.getFunctionParent();
        }

        return false;
    },

    /** @description Resolves the known inherited method table, retaining unknown external bases conservatively. */
    inheritedMethods(declaration, context)
    {
        if(context.methodTables.has(declaration))
        {
            return context.methodTables.get(declaration);
        }

        const visible = LgdBaseChecker.visibleBindings(context.bindings, declaration.headStart);
        const base = visible.get(declaration.baseName);
        const table = base
            ? LgdOverrideChecker.describeMethods(context.content, context.declarations, base, context.externals)
            : { methodSignatures: [], methodsKnown: false };
        context.methodTables.set(declaration, table);
        return table;
    },

    /** @description Reports unsupported base forms before recording any source rewrite. */
    validateAccess(path, owner, context)
    {
        const declaration = owner.declaration;
        const member = owner.member;
        if(!declaration.baseName)
        {
            return 'A base method call requires a declared base class or object.';
        }

        if(!member || member.accessor)
        {
            return 'Base method calls are supported in class method and constructor bodies, not accessors or parameter defaults.';
        }

        if(path.scope.getBinding('base'))
        {
            return 'A base method call cannot be resolved while a local binding shadows base.';
        }

        if(path.node.computed || path.isOptionalMemberExpression())
        {
            return 'Use base.method(...); computed and optional base access is not supported.';
        }

        const call = path.parentPath;
        if(!call.isCallExpression() || call.node.callee !== path.node || call.node.optional)
        {
            return 'Use a direct base.method(...) call; base properties, getters, and detached method references are not supported.';
        }

        if(!this.hasLexicalReceiver(path, member, context.map))
        {
            return 'A base method call in a nested callback requires an arrow function to preserve the instance receiver.';
        }

        const inherited = this.inheritedMethods(declaration, context);
        const signature = inherited.methodSignatures.find(candidate => candidate.name === path.node.property.name);
        if(signature && signature.kind !== 'method')
        {
            return `Base member '${path.node.property.name}' is a property or accessor, not a callable method.`;
        }

        if(!signature && inherited.methodsKnown)
        {
            return `No inherited method named '${path.node.property.name}' is available on '${declaration.baseName}'.`;
        }

        return null;
    },

    /** @description Inspects one base access and records its source spans and lexical defining owner. */
    collectAccess(path, context)
    {
        if(path.node.object.type !== 'Identifier' || path.node.object.name !== 'base')
        {
            return;
        }

        const offset = context.map.toSource(path.node.object.start);
        const owner = this.ownerAt(context.declarations, offset);
        if(!owner)
        {
            return;
        }

        const message = this.validateAccess(path, owner, context);
        if(message)
        {
            context.errors.push({ offset: offset, endOffset: context.map.toSource(path.node.end), message: message });
            return;
        }

        const declaration = owner.declaration;
        if(!declaration.baseOwnerName)
        {
            let alias = `_lgdBaseOwner${declaration.nameStart}`;
            while(context.content.includes(alias))
            {
                alias += '$';
            }

            declaration.baseOwnerName = alias;
        }

        const open = skipTrivia(context.code, path.node.end);
        if(context.code[open] !== '(')
        {
            context.errors.push({ offset: offset, message: 'Cannot locate the argument list for this base method call.' });
            return;
        }

        declaration.baseCalls ||= [];
        declaration.baseCalls.push({
            baseStart: offset,
            baseEnd: context.map.toSource(path.node.object.end),
            methodStart: context.map.toSource(path.node.property.start),
            methodEnd: context.map.toSource(path.node.property.end),
            argumentsStart: context.map.toSource(open + 1),
            hasArguments: path.parentPath.node.arguments.length > 0
        });
    },

    /** @description Parses the valid JavaScript mirror once and attaches validated call spans to class declarations. */
    analyze(content, declarations, emitted, externals)
    {
        const masked = maskCode(content, true);
        const scopes = LgdBaseChecker.collectScopes(masked);
        const context = {
            content: content,
            declarations: declarations,
            externals: externals,
            code: emitted.code,
            map: LgdSourceMap.create(emitted.segments),
            bindings: LgdBaseChecker.collectBindings({ content: content, masked: masked, declarations: declarations, scopes: scopes, externals: externals }),
            methodTables: new Map(),
            errors: []
        };
        let tree;
        try
        {
            tree = parser.parse(emitted.code, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
        }
        catch(error)
        {
            return [{ offset: context.map.toSource(error.pos || 0), message: `Cannot validate base method calls: ${error.message}` }];
        }

        traverse(tree, {
            MemberExpression: path => this.collectAccess(path, context),
            OptionalMemberExpression: path => this.collectAccess(path, context)
        });
        return context.errors;
    },

    /** @description Rewrites only the base receiver and call punctuation, retaining method and argument source mappings. */
    rewrite(declaration, code, segments)
    {
        const map = LgdSourceMap.create(segments);
        const edits = [];
        for(const call of declaration.baseCalls || [])
        {
            const start = map.toOutput(call.baseStart);
            const baseEnd = map.toOutput(call.baseEnd);
            const methodStart = map.toOutput(call.methodStart);
            const methodEnd = map.toOutput(call.methodEnd);
            const argumentStart = map.toOutput(call.argumentsStart);
            const prefix = `${declaration.baseOwnerName}()${code.slice(baseEnd, methodStart)}`;
            const receiver = call.hasArguments ? 'this, ' : 'this';
            edits.push({
                start: start,
                end: argumentStart,
                text: `${prefix}${code.slice(methodStart, methodEnd)}.call${code.slice(methodEnd, argumentStart)}${receiver}`,
                call: call,
                nameStart: prefix.length,
                nameEnd: prefix.length + methodEnd - methodStart
            });
        }

        const output = LgdSourceMap.applyEdits(code, segments, edits);
        for(const edit of edits)
        {
            const segment = segments.find(candidate => !candidate.verbatim && candidate.srcStart === edit.call.baseStart && candidate.srcEnd === edit.call.argumentsStart);

            if(segment)
            {
                segment.nameSrcStart = edit.call.methodStart;
                segment.nameSrcEnd = edit.call.methodEnd;
                segment.nameOutStart = segment.outStart + edit.nameStart;
                segment.nameOutEnd = segment.outStart + edit.nameEnd;
            }
        }

        return output;
    }
};

module.exports = LgdBaseCalls;
