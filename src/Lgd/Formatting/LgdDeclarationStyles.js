const traverse = require('@babel/traverse').default;
const LgdFormattingModel = require('./LgdFormattingModel');

/** @description Changes declaration spelling only where parsing and executable structure prove a safe replacement. */
const LgdDeclarationStyles = {
    /** @description Uses parser-owned member ranges, never matching declaration-looking strings or comments. */
    analyze(context, formatter)
    {
        const preferences = context.options.declarations;
        if(!preferences || context.model.parsed.errors.length > 0)
        {
            return;
        }

        for(const declaration of context.model.parsed.allDeclarations)
        {
            for(const member of declaration.classMembers || [])
            {
                this.orderModifiers(context, formatter, member, preferences.modifierOrder);
                if(preferences.accessibility !== 'preserve' && declaration.kind === 'class' && member.accessibilityStart === null)
                {
                    this.offer(context, formatter, 'accessibility', { offset: member.start, endOffset: member.start, newText: 'public ' });
                }
            }
        }

        if(preferences.localTypes !== 'preserve')
        {
            this.localTypes(context, formatter, preferences.localTypes);
        }
    },

    /** @description Reorders complete contiguous modifier lists; comments and unspecified modifiers are barriers. */
    orderModifiers(context, formatter, member, ranks)
    {
        const spans = member.modifierSpans || [];
        if(spans.length < 2)
        {
            return;
        }

        const ordered = spans.slice().sort((left, right) => left.start - right.start);
        const words = ordered.map(span => context.source.slice(span.start, span.end));
        if(words.some(word => !Object.hasOwn(ranks, word)))
        {
            return;
        }

        const start = ordered[0].start;
        const end = ordered.at(-1).end;
        if(context.source.slice(start, end).trim().split(/\s+/u).join(' ') !== words.join(' '))
        {
            return;
        }

        const sorted = words.slice().sort((left, right) => ranks[left] - ranks[right]);
        if(sorted.join(' ') !== words.join(' '))
        {
            this.offer(context, formatter, 'modifierOrder', { offset: start, endOffset: end, newText: sorted.join(' ') });
        }
    },

    /** @description Limits type spelling changes to immutable primitive literals with no exported or inferred object contract. */
    localTypes(context, formatter, preference)
    {
        if(context.model.tree.program.body.some(node => node.type.startsWith('Export')))
        {
            return;
        }

        const entries = [];

        /** @description Includes const declarations whose generated prefixes have no source mapping. */
        function collect(path)
        {
            entries.push({ node: path.node, parent: path.parent });
        }

        traverse(context.model.tree, { VariableDeclaration: collect });
        for(const entry of entries)
        {
            const node = entry.node;
            if(node.type !== 'VariableDeclaration' || node.kind !== 'const' || node.declarations.length !== 1 || entry.parent?.type === 'ExportNamedDeclaration')
            {
                continue;
            }

            const binding = node.declarations[0];
            const type = { NumericLiteral: 'Number', StringLiteral: 'String', BooleanLiteral: 'Boolean' }[binding.init?.type];
            if(!type || binding.id.type !== 'Identifier')
            {
                continue;
            }

            const nameRange = LgdFormattingModel.range(context.model, binding.id);
            if(!nameRange)
            {
                continue;
            }

            const typed = context.model.parsed.allDeclarations.find(declaration => declaration.nameStart === nameRange.start);
            if(!typed && node.leadingComments?.some(comment => (/@(?:type|typedef|satisfies)\b/u).test(comment.value)))
            {
                continue;
            }

            const exactType = typed?.bindingKind === 'const' && typed.typeName === type && !typed.exported && !typed.jsdoc;
            const cleanTypeGap = typed && (/^\s*$/u).test(context.source.slice(typed.typeEnd, typed.nameStart));
            if(preference === 'inferred' && exactType && cleanTypeGap)
            {
                this.offer(context, formatter, 'localTypes', { offset: typed.typeStart, endOffset: typed.nameStart, newText: '' });
            }
            else if(!typed && preference === 'explicit')
            {
                const range = LgdFormattingModel.range(context.model, node);
                if(range && (/^const\s+$/u).test(context.source.slice(range.start, nameRange.start)))
                {
                    this.offer(context, formatter, 'localTypes', { offset: nameRange.start, endOffset: nameRange.start, newText: `${type} ` });
                }
            }
        }
    },

    /** @description Validates every candidate independently and rejects edits inside disabled regions or overlapping other edits. */
    offer(context, formatter, option, edit)
    {
        const { offset, endOffset, newText } = edit;
        const rule = { ...context.configuration.rules?.['lgd.format.declarations'], ...context.configuration.rules?.[`lgd.format.declarations.${option}`] };
        if(rule.severity === 'off' || formatter.isBlocked(context, offset, endOffset))
        {
            return;
        }

        if(context.errors.some(existing => offset < existing.endOffset && endOffset > existing.offset || offset === existing.offset))
        {
            return;
        }

        const preview = context.source.slice(0, offset) + newText + context.source.slice(endOffset);
        const checked = LgdFormattingModel.create(preview);
        if(!checked || checked.parsed.errors.length > 0 || LgdFormattingModel.signature(checked) !== LgdFormattingModel.signature(context.model))
        {
            return;
        }

        formatter.add(context, `declarations.${option}`, { offset: offset, endOffset: endOffset, newText: newText });
    }
};

module.exports = LgdDeclarationStyles;
