const LgdFormattingOptions = require('./LgdFormattingOptions');
const LgdFormattingModel = require('./LgdFormattingModel');

const { assignments, binaries } = require('./LgdFormattingOperators');
const LgdFormattingLayout = require('./LgdFormattingLayout');

/** @description A newline beside these keywords can change automatic semicolon insertion or contextual grammar. */
const restricted = new Set([ 'return', 'throw', 'yield', 'break', 'continue', 'async' ]);

/** @description Produces precise whitespace edits without rewriting comments, literals or executable token text. */
const LgdFormatter = {
    ...LgdFormattingLayout,

    /** @description Returns reusable diagnostics; caller independently chooses severity and manual or automatic application. */
    analyze(source, configuration = {})
    {
        const model = LgdFormattingModel.create(source);
        if(!model)
        {
            return [];
        }

        const options = LgdFormattingOptions.resolve(configuration);
        const context = {
            model: model, source: source, options: options, configuration: configuration,
            newline: this.newline(source, options), errors: [], blocked: this.disabledRanges(model)
        };
        this.describeBlocks(context);
        this.describeWrapping(context);
        const tokens = model.tokens;
        for(let index = 0; index <= tokens.length; index++)
        {
            const previous = tokens[index - 1];
            const next = tokens[index];
            const start = previous?.end || 0;
            const end = next?.start ?? source.length;
            const original = source.slice(start, end);
            if(!(/^\s*$/u).test(original) || this.isBlocked(context, start, end))
            {
                continue;
            }

            const gap = { start: start, end: end, original: original, text: original, rule: null, contributors: new Set(), previous: previous, next: next };
            for(const apply of [ 'layoutGap', 'spaceGap', 'indentGap', 'whitespaceGap' ])
            {
                const before = gap.text;
                this[apply](context, gap);
                if(before !== gap.text && gap.rule)
                {
                    gap.contributors.add(`lgd.format.${gap.rule}`);
                }
            }

            if(gap.rule && gap.text !== original && this.safeGap(gap))
            {
                this.add(context, gap.rule, { offset: start, endOffset: end, newText: gap.text }, [...gap.contributors]);
            }
        }

        this.insertBraces(context);
        this.insertHeader(context);
        const preview = this.apply(source, context.errors);
        if(preview !== source)
        {
            const checked = LgdFormattingModel.create(preview);
            if(!checked || LgdFormattingModel.signature(checked) !== LgdFormattingModel.signature(model))
            {
                return [];
            }
        }

        return context.errors;
    },

    /** @description Adds only explicitly configured comment text, preserving existing licenses and the shebang. */
    insertHeader(context)
    {
        const value = context.options.whitespace.fileHeader;
        if(!value || !context.source)
        {
            return;
        }

        const header = value.split(/\r\n|\r|\n/u).map(line => `// ${line}`).join(context.newline) + context.newline;
        let offset = context.source.startsWith('\uFEFF') ? 1 : 0;
        if(context.source.startsWith('#!', offset))
        {
            const ending = (/\r\n|\r|\n/u).exec(context.source.slice(offset));
            if(!ending)
            {
                return;
            }

            offset += ending.index + ending[0].length;
        }

        if(context.source.startsWith(header, offset) || this.isBlocked(context, offset, offset))
        {
            return;
        }

        context.errors = context.errors.filter(error => error.offset > offset || error.endOffset < offset);
        this.add(context, 'whitespace.fileHeader', { offset: offset, endOffset: offset, newText: header });
    },

    /** @description Applies non-overlapping edits to a string for previews and tests. */
    format(source, configuration = {})
    {
        return this.apply(source, this.analyze(source, configuration));
    },

    /** @description Applies a snapshot's disjoint edits without reinterpreting their source positions. */
    apply(source, changes)
    {
        let result = source;
        const errors = changes.slice().sort((first, second) => second.offset - first.offset || second.endOffset - first.endOffset);
        let boundary = source.length + 1;
        for(const error of errors)
        {
            if(error.endOffset > boundary)
            {
                continue;
            }

            result = result.slice(0, error.offset) + error.newText + result.slice(error.endOffset);
            boundary = error.offset;
        }

        return result;
    },

    /** @description Uses the file's existing newline unless explicitly configured otherwise. */
    newline(source, options)
    {
        const endings = new Map([ [ 'lf', '\n' ], [ 'crlf', '\r\n' ], [ 'cr', '\r' ] ]);
        return endings.get(options.whitespace.endOfLine) || source.match(/\r\n|\n|\r/u)?.[0] || '\n';
    },

    /** @description Honors clang-format and LGD formatting-off regions, including unterminated regions. */
    disabledRanges(model)
    {
        const ranges = [];
        let start = null;
        for(const token of model.tokens.filter(candidate => candidate.comment))
        {
            if((/(?:clang-format|lgd-format)\s+off\b/u).test(token.text) && start === null)
            {
                start = token.start;
            }
            else if((/(?:clang-format|lgd-format)\s+on\b/u).test(token.text) && start !== null)
            {
                ranges.push({ start: start, end: token.end });
                start = null;
            }
        }

        if(start !== null)
        {
            ranges.push({ start: start, end: model.source.length });
        }

        return ranges;
    },

    /** @description Leaves disabled source regions byte-for-byte intact. */
    isBlocked(context, start, end)
    {
        return context.blocked.some(range => start < range.end && end > range.start || start === end && start >= range.start && start <= range.end);
    },

    /** @description Records the rule owning each edit and the exact expected source for stale-action protection. */
    add(context, group, edit, relatedRuleIds = [])
    {
        const { offset, endOffset, newText } = edit;
        const ruleId = `lgd.format.${group}`;
        const parentId = `lgd.format.${group.split('.')[0]}`;
        const rule = { ...context.configuration.rules?.[parentId], ...context.configuration.rules?.[ruleId] };
        const title = LgdFormattingOptions.catalog.find(entry => entry.id === parentId).title;
        context.errors.push({
            code: ruleId, ruleId: ruleId, offset: offset, endOffset: endOffset, newText: newText,
            expectedText: context.source.slice(offset, endOffset), message: `${title} does not match the configured LGD style.`,
            severity: rule.severity || 'warning', relatedRuleIds: relatedRuleIds
        });
    },

    /** @description Applies horizontal preferences only inside existing lines or known safe structural gaps. */
    spaceGap(context, gap)
    {
        const { previous, next } = gap;
        if(!previous || !next || previous.comment || next.comment || (/[\r\n]/u).test(gap.text) || gap.rule)
        {
            return;
        }

        const spacing = context.options.spacing;
        const declaration = context.model.declarationHeads.some(span => span.start < gap.start && span.end >= gap.end);
        if(declaration && spacing.declarations === 'preserve')
        {
            return;
        }

        if(declaration)
        {
            gap.contributors.add('lgd.format.spacing.declarations');
        }

        let preference;
        let option;
        if(context.model.casts.some(cast => cast.headEnd === previous.end))
        {
            option = 'afterCast';
            preference = spacing.afterCast;
        }
        else if(assignments.has(previous.text))
        {
            option = 'afterAssignment';
            preference = spacing[option];
        }
        else if(next.text === ',')
        {
            option = 'beforeComma';
            preference = spacing[option];
        }
        else if(previous.text === ',')
        {
            option = 'afterComma';
            preference = spacing[option];
        }
        else if(next.text === '.' || next.text === '?.')
        {
            option = 'beforeDot';
            preference = spacing[option];
        }
        else if(previous.text === '.' || previous.text === '?.')
        {
            option = 'afterDot';
            preference = spacing[option];
        }
        else if(next.text === '(' && previous.text !== '(')
        {
            const kind = context.model.parens.get(next.start);
            if([ 'control', 'for' ].includes(kind))
            {
                option = 'afterControlKeywords';
                preference = spacing[option];
            }
            else if(kind === 'declaration')
            {
                option = context.model.functionParens.has(next.start) ? 'beforeFunctionParen' : 'beforeMethodParen';
                preference = spacing[option];
            }
            else if(kind === 'call')
            {
                option = 'beforeCallParen';
                preference = spacing[option];
            }
        }
        else if(previous.text === '(' || next.text === ')')
        {
            const open = previous.text === '(' ? previous : context.model.codeTokens[next.open];
            const kind = context.model.parens.get(open?.start);
            const empty = previous.text === '(' && next.text === ')';
            option = this.parenSpacingOption(kind, empty);
            preference = spacing[option];
        }
        else if(next.text === '[' && previous.text !== '=' && previous.text !== 'return')
        {
            option = 'beforeSquareBracket';
            preference = spacing[option];
        }
        else if(previous.text === '[' || next.text === ']')
        {
            option = previous.text === '[' && next.text === ']' ? 'insideEmptySquareBrackets' : 'insideSquareBrackets';
            preference = spacing[option];
        }
        else if(next.text === ';' && next.parent?.text === '(' && context.model.parens.get(next.parent.start) === 'for')
        {
            option = 'beforeForSemicolon';
            preference = spacing[option];
        }
        else if(previous.text === ';' && next.parent?.text === '(' && context.model.parens.get(next.parent.start) === 'for')
        {
            option = 'afterForSemicolon';
            preference = spacing[option];
        }
        else if(next.text === ':' && context.model.heritageColons.has(next.start))
        {
            option = 'beforeInheritanceColon';
            preference = spacing[option];
        }
        else if(previous.text === ':' && context.model.heritageColons.has(previous.start))
        {
            option = 'afterInheritanceColon';
            preference = spacing[option];
        }
        else if(previous.text === '{' || next.text === '}')
        {
            const open = previous.text === '{' ? previous : context.model.codeTokens[next.open];
            const block = context.model.braces.get(open?.start);
            if(block?.object)
            {
                option = block.empty ? 'insideEmptyObjectBraces' : 'insideObjectBraces';
                preference = spacing[option];
            }
        }
        else if(assignments.has(next.text))
        {
            option = 'beforeAssignment';
            preference = spacing[option];
        }
        else if(assignments.has(previous.text))
        {
            option = 'afterAssignment';
            preference = spacing[option];
        }
        else if((binaries.has(previous.text) || binaries.has(next.text)) && spacing.binaryOperators !== 'preserve')
        {
            const operator = binaries.has(next.text) ? next : previous;
            const index = context.model.byStart.get(operator.start);
            const operand = context.model.codeTokens[index - 1];
            if(operand && ![ '(', '[', '{', ',', '=', 'return', '=>' ].includes(operand.text) && !binaries.has(operand.text))
            {
                option = 'binaryOperators';
                preference = spacing.binaryOperators === 'both';
            }
        }

        if(preference !== undefined)
        {
            gap.text = preference ? ' ' : '';
            gap.rule = `spacing.${option}`;
        }
    },

    /** @description Keeps independent empty, declaration, invocation and control parenthesis preferences. */
    parenSpacingOption(kind, empty)
    {
        if(kind === 'declaration')
        {
            return empty ? 'insideEmptyDeclarationParens' : 'insideDeclarationParens';
        }

        if(kind === 'call')
        {
            return empty ? 'insideEmptyCallParens' : 'insideCallParens';
        }

        if(kind === 'cast')
        {
            return 'insideCastParens';
        }

        return [ 'control', 'for' ].includes(kind) ? 'insideControlParens' : 'insideOtherParens';
    },

    /** @description Calculates indentation from paired source delimiters rather than textual brace counts. */
    indentGap(context, gap)
    {
        if(!gap.next || gap.next.comment || gap.start > 0 && !(/[\r\n]/u).test(gap.text))
        {
            return;
        }

        const next = gap.next;
        const options = context.options.indentation;
        let level = 0;
        let continuation = context.binaryWraps.get(next.start) === context.newline;
        let parent = next.parent;
        while(parent)
        {
            if(parent.text === '{')
            {
                level++;
                const ancestor = context.model.braces.get(parent.start);
                if(context.options.braces.style === 'gnu' && ancestor && this.bracePlacement(context, ancestor) === 'nextLineIndented')
                {
                    level++;
                }
            }
            else
            {
                continuation = true;
            }

            parent = parent.parent;
        }

        level += context.model.controls.filter(control => next.start >= control.start && next.start < control.end && !this.shouldInsertBraces(context, control)).length;
        const block = context.model.braces.get(next.start);
        if(block && this.bracePlacement(context, block) === 'nextLineIndented')
        {
            level++;
        }

        if(next.text === '}')
        {
            const open = context.model.codeTokens[next.open];
            const closingBlock = context.model.braces.get(open?.start);
            if(closingBlock && this.bracePlacement(context, closingBlock) === 'nextLineIndented')
            {
                level++;
            }
        }

        let columns = level * options.size + (continuation ? options.continuation : 0);
        const initializerLine = context.model.constructorColons.has(next.start) || context.model.constructorColons.has(gap.previous?.start);
        if(initializerLine)
        {
            columns += options.constructorInitializer;
            gap.contributors.add('lgd.format.indentation.constructorInitializer');
        }

        if([ 'case', 'default' ].includes(next.text) && !options.caseLabels)
        {
            columns = Math.max(0, columns - options.size);
        }

        let indentationPolicy = continuation ? 'continuation' : 'size';
        if([ 'case', 'default' ].includes(next.text))
        {
            indentationPolicy = 'caseLabels';
        }

        const caseEntry = context.model.cases.find(entry => next.start > entry.start && next.start < entry.end);
        if(caseEntry)
        {
            const firstStatement = caseEntry.node.consequent[0];
            const span = firstStatement?.type === 'BlockStatement' && LgdFormattingModel.range(context.model, firstStatement);
            const inBlock = span && next.start >= span.start && next.start < span.end;
            const indented = inBlock ? options.caseBlocks : options.caseContents;
            indentationPolicy = inBlock ? 'caseBlocks' : 'caseContents';
            columns += indented ? options.size : 0;
            if(!options.caseLabels)
            {
                columns = Math.max(0, columns - options.size);
            }
        }

        let preservedIndent = null;
        if(context.model.labels.has(next.start))
        {
            indentationPolicy = 'labels';
            if(options.labels === 'preserve')
            {
                preservedIndent = gap.original.match(/[^\S\r\n]*$/u)?.[0] || '';
            }
            else
            {
                columns = options.labels === 'flushLeft' ? 0 : Math.max(0, columns - options.size);
            }
        }

        if(continuation && context.options.wrapping.alignAfterOpenBracket && next.parent?.text === '(')
        {
            columns = this.column(context.source, next.parent.start) + 1;
            gap.contributors.add('lgd.format.wrapping.alignAfterOpenBracket');
        }

        const baseColumns = level * options.size;
        const alignment = context.options.wrapping.alignAfterOpenBracket && next.parent?.text === '(';
        const tabColumns = options.tabUsage === 'indentation' || options.tabUsage === 'continuation' && alignment ? baseColumns : columns;
        const indent = preservedIndent === null ? this.indent(columns, options, tabColumns) : preservedIndent;
        const updated = gap.text.replace(/[^\S\r\n]*$/u, indent);
        if(updated !== gap.text)
        {
            gap.text = updated;
            gap.rule = `indentation.${indentationPolicy}`;
            const oldIndent = gap.original.match(/[^\S\r\n]*$/u)?.[0] || '';
            if(oldIndent.includes('\t') || indent.includes('\t'))
            {
                gap.contributors.add('lgd.format.indentation.style');
                gap.contributors.add('lgd.format.indentation.tabWidth');
                if(continuation)
                {
                    gap.contributors.add('lgd.format.indentation.tabUsage');
                }
            }
        }
    },

    /** @description Produces tabs only for complete indentation columns; alignment remainder remains spaces. */
    indent(columns, options, tabColumns = columns)
    {
        if(options.style === 'tab')
        {
            const tabs = Math.floor(Math.min(columns, tabColumns) / options.tabWidth);
            return '\t'.repeat(tabs) + ' '.repeat(columns - tabs * options.tabWidth);
        }

        return ' '.repeat(columns);
    },

    /** @description Cleans only whitespace gaps, preserving literal/comment content including internal line endings. */
    whitespaceGap(context, gap)
    {
        const options = context.options.whitespace;
        let text = gap.text;
        if(options.trimTrailingWhitespace)
        {
            text = text.replace(/[\t ]+(?=\r\n|\r|\n)/gu, '');
        }

        if(options.endOfLine !== 'preserve')
        {
            text = text.replace(/\r\n|\r|\n/gu, context.newline);
        }

        if(!gap.next && context.source.length > 0)
        {
            if(options.finalNewline === 'always')
            {
                text = context.newline;
            }
            else if(options.finalNewline === 'never')
            {
                text = '';
            }
            else if(options.trimTrailingWhitespace)
            {
                text = text.replace(/[\t ]+$/u, '');
            }
        }

        if(text !== gap.text)
        {
            gap.text = text;
            gap.rule = !gap.next && options.finalNewline !== 'preserve' ? 'whitespace.finalNewline' : 'whitespace.trimTrailingWhitespace';
            if(options.endOfLine !== 'preserve')
            {
                gap.contributors.add('lgd.format.whitespace.endOfLine');
            }
        }
    },

    /** @description Prevents ASI-sensitive line changes and accidental token concatenation. */
    safeGap(gap)
    {
        const previous = gap.previous;
        const next = gap.next;
        if(!previous || !next)
        {
            return true;
        }

        const changedLine = (/[\r\n]/u).test(gap.original) !== (/[\r\n]/u).test(gap.text);
        if(changedLine && (restricted.has(previous.text) || [ '++', '--' ].includes(previous.text) || [ '++', '--' ].includes(next.text)))
        {
            return false;
        }

        if(previous.comment && previous.text.startsWith('//') && !(/[\r\n]/u).test(gap.text))
        {
            return false;
        }

        const joinsWords = (/[$\p{ID_Continue}]$/u).test(previous.text) && (/^[$\p{ID_Continue}]/u).test(next.text);
        const joinsOperators = previous.text === '+' && next.text === '+' || previous.text === '-' && next.text === '-';
        const startsComment = previous.text.endsWith('/') && [ '/', '*' ].includes(next.text[0]);
        const integerMember = (/^\d+$/u).test(previous.text) && next.text === '.';
        if(gap.text.length === 0 && (joinsWords || joinsOperators || startsComment || integerMember))
        {
            return false;
        }

        return true;
    },

    /** @description Inserts braces only around AST-proven statements with no lexical declaration or Annex-B function scope change. */
    insertBraces(context)
    {
        const mode = context.options.bracesRequired.mode;
        if(mode === 'preserve')
        {
            return;
        }

        for(const control of context.model.controls)
        {
            if(!this.shouldInsertBraces(context, control) || this.isBlocked(context, control.start, control.end))
            {
                continue;
            }

            let text = context.source.slice(control.start, control.end);
            if(mode === 'multiLine' && !(/[\r\n]/u).test(text))
            {
                continue;
            }

            const nestedEdits = context.errors.filter(error => error.offset >= control.start && error.endOffset <= control.end);
            text = this.apply(text, nestedEdits.map(error => ({ ...error, offset: error.offset - control.start, endOffset: error.endOffset - control.start })));
            context.errors = context.errors.filter(error => !nestedEdits.includes(error));
            const related = new Set([ 'lgd.format.indentation.size', 'lgd.format.indentation.style', 'lgd.format.whitespace.endOfLine', 'lgd.format.braces.controlBlocks' ]);
            for(const error of nestedEdits)
            {
                related.add(error.ruleId);
                for(const ruleId of error.relatedRuleIds || [])
                {
                    related.add(ruleId);
                }
            }

            let parent = context.model.codeTokens[context.model.byStart.get(control.start)]?.parent;
            let level = 0;
            while(parent)
            {
                level += parent.text === '{' ? 1 : 0;
                parent = parent.parent;
            }

            const indent = this.indent(level * context.options.indentation.size, context.options.indentation);
            const inner = indent + this.indent(context.options.indentation.size, context.options.indentation);
            const replacement = `{${context.newline}${inner}${text}${context.newline}${indent}}`;
            this.add(context, 'bracesRequired.mode', { offset: control.start, endOffset: control.end, newText: replacement }, [...related]);
        }
    },

    /** @description Scope-changing declarations and incomplete statements never qualify for automatic brace insertion. */
    shouldInsertBraces(context, control)
    {
        const mode = context.options.bracesRequired.mode;
        const safeTypes = [ 'ExpressionStatement', 'ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement', 'EmptyStatement' ];
        if(mode === 'preserve' || !safeTypes.includes(control.statement.type))
        {
            return false;
        }

        return mode === 'always' || (/[\r\n]/u).test(context.source.slice(control.start, control.end));
    },

    /** @description Measures the source column without interpreting literal contents. */
    column(source, offset)
    {
        return offset - Math.max(source.lastIndexOf('\n', offset - 1), source.lastIndexOf('\r', offset - 1)) - 1;
    }
};

module.exports = LgdFormatter;
