const LgdFormattingModel = require('./LgdFormattingModel');
const traverse = require('@babel/traverse').default;
const LgdCleanupStyleOptions = require('./LgdCleanupStyleOptions');

/** @description These literals neither execute user code nor resolve a binding. */
const inertLiterals = new Set([ 'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral' ]);

/** @description Only immediate unconditional terminators prove later statements unreachable in this block. */
const terminators = new Set([ 'ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement' ]);

/** @description Guarded cleanup uses compiler-view AST bindings, never identifier-token counts or synthetic ranges. */
const LgdCleanupStyles = {
    /** @description Uses the existing LGD compiler view, requiring unchanged source slices for every edit. */
    analyze(source, configuration = {})
    {
        const options = { ...LgdCleanupStyleOptions.catalog.defaults, ...configuration.options?.cleanup,
            ...configuration.rules?.['lgd.format.cleanup']?.options };
        if(Object.values(options).every(value => value === 'preserve'))
        {
            return [];
        }

        const model = LgdFormattingModel.create(source);
        if(!model)
        {
            return [];
        }

        const tree = model.tree;
        const context = { source: source, tree: tree, model: model, options: options, rules: configuration.rules || {}, errors: [], dynamic: false };
        function inspectDynamicScope(nodePath)
        {
            if(nodePath.isWithStatement() || nodePath.isIdentifier({ name: 'eval' }))
            {
                context.dynamic = true;
            }
        }

        traverse(tree, { enter: inspectDynamicScope });
        if(context.dynamic)
        {
            return [];
        }

        const inspectBlock = nodePath =>
        {
            if(this.original(context, nodePath.node))
            {
                this.unreachable(context, nodePath);
                this.unused(context, nodePath);
            }
        };

        traverse(tree, { BlockStatement: inspectBlock });
        return context.errors;
    },

    /** @description Requires the complete block or edit to survive compilation without token changes. */
    original(context, node)
    {
        const range = LgdFormattingModel.range(context.model, node);
        const unchanged = range && context.source.slice(range.start, range.end) === context.model.emitted.code.slice(node.start, node.end);
        return unchanged ? range : null;
    },

    /** @description Refuses internal or attached comments and explicit formatting-disabled source. */
    commented(context, node)
    {
        const attached = node.leadingComments?.length || node.trailingComments?.length || node.innerComments?.length;
        const internal = context.tree.comments.some(comment => comment.start >= node.start && comment.end <= node.end);
        const disabled = (/(?:clang-format|lgd-format)\s+off\b/u).test(context.source);
        return Boolean(attached || internal || disabled);
    },

    /** @description Removes only an unreferenced, unwritten, single primitive const in a function-local statement list. */
    unused(context, blockPath)
    {
        if(!blockPath.getFunctionParent() || blockPath.node.body.some(statement => statement.type === 'ExpressionStatement' && statement.expression.type === 'StringLiteral'))
        {
            return;
        }

        for(const statementPath of blockPath.get('body'))
        {
            const statement = statementPath.node;
            if(statement.type !== 'VariableDeclaration' || statement.kind !== 'const' || statement.declarations.length !== 1 || this.commented(context, statement))
            {
                continue;
            }

            const declaration = statement.declarations[0];
            if(declaration.id.type !== 'Identifier' || !inertLiterals.has(declaration.init?.type))
            {
                continue;
            }

            const binding = statementPath.scope.getBinding(declaration.id.name);
            if(binding?.path.node !== declaration || binding.referenced || binding.referencePaths.length > 0 || binding.constantViolations.length > 0)
            {
                continue;
            }

            this.add(context, 'unusedLocals', statement, 'Remove the unused local constant.');
        }
    },

    /** @description Leaves declarations, labels, nested statement structures and generator-sensitive syntax in place. */
    unreachable(context, blockPath)
    {
        let terminated = false;
        for(const statementPath of blockPath.get('body'))
        {
            const statement = statementPath.node;
            if(terminated && statement.type === 'ExpressionStatement' && !this.commented(context, statement))
            {
                if(!this.sensitive(statementPath))
                {
                    this.add(context, 'unreachableStatements', statement, 'Remove the unreachable statement.');
                }
            }

            terminated ||= terminators.has(statement.type);
        }
    },

    /** @description Keeps syntax that can affect function kind or declaration instantiation even without execution. */
    sensitive(statementPath)
    {
        let sensitive = false;
        function inspectSensitiveSyntax(descendant)
        {
            if(descendant.isYieldExpression() || descendant.isAwaitExpression() || descendant.isFunction() || descendant.isClass())
            {
                sensitive = true;
            }
        }

        statementPath.traverse({ enter: inspectSensitiveSyntax });
        return sensitive;
    },

    /** @description Preserves exact source bounds and independent family/leaf severity controls. */
    add(context, option, node, message)
    {
        const ruleId = `lgd.format.cleanup.${option}`;
        const setting = { ...context.rules['lgd.format.cleanup'], ...context.rules[ruleId] };
        if(context.options[option] !== 'remove' || setting.severity === 'off')
        {
            return;
        }

        const range = this.original(context, node);
        if(!range)
        {
            return;
        }

        context.errors.push({ code: ruleId, ruleId: ruleId, offset: range.start, endOffset: range.end,
            expectedText: context.source.slice(range.start, range.end), newText: '', message: message,
            severity: setting.severity || 'warning', relatedRuleIds: [ruleId] });
    }
};

module.exports = LgdCleanupStyles;
