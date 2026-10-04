const traverse = require('@babel/traverse').default;
const LgdFormattingModel = require('./LgdFormattingModel');
const LgdExpressionStyleOptions = require('./LgdExpressionStyleOptions');

/** @description Arithmetic operators share a clarity preference. */
const arithmetic = new Set([ '+', '-', '*', '/', '%', '**' ]);

/** @description Comparison operators share a clarity preference. */
const relational = new Set([ '<', '>', '<=', '>=', '==', '!=', '===', '!==' ]);

/** @description Only non-short-circuiting binary assignments are equivalent to the expanded form. */
const compound = new Set([ '+', '-', '*', '/', '%', '**', '<<', '>>', '>>>', '&', '|', '^' ]);

/** @description Emits narrowly proven semantic style edits without importing an editor or executing project code. */
const LgdExpressionStyles = {
    /** @description Leaves unsupported forms unchanged, including generated ranges and dynamic identifier lookup. */
    analyze(source, configuration = {})
    {
        const options = { ...LgdExpressionStyleOptions.catalog.defaults, ...configuration.options?.expressions,
            ...configuration.rules?.['lgd.format.expressions']?.options };
        if(Object.values(options).every(value => value === 'preserve'))
        {
            return [];
        }

        const model = LgdFormattingModel.create(source);
        if(!model)
        {
            return [];
        }

        const context = { source: source, model: model, options: options, rules: configuration.rules || {}, paths: new Map(), errors: [], dynamic: false };
        function visit(nodePath)
        {
            context.paths.set(nodePath.node, nodePath);
            if(nodePath.isWithStatement() || nodePath.isCallExpression() && nodePath.node.callee.name === 'eval')
            {
                context.dynamic = true;
            }
        }

        traverse(model.tree, { enter: visit });
        for(const entry of model.nodes)
        {
            const node = entry.node;
            if(!this.text(context, node))
            {
                continue;
            }

            this.parentheses(context, entry);
            this.conditional(context, node);
            this.assignment(context, node);
            this.member(context, entry);
            this.branches(context, node);
            this.interpolation(context, entry);
        }

        return context.errors;
    },

    /** @description Requires a contiguous, unchanged source slice rather than trusting synthetic source-map endpoints. */
    text(context, node)
    {
        if(!node)
        {
            return null;
        }

        const range = LgdFormattingModel.range(context.model, node);
        if(!range)
        {
            return null;
        }

        const original = context.source.slice(range.start, range.end);
        return original === context.model.emitted.code.slice(node.start, node.end) ? original : null;
    },

    /** @description Only lexical locals have stable reference lookup; globals, dynamic scopes and generated identifiers are refused. */
    local(context, node)
    {
        if(context.dynamic || node?.type !== 'Identifier' || !this.text(context, node))
        {
            return false;
        }

        const binding = context.paths.get(node)?.scope.getBinding(node.name);
        return Boolean(binding && binding.scope.path.type !== 'Program' && [ 'let', 'const', 'var', 'param' ].includes(binding.kind));
    },

    /** @description Preserves comments, disabled regions, rule severity and non-overlapping edit boundaries. */
    add(context, option, node, replacement)
    {
        const newText = typeof replacement === 'string' ? replacement : replacement.newText;
        const range = replacement.range || LgdFormattingModel.range(context.model, node);
        const ruleId = `lgd.format.expressions.${option}`;
        const severity = context.rules[ruleId]?.severity || context.rules['lgd.format.expressions']?.severity || 'warning';
        if(!range || severity === 'off' || context.source.slice(range.start, range.end) === newText)
        {
            return;
        }

        const comments = context.model.tree.comments.map(comment => LgdFormattingModel.range(context.model, comment)).filter(Boolean);
        if(comments.some(comment => comment.start < range.end && comment.end > range.start))
        {
            return;
        }

        let disabled = false;
        for(const token of context.model.tokens.filter(candidate => candidate.comment && candidate.start < range.end))
        {
            if((/(?:clang-format|lgd-format)\s+off\b/u).test(token.text))
            {
                disabled = true;
            }
            else if((/(?:clang-format|lgd-format)\s+on\b/u).test(token.text))
            {
                disabled = false;
            }
        }

        if(disabled || context.errors.some(error => error.offset < range.end && error.endOffset > range.start))
        {
            return;
        }

        const preview = context.source.slice(0, range.start) + newText + context.source.slice(range.end);
        if(!LgdFormattingModel.create(preview))
        {
            return;
        }

        context.errors.push({ code: ruleId, ruleId: ruleId, severity: severity, offset: range.start, endOffset: range.end,
            expectedText: context.source.slice(range.start, range.end), newText: newText,
            message: 'Expression does not match the configured LGD style.' });
    },

    /** @description Distinguishes arithmetic, relational and remaining operator groups. */
    parenthesesOption(node)
    {
        if(arithmetic.has(node.operator) && node.type === 'BinaryExpression')
        {
            return 'parenthesesArithmetic';
        }

        if(relational.has(node.operator))
        {
            return 'parenthesesRelational';
        }

        return [ 'BinaryExpression', 'LogicalExpression' ].includes(node.type) ? 'parenthesesOtherBinary' : 'parenthesesOther';
    },

    /** @description Adds clarity to mixed nested operators; removal requires identical parsed semantics including directives and optional chains. */
    parentheses(context, entry)
    {
        const { node, parent } = entry;
        const option = this.parenthesesOption(node);
        const mode = context.options[option];
        const nestedBinary = [ 'BinaryExpression', 'LogicalExpression' ].includes(node.type) && [ 'BinaryExpression', 'LogicalExpression' ].includes(parent?.type);
        if(mode === 'always_for_clarity' && nestedBinary && node.operator !== parent.operator && !node.extra?.parenthesized)
        {
            this.add(context, option, node, `(${this.text(context, node)})`);
        }
        else if(mode === 'never_if_unnecessary' && node.extra?.parenthesized)
        {
            const start = context.model.map.toSource(node.extra.parenStart);
            const open = context.model.codeTokens.find(token => token.start === start && token.text === '(');
            const close = open && context.model.codeTokens[open.close];
            if(!close || close.text !== ')')
            {
                return;
            }

            const range = { start: start, end: close.end };
            const newText = context.source.slice(open.end, close.start);
            const preview = LgdFormattingModel.create(context.source.slice(0, start) + newText + context.source.slice(close.end));
            if(preview && LgdFormattingModel.signature(preview) === LgdFormattingModel.signature(context.model))
            {
                this.add(context, option, node, { newText: newText, range: range });
            }
        }
    },

    /** @description Recognizes explicit null-and-undefined checks only; loose equality can also match document.all. */
    nullish(context, test)
    {
        if(test?.type !== 'LogicalExpression' || ![ '||', '&&' ].includes(test.operator))
        {
            return null;
        }

        const equality = test.operator === '||' ? '===' : '!==';
        const checks = [ test.left, test.right ];
        if(checks.some(check => check.type !== 'BinaryExpression' || check.operator !== equality || !this.local(context, check.left)))
        {
            return null;
        }

        const [ first, second ] = checks;
        const values = checks.map(check =>
        {
            if(check.right.type === 'NullLiteral')
            {
                return 'null';
            }

            return this.isUndefined(check.right);
        });

        if(first.left.name !== second.left.name || !values.includes('null') || !values.includes(true))
        {
            return null;
        }

        return { name: first.left.name, absent: test.operator === '||' };
    },

    /** @description void zero cannot be shadowed like an identifier named undefined. */
    isUndefined(node)
    {
        return node?.type === 'UnaryExpression' && node.operator === 'void' && node.argument.type === 'NumericLiteral' && node.argument.value === 0;
    },

    /** @description Keeps Boolean coercion and only collapses null checks of stable local bindings. */
    conditional(context, node)
    {
        if(node.type !== 'ConditionalExpression')
        {
            return;
        }

        const booleanBranches = node.consequent.type === 'BooleanLiteral' && node.alternate.type === 'BooleanLiteral';
        if(context.options.booleanSimplification === 'prefer' && booleanBranches && node.consequent.value !== node.alternate.value)
        {
            const prefix = node.consequent.value ? '!!' : '!';
            this.add(context, 'booleanSimplification', node, `${prefix}(${this.text(context, node.test)})`);
            return;
        }

        const check = this.nullish(context, node.test);
        if(!check)
        {
            return;
        }

        const absent = check.absent ? node.consequent : node.alternate;
        const present = check.absent ? node.alternate : node.consequent;
        if(context.options.coalesce === 'prefer' && present.type === 'Identifier' && present.name === check.name)
        {
            this.add(context, 'coalesce', node, `(${check.name} ?? (${this.text(context, absent)}))`);
        }
        else if(context.options.nullPropagation === 'prefer' && this.isUndefined(absent) && this.directMember(present, check.name))
        {
            const property = this.text(context, present.property);
            const access = present.computed ? `[${property}]` : property;
            this.add(context, 'nullPropagation', node, `(0, ${check.name}?.${access})`);
        }
    },

    /** @description Identifies property reads on the exact checked local receiver. */
    directMember(node, name)
    {
        return node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === name;
    },

    /** @description Local assignment preserves reference resolution and evaluates each operand exactly once. */
    assignment(context, node)
    {
        if(context.options.compoundAssignment !== 'prefer' || node.type !== 'AssignmentExpression' || node.operator !== '=' || !this.local(context, node.left))
        {
            return;
        }

        const right = node.right;
        const binary = right.type === 'BinaryExpression' && compound.has(right.operator);
        const binding = context.paths.get(node.left)?.scope.getBinding(node.left.name);
        const coalescing = right.type === 'LogicalExpression' && right.operator === '??' && binding.kind !== 'const' && !this.inferredName(right.right);
        if((binary || coalescing) && right.left.type === 'Identifier' && right.left.name === node.left.name)
        {
            this.add(context, 'compoundAssignment', node, `${node.left.name} ${right.operator}= (${this.text(context, right.right)})`);
        }
    },

    /** @description Object-literal shorthand excludes patterns, computed keys and the special prototype setter. */
    member(context, entry)
    {
        const { node, parent } = entry;
        const property = parent?.type === 'ObjectExpression' && node.type === 'ObjectProperty' && !node.computed && !node.shorthand;
        if(context.options.inferredMemberNames !== 'prefer' || !property)
        {
            return;
        }

        if(node.key.type === 'Identifier' && node.value.type === 'Identifier' && node.key.name === node.value.name && node.key.name !== '__proto__')
        {
            this.add(context, 'inferredMemberNames', node, node.key.name);
        }
    },

    /** @description Extracts only a single statement from a block without changing a declaration's scope. */
    statement(node)
    {
        return node?.type === 'BlockStatement' && node.body.length === 1 ? node.body[0] : node;
    },

    /** @description Anonymous assignment values infer a name that a conditional expression would remove. */
    inferredName(node)
    {
        return node?.type === 'ArrowFunctionExpression' || [ 'FunctionExpression', 'ClassExpression' ].includes(node?.type) && !node.id;
    },

    /** @description Converts matching return or local assignment branches, and guarded local delegate calls. */
    branches(context, node)
    {
        if(node.type !== 'IfStatement')
        {
            return;
        }

        const first = this.statement(node.consequent);
        const second = this.statement(node.alternate);
        const test = this.text(context, node.test);
        if(context.options.conditionalReturn === 'prefer' && first?.type === 'ReturnStatement' && second?.type === 'ReturnStatement' && first.argument && second.argument)
        {
            this.add(context, 'conditionalReturn', node, `return (${test}) ? (${this.text(context, first.argument)}) : (${this.text(context, second.argument)});`);
        }
        else if(context.options.conditionalAssignment === 'prefer' && first?.type === 'ExpressionStatement' && second?.type === 'ExpressionStatement')
        {
            const left = first.expression;
            const right = second.expression;
            const plainAssignments = left.type === 'AssignmentExpression' && right.type === 'AssignmentExpression' && left.operator === '=' && right.operator === '=';
            const namedValue = this.inferredName(left.right) || this.inferredName(right.right);
            if(plainAssignments && !namedValue && this.local(context, left.left) && right.left.type === 'Identifier' && left.left.name === right.left.name)
            {
                this.add(context, 'conditionalAssignment', node, `${left.left.name} = (${test}) ? (${this.text(context, left.right)}) : (${this.text(context, right.right)});`);
            }
        }
        else if(context.options.conditionalCall === 'prefer' && !node.alternate && first?.type === 'ExpressionStatement' && first.expression.type === 'CallExpression')
        {
            const check = this.nullish(context, node.test);
            const call = first.expression;
            if(check && !check.absent && call.callee.type === 'Identifier' && call.callee.name === check.name)
            {
                const original = this.text(context, call);
                this.add(context, 'conditionalCall', node, `${check.name}?.${original.slice(check.name.length)};`);
            }
        }
    },

    /** @description Folds only primitive constants in untagged interpolation, escaping template syntax without invoking conversions. */
    interpolation(context, entry)
    {
        const { node, parent } = entry;
        if(context.options.interpolation !== 'prefer' || node.type !== 'TemplateLiteral' || parent?.type === 'TaggedTemplateExpression' || node.expressions.length === 0)
        {
            return;
        }

        let replacement = '`';
        let changed = false;
        for(let index = 0; index < node.quasis.length; index++)
        {
            replacement += node.quasis[index].value.raw;
            const expression = node.expressions[index];
            if(!expression)
            {
                continue;
            }

            if([ 'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral' ].includes(expression.type))
            {
                const value = expression.type === 'NullLiteral' ? 'null' : String(expression.value);
                replacement += value.replace(/\\/gu, '\\\\').replace(/`/gu, '\\`').replace(/\{/gu, '\\u007b').replace(/\$/gu, '\\$').replace(/\r/gu, '\\r').replace(/\n/gu, '\\n');
                changed = true;
            }
            else
            {
                replacement += `\${${this.text(context, expression)}}`;
            }
        }

        if(changed)
        {
            this.add(context, 'interpolation', node, `${replacement}\``);
        }
    }
};

module.exports = LgdExpressionStyles;
