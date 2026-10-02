const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { maskCode } = require('./LgdInfer');
const LgdBaseChecker = require('./LgdBaseChecker');
const LgdSourceMap = require('./LgdSourceMap');

/** @description Erases resolved type-only interface imports and CommonJS exports from the JavaScript mirror. */
const LgdInterfaceErasure = {
    /**
     * @description Removes only direct interface bindings, preserving comments, other effects and source mappings.
     * @param {string} content the original LGD document.
     * @param {Array} declarations the flat LGD declaration records.
     * @param {Map} externals require specifiers mapped to exported contract metadata.
     * @param {Object} emitted the JavaScript code and mapping segments before erasure.
     * @returns {Object} the rewritten code and segments, without mutating the input.
     */
    apply(content, declarations, externals, emitted)
    {
        if(!declarations.some(declaration => this.isInterface(declaration)) && ![...externals.values()].some(external => this.isInterface(external)))
        {
            return emitted;
        }

        let syntax;
        try
        {
            syntax = parser.parse(emitted.code, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
        }
        catch
        {
            // Incomplete source stays available for the compiler's existing diagnostics.
            return emitted;
        }

        const masked = maskCode(content, true);
        const context = {
            code: emitted.code,
            map: LgdSourceMap.create(emitted.segments),
            externals: externals,
            bindings: LgdBaseChecker.collectBindings({ content: content, masked: masked, declarations: declarations,
                scopes: LgdBaseChecker.collectScopes(masked), externals: externals }),
            imports: new Set(),
            ranges: []
        };
        traverse(syntax, { VariableDeclaration: path => this.collectImports(path, context) });
        traverse(syntax, { ExpressionStatement: path => this.collectExport(path, context) });
        const edits = this.commentPreservingEdits(context.code, context.ranges, syntax.comments || []);
        const segments = emitted.segments.map(segment => ({ ...segment }));
        return { code: this.rewrite(context.code, segments, edits), segments: segments };
    },

    /** @description Recognizes interface declarations and exported interface contract metadata. */
    isInterface(declaration)
    {
        return declaration?.kind === 'interface' || declaration?.contractKind === 'interface';
    },

    /** @description Resolves a direct static require call only when require is not lexically shadowed. */
    importedInterface(path, context)
    {
        const node = path.node;
        const initializer = node.init;
        if(node.id.type !== 'Identifier' || initializer?.type !== 'CallExpression' || initializer.optional || initializer.arguments.length !== 1)
        {
            return false;
        }

        const callee = initializer.callee;
        const specifier = initializer.arguments[0];
        const directRequire = callee.type === 'Identifier' && callee.name === 'require' && !path.scope.getBinding('require');
        return directRequire && specifier.type === 'StringLiteral' && this.isInterface(context.externals.get(specifier.value));
    },

    /** @description Records direct interface imports and removes only their declaration groups. */
    collectImports(path, context)
    {
        const declarators = path.get('declarations');
        const selected = declarators.map(declarator => this.importedInterface(declarator, context));
        for(let index = 0; index < declarators.length; index++)
        {
            if(selected[index])
            {
                context.imports.add(declarators[index].scope.getBinding(declarators[index].node.id.name));
            }
        }

        if(selected.every(Boolean))
        {
            const statement = path.parentPath.isExportNamedDeclaration() ? path.parentPath : path;
            context.ranges.push({ start: statement.node.start, end: statement.node.end, emptyStatement: this.needsEmptyStatement(statement) });
            return;
        }

        let index = 0;
        while(index < selected.length)
        {
            if(!selected[index])
            {
                index++;
                continue;
            }

            const first = index;
            while(index + 1 < selected.length && selected[index + 1])
            {
                index++;
            }

            const last = index;
            const start = first === 0 ? declarators[first].node.start : declarators[first - 1].node.end;
            const end = first === 0 ? declarators[last + 1].node.start : declarators[last].node.end;
            context.ranges.push({ start: start, end: end });
            index++;
        }
    },

    /** @description Retains a placeholder when removing a statement would change its enclosing control flow. */
    needsEmptyStatement(path)
    {
        return !path.inList && !path.parentPath.isForStatement();
    },

    /** @description Resolves an identifier through Babel bindings before consulting erased LGD lexical bindings. */
    resolvesInterface(path, context)
    {
        const binding = path.scope.getBinding(path.node.name);
        if(binding)
        {
            return context.imports.has(binding) && binding.constantViolations.length === 0;
        }

        const offset = context.map.toSource(path.node.start);
        return this.isInterface(LgdBaseChecker.visibleBindings(context.bindings, offset).get(path.node.name));
    },

    /** @description Erases only standalone CommonJS assignments whose sole exported value is an interface. */
    collectExport(path, context)
    {
        const assignment = path.node.expression;
        if(assignment.type !== 'AssignmentExpression' || assignment.operator !== '=' || assignment.right.type !== 'Identifier')
        {
            return;
        }

        const target = assignment.left;
        const plainMember = target.type === 'MemberExpression' && !target.computed && target.object.type === 'Identifier';
        if(!plainMember || target.object.name !== 'module' || target.property.type !== 'Identifier' || target.property.name !== 'exports' || path.scope.getBinding('module'))
        {
            return;
        }

        if(this.resolvesInterface(path.get('expression.right'), context))
        {
            context.ranges.push({ start: path.node.start, end: path.node.end, emptyStatement: this.needsEmptyStatement(path) });
        }
    },

    /** @description Builds token deletions while retaining every comment and original whitespace span. */
    commentPreservingEdits(code, ranges, comments)
    {
        const edits = [];
        for(const range of ranges)
        {
            let cursor = range.start;
            const retained = comments.filter(comment => range.start <= comment.start && comment.end <= range.end);
            const gaps = [];
            for(const comment of retained)
            {
                gaps.push({ start: cursor, end: comment.start });
                cursor = comment.end;
            }

            gaps.push({ start: cursor, end: range.end });
            let first = true;
            for(const gap of gaps)
            {
                for(const match of code.slice(gap.start, gap.end).matchAll(/\S+/g))
                {
                    edits.push({ start: gap.start + match.index, end: gap.start + match.index + match[0].length,
                        text: first && range.emptyStatement ? ';' : '' });
                    first = false;
                }
            }
        }

        return edits;
    },

    /** @description Applies deletions to both verbatim spans and generated typed heads without inventing source offsets. */
    rewrite(code, segments, edits)
    {
        let output = code;
        const ordered = edits.slice().sort((left, right) => right.start - left.start);
        for(const edit of ordered)
        {
            const map = LgdSourceMap.create(segments);
            const first = map.toSource(edit.start);
            const last = map.toSource(edit.end);
            const delta = edit.text.length - edit.end + edit.start;
            const rewritten = [];
            for(const segment of segments)
            {
                this.appendSegment(rewritten, segment, edit, delta);
            }

            rewritten.push({
                srcStart: Math.min(first, last), srcEnd: Math.max(first, last), outStart: edit.start, outEnd: edit.start + edit.text.length,
                verbatim: false, nameSrcStart: last, nameSrcEnd: last, nameOutStart: edit.start + edit.text.length, nameOutEnd: edit.start + edit.text.length
            });
            segments.splice(0, segments.length, ...rewritten);
            output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
        }

        return output;
    },

    /** @description Preserves surviving portions of one mapping, including already collapsed interface declaration spans. */
    appendSegment(result, segment, edit, delta)
    {
        if(segment.outEnd <= edit.start)
        {
            result.push(segment);
            return;
        }

        if(segment.outStart >= edit.end)
        {
            result.push(this.clipSegment(segment, segment.outStart, segment.outEnd, delta));
            return;
        }

        if(segment.outStart === segment.outEnd)
        {
            result.push(this.clipSegment(segment, segment.outStart, segment.outEnd, edit.start - segment.outStart));
            return;
        }

        if(segment.outStart < edit.start)
        {
            result.push(this.clipSegment(segment, segment.outStart, edit.start, 0));
        }

        if(segment.outEnd > edit.end)
        {
            result.push(this.clipSegment(segment, edit.end, segment.outEnd, delta));
        }
    },

    /** @description Clips output mappings exactly for verbatim text and clamps generated name anchors to retained spans. */
    clipSegment(segment, start, end, delta)
    {
        const clipped = { ...segment, outStart: start + delta, outEnd: end + delta };
        if(segment.verbatim)
        {
            clipped.srcStart = segment.srcStart + start - segment.outStart;
            clipped.srcEnd = segment.srcStart + end - segment.outStart;
        }

        if(segment.nameOutStart !== undefined)
        {
            const nameStart = Math.max(start, Math.min(end, segment.nameOutStart));
            const nameEnd = Math.max(start, Math.min(end, segment.nameOutEnd));
            const sourceWidth = segment.nameSrcEnd - segment.nameSrcStart;
            clipped.nameSrcStart = segment.nameSrcStart + Math.min(sourceWidth, Math.max(0, nameStart - segment.nameOutStart));
            clipped.nameSrcEnd = segment.nameSrcStart + Math.min(sourceWidth, Math.max(0, nameEnd - segment.nameOutStart));
            clipped.nameOutStart = nameStart + delta;
            clipped.nameOutEnd = nameEnd + delta;
        }

        return clipped;
    }
};

module.exports = LgdInterfaceErasure;
