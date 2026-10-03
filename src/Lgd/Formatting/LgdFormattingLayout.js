const LgdFormattingModel = require('./LgdFormattingModel');
const { assignments, binaries } = require('./LgdFormattingOperators');

/** @description Shared structural layout methods operate on the formatter's immutable source model. */
const LgdFormattingLayout = {
    /** @description Determines compact-block eligibility once for consistent opening, body and closing edits. */
    describeBlocks(context)
    {
        const tokens = context.model.codeTokens;
        for(const [ start, block ] of context.model.braces)
        {
            const index = context.model.byStart.get(start);
            const open = tokens[index];
            const close = open && tokens[open.close];
            if(!close)
            {
                continue;
            }

            block.open = open;
            block.close = close;
            block.empty = open.close === index + 1;
            block.object = [ 'objectLiterals', 'objectPatterns' ].includes(block.location);
            const interior = context.source.slice(open.end, close.start);
            const hasComment = context.model.tokens.some(token => token.comment && token.start > start && token.end <= close.start);
            const nested = tokens.slice(index + 1, open.close).some(token => token.text === '{');
            const width = context.options.wrapping.columnLimit;
            const headStart = block.headStart ?? tokens[index - 1]?.start ?? start;
            const headerLength = context.source.slice(headStart, start).trim().replace(/\s+/gu, ' ').length;
            const flatLength = interior.trim().replace(/\s+/gu, ' ').length;
            let parent = open.parent;
            let indentation = 0;
            while(parent)
            {
                indentation += parent.text === '{' ? context.options.indentation.size : 0;
                parent = parent.parent;
            }

            const bracePadding = 5;
            const fits = width === 0 || indentation + headerLength + flatLength + bracePadding <= width;
            let mode = context.options.lineBreaks.shortBlocks;
            if([ 'constructors', 'methods', 'accessors', 'functions' ].includes(block.location))
            {
                mode = context.options.lineBreaks.shortFunctions;
                if(mode === 'inline')
                {
                    mode = [ 'methods', 'accessors', 'constructors' ].includes(block.location) ? 'all' : 'empty';
                }
            }
            else if(block.location === 'lambdas')
            {
                mode = context.options.lineBreaks.shortLambdas;
                if(mode === 'inline')
                {
                    mode = block.inlineArgument ? 'all' : 'empty';
                }
            }
            else if(block.location === 'controlBlocks')
            {
                const head = tokens[index - 1];
                const keyword = head?.text === ')' ? tokens[tokens[head.open]?.index - 1]?.text : head?.text;
                if(keyword === 'if' && context.options.lineBreaks.shortIfs === 'never' || [ 'for', 'while', 'do' ].includes(keyword) && !context.options.lineBreaks.shortLoops)
                {
                    mode = 'never';
                }
            }

            const allowEmpty = mode === 'empty' && block.empty;
            const allowContents = [ 'all', 'always' ].includes(mode) || mode === 'preserve' && !(/[\r\n]/u).test(interior);
            block.compact = !hasComment && !nested && fits && (allowEmpty || allowContents);
            if([ 'classes', 'interfaces', 'enums', 'switchBlocks' ].includes(block.location))
            {
                block.compact = false;
            }

            if(block.location === 'controlBlocks')
            {
                const head = tokens[index - 1];
                const keyword = head?.text === ')' ? tokens[tokens[head.open]?.index - 1]?.text : head?.text;
                const ifMode = context.options.lineBreaks.shortIfs;
                if(keyword === 'if' && [ 'all', 'withoutElse' ].includes(ifMode))
                {
                    const after = tokens[open.close + 1];
                    block.compact = !hasComment && !nested && fits && (ifMode === 'all' || after?.text !== 'else');
                }
                else if([ 'for', 'while', 'do' ].includes(keyword) && context.options.lineBreaks.shortLoops)
                {
                    block.compact = !hasComment && !nested && fits;
                }
            }

            if(context.options.lineBreaks.preserveSingleLineBlocks && !hasComment && !(/[\r\n]/u).test(interior) && !block.object)
            {
                block.compact = true;
            }

            if(block.object)
            {
                block.compact = context.options.lineBreaks.objectMembers === 'singleLine' && !hasComment && !nested && fits;
            }
        }
    },

    /** @description Chooses native brace overrides first, then location-aware named presets. */
    bracePlacement(context, block)
    {
        const braces = context.options.braces;
        const override = braces.wrapping[block.location];
        if(override && override !== 'inherit')
        {
            return override;
        }

        if(block.object)
        {
            return 'sameLine';
        }

        if([ 'attach', 'custom' ].includes(braces.style))
        {
            return 'sameLine';
        }

        if([ 'allman', 'whitesmiths' ].includes(braces.style))
        {
            return braces.style === 'whitesmiths' ? 'nextLineIndented' : 'nextLine';
        }

        if(braces.style === 'gnu')
        {
            return block.definition ? 'nextLine' : 'nextLineIndented';
        }

        if(braces.style === 'stroustrup' || braces.style === 'webkit')
        {
            return block.definition && ![ 'classes', 'interfaces', 'enums' ].includes(block.location) ? 'nextLine' : 'sameLine';
        }

        if(braces.style === 'linux')
        {
            return block.definition && block.location !== 'enums' ? 'nextLine' : 'sameLine';
        }

        return block.definition || block.location === 'enums' ? 'nextLine' : 'sameLine';
    },

    /** @description Rewrites only structurally known block boundaries; statement newlines otherwise remain intact. */
    layoutGap(context, gap)
    {
        const { previous, next } = gap;
        if(!previous || !next || previous.comment || next.comment)
        {
            return;
        }

        if(context.options.lineBreaks.preserveSingleLineBlocks)
        {
            const preserved = [...context.model.braces.values()].some(block => block.compact && !block.object && block.open?.end <= gap.start && block.close?.start >= gap.end);
            if(preserved && !(/[\r\n]/u).test(gap.original))
            {
                return;
            }
        }

        const blocks = context.model.braces;
        const opening = blocks.get(next.start);
        const afterOpen = blocks.get(previous.start);
        const closingOpen = next.text === '}' ? context.model.codeTokens[next.open] : null;
        const beforeClose = closingOpen && blocks.get(closingOpen.start);
        const parentBlock = next.parent?.text === '{' ? blocks.get(next.parent.start) : null;
        const objectBlock = [ beforeClose, afterOpen, parentBlock ].find(block => block?.object);
        if(opening)
        {
            let placement = this.bracePlacement(context, opening);
            if(opening.compact)
            {
                placement = 'sameLine';
            }

            if(placement === 'nextLineIfMultiline')
            {
                const headStart = previous.text === ')' ? context.model.codeTokens[previous.open]?.start : previous.start;
                placement = (/[\r\n]/u).test(context.source.slice(headStart, previous.end)) ? 'nextLine' : 'sameLine';
            }

            gap.text = placement === 'sameLine' ? ' ' : context.newline;
            gap.rule = `braces.${opening.location}`;
        }
        else if(next.text === '}' && beforeClose && !beforeClose.object || previous.text === '{' && afterOpen && !afterOpen.object)
        {
            const block = beforeClose || afterOpen;
            gap.text = block.compact ? ' ' : context.newline;
            if(block.empty && block.compact)
            {
                gap.text = context.options.spacing.insideEmptyBlockBraces ? ' ' : '';
                gap.contributors.add('lgd.format.spacing.insideEmptyBlockBraces');
            }
            else if(!block.compact && (afterOpen && context.options.lineBreaks.emptyLinesAtBlockStart || beforeClose && context.options.lineBreaks.emptyLinesAtBlockEnd))
            {
                const count = gap.original.match(/\r\n|\r|\n/gu)?.length || 1;
                gap.text = context.newline.repeat(count);
            }

            let option = 'shortBlocks';
            if([ 'constructors', 'methods', 'accessors', 'functions' ].includes(block.location))
            {
                option = 'shortFunctions';
            }
            else if(block.location === 'lambdas')
            {
                option = 'shortLambdas';
            }

            gap.rule = `lineBreaks.${option}`;
            if(context.options.lineBreaks.preserveSingleLineBlocks)
            {
                gap.contributors.add('lgd.format.lineBreaks.preserveSingleLineBlocks');
            }
        }
        else if(previous.text === '}' && ([ 'else', 'catch', 'finally' ].includes(next.text) || next.text === 'while' && context.model.doWhileKeywords.has(next.start)))
        {
            const preference = `before${next.text[0].toUpperCase()}${next.text.slice(1)}`;
            const nextLine = context.options.braces[preference];
            gap.text = nextLine ? context.newline : ' ';
            gap.rule = `braces.${preference}`;
        }
        else if(objectBlock && context.options.lineBreaks.objectMembers !== 'preserve' && (previous.text === '{' || previous.text === ',' || next.text === '}'))
        {
            gap.text = objectBlock.compact ? ' ' : context.newline;
            gap.rule = 'lineBreaks.objectMembers';
        }
        else if(previous.text === ';' && (!next.parent || parentBlock && !parentBlock.object && !parentBlock.compact) && !context.options.lineBreaks.preserveSingleLineStatements)
        {
            gap.text = context.newline;
            gap.rule = 'lineBreaks.preserveSingleLineStatements';
        }
        else if(previous.text === '}' && ![ ';', ',', ')', ']', '.', '?.', '(', '}', ':', '=' ].includes(next.text) && !binaries.has(next.text) && !assignments.has(next.text))
        {
            const previousOpen = context.model.codeTokens[previous.open];
            const previousBlock = blocks.get(previousOpen?.start);
            if(previousBlock && !previousBlock.object && previousBlock.location !== 'lambdas')
            {
                const preserveLines = (/[\r\n]/u).test(gap.original) && context.options.lineBreaks.separateDefinitions === 'preserve';
                gap.text = preserveLines ? gap.original : context.newline;
                if(previousBlock.definition && context.options.lineBreaks.separateDefinitions === 'always')
                {
                    gap.text += context.newline;
                }

                gap.rule = 'lineBreaks.separateDefinitions';
            }
        }

        this.statementGap(context, gap);
        this.wrapGap(context, gap);
        this.binaryGap(context, gap);
        this.blankLineGap(context, gap);
        if((/[\r\n]/u).test(gap.text))
        {
            const maximum = context.options.lineBreaks.maxEmptyLines + 1;
            const breaks = gap.text.match(/\r\n|\r|\n/gu) || [];
            if(breaks.length > maximum)
            {
                gap.text = context.newline.repeat(maximum);
                gap.rule = 'lineBreaks.maxEmptyLines';
            }
        }
    },

    /** @description Applies independent blank-line policies only at verified syntax boundaries. */
    blankLineGap(context, gap)
    {
        const { previous, next } = gap;
        const options = context.options.lineBreaks;
        const importGroup = context.model.importStarts.get(next.start);
        const precedingImport = context.model.importEnds.get(previous.end);
        if(importGroup && precedingImport && options.importGroups !== 'preserve')
        {
            const separate = options.importGroups === 'origin' && importGroup !== precedingImport;
            gap.text = context.newline.repeat(separate ? 2 : 1);
            gap.rule = 'lineBreaks.importGroups';
        }

        const breaks = gap.original.match(/\r\n|\r|\n/gu)?.length || 0;
        if(previous.text === '}' && next.text === '}')
        {
            const previousOpen = context.model.codeTokens[previous.open];
            const nextOpen = context.model.codeTokens[next.open];
            const blocks = [ previousOpen, nextOpen ].map(token => context.model.braces.get(token?.start));
            if(blocks.every(block => block && !block.object) && breaks > 1)
            {
                gap.text = context.newline.repeat(options.blankLinesBetweenClosingBraces ? breaks : 1);
                gap.rule = 'lineBreaks.blankLinesBetweenClosingBraces';
            }
        }

        if(previous.text === '}' && !options.statementImmediatelyAfterBlock)
        {
            const open = context.model.codeTokens[previous.open];
            const block = context.model.braces.get(open?.start);
            const nextStatement = context.model.nodes.some(record =>
            {
                const statement = record.node.type.endsWith('Statement') || record.node.type.endsWith('Declaration');
                return record.start === next.start && statement;
            });

            const continuation = [ 'else', 'catch', 'finally' ].includes(next.text) || context.model.doWhileKeywords.has(next.start);
            if(block && !block.object && block.location !== 'lambdas' && nextStatement && !continuation)
            {
                gap.text = context.newline.repeat(2);
                gap.rule = 'lineBreaks.statementImmediatelyAfterBlock';
            }
        }

        let option;
        if(context.model.constructorColons.has(previous.start))
        {
            option = 'blankLineAfterConstructorColon';
        }
        else if(context.model.conditionalTokens.has(previous.start))
        {
            option = 'blankLineAfterConditionalToken';
        }
        else if(previous.text === '=>')
        {
            option = 'blankLineAfterArrow';
        }

        if(option && !options[option] && breaks > 1)
        {
            gap.text = context.newline;
            gap.rule = `lineBreaks.${option}`;
        }
    },

    /** @description Gives unbraced controls, switch labels and preserved compact blocks their own layout policy. */
    statementGap(context, gap)
    {
        const { previous, next } = gap;
        const control = context.model.controls.find(entry => entry.start === next.start);
        if(control)
        {
            const isIf = control.parent.type === 'IfStatement';
            const mode = context.options.lineBreaks.shortIfs;
            const shortAllowed = isIf ? mode === 'all' || mode === 'withoutElse' && !control.parent.alternate : context.options.lineBreaks.shortLoops;
            const allow = context.options.lineBreaks.embeddedStatementsSameLine && shortAllowed;
            if(this.shouldInsertBraces(context, control))
            {
                const placement = this.bracePlacement(context, { location: 'controlBlocks', definition: false });
                gap.text = placement === 'sameLine' ? ' ' : context.newline;
                gap.rule = 'bracesRequired.mode';
                gap.contributors.add('lgd.format.braces.controlBlocks');
            }
            else if(!isIf || mode !== 'preserve' || !context.options.lineBreaks.embeddedStatementsSameLine)
            {
                gap.text = allow ? ' ' : context.newline;
                gap.rule = isIf ? 'lineBreaks.shortIfs' : 'lineBreaks.shortLoops';
                gap.contributors.add('lgd.format.lineBreaks.embeddedStatementsSameLine');
            }
        }

        const label = context.model.cases.find(entry => entry.node.consequent[0] && LgdFormattingModel.range(context.model, entry.node.consequent[0])?.start === next.start);
        if(label && previous.text === ':')
        {
            gap.text = context.options.lineBreaks.shortCases ? ' ' : context.newline;
            gap.rule = 'lineBreaks.shortCases';
        }

        const parent = next.parent?.text === '{' && context.model.braces.get(next.parent.start);
        if(parent?.compact && !parent.object && !gap.rule && (/[\r\n]/u).test(gap.text))
        {
            gap.text = ' ';
            gap.rule = parent.location === 'lambdas' ? 'lineBreaks.shortLambdas' : 'lineBreaks.shortFunctions';
        }
    },

    /** @description Plans wrapping at top-level argument separators, leaving nested expressions and literal text intact. */
    describeWrapping(context)
    {
        context.binaryWraps = new Map();
        this.describeBinaryWrapping(context);
        context.wraps = new Map();
        const options = context.options.wrapping;
        for(const [ start, kind ] of context.model.parens)
        {
            if(![ 'call', 'declaration' ].includes(kind))
            {
                continue;
            }

            const mode = kind === 'declaration' ? options.parameters : options.arguments;
            if(mode === 'preserve')
            {
                continue;
            }

            const index = context.model.byStart.get(start);
            const open = context.model.codeTokens[index];
            const close = context.model.codeTokens[open.close];
            const tokens = context.model.codeTokens.slice(index + 1, open.close);
            if(tokens.length === 0 || context.model.tokens.some(token => token.comment && token.start > start && token.end < close.end))
            {
                continue;
            }

            const commas = tokens.filter(token => token.text === ',' && token.parent === open);
            const spans = [];
            let argumentStart = open.end;
            for(const comma of [ ...commas, close ])
            {
                spans.push(context.source.slice(argumentStart, comma.start).trim());
                argumentStart = comma.end;
            }

            const compactLength = spans.join(', ').length;
            const original = context.source.slice(open.start, close.end);
            const limit = options.columnLimit;
            const long = limit > 0 && this.column(context.source, open.start) + compactLength + 2 > limit;
            const wrapped = (/[\r\n]/u).test(original);
            const allowAll = kind === 'declaration' ? options.allowAllParametersOnNextLine : options.allowAllArgumentsOnNextLine;
            const canUseNextLine = allowAll && limit > 0 && compactLength + context.options.indentation.continuation + 1 <= limit && !spans.some(span => (/[\r\n]/u).test(span));
            const first = tokens[0];
            const rule = kind === 'declaration' ? 'wrapping.parameters' : 'wrapping.arguments';
            if((long || wrapped) && canUseNextLine)
            {
                context.wraps.set(first.start, { text: context.newline, rule: rule });
                for(const comma of commas)
                {
                    const next = context.model.codeTokens[context.model.byStart.get(comma.start) + 1];
                    context.wraps.set(next.start, { text: ' ', rule: rule });
                }

                continue;
            }

            let column = this.column(context.source, open.start) + 1 + spans[0].length;
            for(const [ argumentIndex, comma ] of commas.entries())
            {
                const next = context.model.codeTokens[context.model.byStart.get(comma.start) + 1];
                const length = spans[argumentIndex + 1].length;
                const newline = mode === 'onePerLine' && (long || wrapped) || mode === 'binPack' && limit > 0 && column + length + 2 > limit;
                context.wraps.set(next.start, { text: newline ? context.newline : ' ', rule: rule });
                column = newline ? context.options.indentation.continuation + length : column + length + 2;
            }
        }
    },

    /** @description Wraps long expression trees at their outer precedence without rewriting any operand. */
    describeBinaryWrapping(context)
    {
        const options = context.options.wrapping;
        if(options.binaryOperations === 'preserve')
        {
            return;
        }

        const expressions = context.model.nodes.filter(record => [ 'BinaryExpression', 'LogicalExpression' ].includes(record.node.type));
        const records = new Map(expressions.map(record => [ record.node, record ]));
        const precedence = [ [ '||', '??' ], ['&&'], ['|'], ['^'], ['&'], [ '==', '!=', '===', '!==' ], [ '<', '>', '<=', '>=', 'in', 'instanceof' ], [ '<<', '>>', '>>>' ], [ '+', '-' ], [ '*', '/', '%' ], ['**'] ];
        for(const record of expressions)
        {
            let root = record;
            while(records.has(root.parent))
            {
                root = records.get(root.parent);
            }

            const rootOperators = precedence.find(group => group.includes(root.node.operator));
            if(options.binaryOperations === 'respectPrecedence' && !rootOperators?.includes(record.node.operator))
            {
                continue;
            }

            const original = context.source.slice(root.start, root.end);
            const width = this.column(context.source, root.start) + original.length;
            const wrapped = (/[\r\n]/u).test(original);
            if(!wrapped && (options.columnLimit === 0 || width <= options.columnLimit))
            {
                continue;
            }

            const left = LgdFormattingModel.range(context.model, record.node.left);
            const right = LgdFormattingModel.range(context.model, record.node.right);
            const operator = left && right && context.model.codeTokens.find(token => token.start >= left.end && token.end <= right.start && token.text === record.node.operator);
            if(!operator || context.model.tokens.some(token => token.comment && token.start >= left.end && token.end <= right.start))
            {
                continue;
            }

            const index = context.model.byStart.get(operator.start);
            const next = context.model.codeTokens[index + 1];
            const before = options.binaryOperators === 'before' || options.binaryOperators === 'beforeNonAssignment';
            context.binaryWraps.set(operator.start, before ? context.newline : ' ');
            context.binaryWraps.set(next.start, before ? ' ' : context.newline);
        }
    },

    /** @description Applies planned expression breaks after generic relocation of preexisting line breaks. */
    binaryGap(context, gap)
    {
        if(context.binaryWraps.has(gap.next.start))
        {
            gap.text = context.binaryWraps.get(gap.next.start);
            gap.rule = 'wrapping.binaryOperations';
            gap.contributors.add('lgd.format.wrapping.binaryOperators');
            gap.contributors.add('lgd.format.wrapping.columnLimit');
        }
    },

    /** @description Wraps argument groups and relocates already-wrapped operators without altering operands. */
    wrapGap(context, gap)
    {
        const { previous, next } = gap;
        const wrapping = context.options.wrapping;
        if(context.model.returnTypes.has(previous.end) && wrapping.returnType !== 'preserve')
        {
            gap.text = wrapping.returnType === 'nextLine' ? context.newline : ' ';
            gap.rule = 'wrapping.returnType';
        }

        const planned = context.wraps.get(next.start);
        if(planned)
        {
            gap.text = planned.text;
            gap.rule = planned.rule;
            gap.contributors.add('lgd.format.wrapping.columnLimit');
            const permission = planned.rule === 'wrapping.parameters' ? 'allowAllParametersOnNextLine' : 'allowAllArgumentsOnNextLine';
            gap.contributors.add(`lgd.format.wrapping.${permission}`);
        }

        if(context.model.constructorColons.has(next.start) || context.model.constructorColons.has(previous.start))
        {
            const mode = wrapping.constructorInitializer;
            if(mode !== 'preserve')
            {
                const breakHere = mode === 'beforeColon' ? next.text === ':' : previous.text === ':';
                gap.text = breakHere ? context.newline : ' ';
                gap.rule = 'wrapping.constructorInitializer';
            }
        }

        if(wrapping.binaryOperators === 'preserve')
        {
            return;
        }

        const operator = binaries.has(previous.text) || assignments.has(previous.text) ? previous : next;
        if(!binaries.has(operator.text) && !assignments.has(operator.text))
        {
            return;
        }

        const index = context.model.byStart.get(operator.start);
        const before = context.model.codeTokens[index - 1];
        const after = context.model.codeTokens[index + 1];
        if(!before || !after)
        {
            return;
        }

        const left = context.source.slice(before.end, operator.start);
        const right = context.source.slice(operator.end, after.start);
        if(!(/^\s*$/u).test(left + right) || !(/[\r\n]/u).test(left + right))
        {
            return;
        }

        const beforeOperator = wrapping.binaryOperators === 'before' || wrapping.binaryOperators === 'beforeNonAssignment' && !assignments.has(operator.text);
        gap.text = next === operator === beforeOperator ? context.newline : ' ';
        gap.rule = 'wrapping.binaryOperators';
    }
};

module.exports = LgdFormattingLayout;
