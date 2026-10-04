const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { maskCode } = require('./LgdInfer');
const { parseTypeName, baseTypeName, tsTypeMap, toTsType } = require('./LgdTypeMaps');
const { skipTrivia } = require('./LgdMethodSignature');
const { skipRegexLiteral } = require('./LgdTypedParams');
const { collectContractBindings } = require('./LgdContractBindings');
const { visibleBindings } = require('./LgdBaseChecker');
const LgdSourceMap = require('./LgdSourceMap');

/** @description Parses C-style casts, converting Number and Boolean operands and erasing reference assertions. */
const LgdCastSyntax = {
    /** @description Lowers casts once while retaining source metadata for the editor and shared type analysis. */
    emit(compiler, content, backend, options)
    {
        const parsed = options.parsed;
        const output = compiler.emitRange(content, backend, compiler.fullRange(content, parsed.declarations));
        const context = { content: content, declarations: parsed.allDeclarations, externals: options.externals || new Map() };
        const emitted = this.lower(output, context, options);
        parsed.casts = emitted.casts;
        compiler.appendTypeErrors(content, parsed.errors, emitted.errors);
        return emitted;
    },

    /** @description Recognizes erased interface references in cast annotations before JavaScript emission. */
    isTypePosition(context, offset)
    {
        if(!context.castHeads)
        {
            const map = { toSource: position => position };
            context.castHeads = this.candidates(context.content, { ...context, map: map });
        }

        return context.castHeads.some(cast => cast.typeStart <= offset && offset < cast.typeEnd);
    },

    /** @description Avoids building lexical context for files without a possible type-cast head. */
    hasHeads(masked)
    {
        return (/\(\s*(?:[$A-Z_a-z][\w$]*\.)*[A-Z][\w$]*\??\s*\)/).test(masked);
    },

    /** @description Distinguishes an expression prefix from a call, parameter list, or control-flow condition. */
    expressionPrefix(masked, start, code)
    {
        const prefix = masked.slice(0, start).trimEnd();
        if(!prefix)
        {
            return true;
        }

        const word = (/[$A-Z_a-z][\w$]*$/).exec(prefix);
        if(word)
        {
            if(prefix.slice(0, word.index).trimEnd().endsWith('.'))
            {
                return false;
            }

            return [ 'return', 'throw', 'yield', 'await', 'case', 'void', 'typeof', 'delete', 'else', 'do', 'default' ].includes(word[0]);
        }

        if(prefix.endsWith(')') || prefix.endsWith('}'))
        {
            return this.statementPrefix(code, masked, start);
        }

        return !(/[\w"$').\]`}]/).test(prefix.slice(-1));
    },

    /** @description Recognizes statement boundaries without changing calls that continue a parenthesized or object expression. */
    statementPrefix(code, masked, start)
    {
        const closing = { '(': ')', '[': ']', '{': '}' };
        const pending = [];
        for(const character of masked.slice(0, start))
        {
            if(Object.hasOwn(closing, character))
            {
                pending.push(closing[character]);
            }
            else if(character === pending[pending.length - 1])
            {
                pending.pop();
            }
        }

        try
        {
            const probe = `${code.slice(0, start)}(~0);${pending.reverse().join('')}`;
            const tree = parser.parse(probe, { sourceType: 'unambiguous', plugins: [ 'jsx', 'typescript' ], allowReturnOutsideFunction: true });
            let statement = false;
            traverse(tree, {
                noScope: true,

                /** @description Identifies the synthetic statement without accepting a continued call expression. */
                ExpressionStatement: path =>
                {
                    if(path.node.expression.start === start + 1)
                    {
                        statement = true;
                    }
                }
            });
            return statement;
        }
        catch
        {
            return false;
        }
    },

    /** @description Finds annotation heads only in code and retains the source grammar's exact type token. */
    candidates(code, context)
    {
        const { content, declarations, externals, map } = context;
        let lexical = code;
        let masked = maskCode(lexical, true);
        if(!this.hasHeads(masked))
        {
            return [];
        }

        const bindings = collectContractBindings(content, declarations, externals).filter(binding => !declarations.some(declaration =>
        {
            const inHead = declaration.headStart <= binding.offset && binding.offset < declaration.nameStart;
            return inHead && binding.name !== declaration.name;
        }));

        const candidates = [];
        for(let start = masked.indexOf('('); start !== -1; start = masked.indexOf('(', start + 1))
        {
            const typeStart = skipTrivia(code, start + 1);
            const type = parseTypeName(masked, typeStart);
            if(!type)
            {
                continue;
            }

            const close = skipTrivia(code, type.end);
            if(code[close] !== ')')
            {
                continue;
            }

            if(!this.expressionPrefix(masked, start, lexical) && !candidates.some(cast => skipTrivia(code, cast.outputHeadEnd) === start))
            {
                continue;
            }

            const operandStart = skipTrivia(code, close + 1);
            const rest = code.slice(operandStart);
            if(!rest || (/^(?:=>|[),:;\]}]|(?:in|instanceof)\b)/).test(rest))
            {
                continue;
            }

            const sourceStart = map.toSource(start);
            const sourceTypeStart = map.toSource(typeStart);
            const visible = visibleBindings(bindings, sourceTypeStart);
            const base = baseTypeName(type.typeName);
            const target = visible.get(base);
            const builtin = Object.hasOwn(tsTypeMap, base);
            const nominal = target?.kind === 'class' || target?.kind === 'interface' || target?.contractKind === 'interface' || target?.kind === 'enum';
            const selfType = Boolean(target?.name && target.name === baseTypeName(target.typeName));
            const root = base.split('.')[0];
            const qualified = base.includes('.') && visible.has(root);
            const known = builtin && !visible.has(base) || nominal || selfType;
            const ambiguous = (/^[%&(*+./<=>?[^`|-]/).test(rest);
            if(ambiguous && !known || !ambiguous && !(/^[\w!"$'`{~]/).test(rest))
            {
                continue;
            }

            // Member access and binary operators retain their JavaScript meaning.
            const division = rest.startsWith('/') && skipRegexLiteral(code, operandStart) === -1;
            if(division || (/^[%&*.<=>?^|]/).test(rest))
            {
                continue;
            }

            candidates.push({ start: sourceStart, typeStart: sourceTypeStart, typeEnd: map.toSource(type.end - 1) + 1,
                typeName: type.typeName, target: target || null, known: known || qualified,
                outputStart: start, outputHeadEnd: close + 1, headEnd: map.toSource(close + 1), operandStart: operandStart });
            const head = lexical.slice(start, close + 1).replace(/[^\n\r]/g, ' ');
            lexical = `${lexical.slice(0, start)}~${head.slice(1)}${lexical.slice(close + 1)}`;
            masked = maskCode(lexical, true);
        }

        return candidates;
    },

    /** @description Uses JavaScript's unary grammar to determine operand precedence, including nested assertions and calls. */
    lower(emitted, context, options = {})
    {
        const map = LgdSourceMap.create(emitted.segments);
        const candidates = this.candidates(emitted.code, { ...context, map: map });
        if(candidates.length === 0)
        {
            return { ...emitted, casts: [], errors: [] };
        }

        let probe = emitted.code;
        for(const cast of candidates.slice().reverse())
        {
            const head = probe.slice(cast.outputStart, cast.outputHeadEnd).replace(/[^\n\r]/g, ' ');
            probe = `${probe.slice(0, cast.outputStart)}~${head.slice(1)}${probe.slice(cast.outputHeadEnd)}`;
        }

        // Unary cast operands may be followed by exponentiation; only the probe needs a binary stand-in.
        const operators = maskCode(probe, true);
        probe = probe.split('').map((character, index) =>
        {
            const exponent = operators.slice(index - 1, index + 1) === '**';
            return exponent ? ' ' : character;
        }).join('');

        const operands = this.operands(probe, candidates, options);
        const casts = [];
        const edits = [];
        for(const cast of candidates)
        {
            const node = operands.get(cast.outputStart);
            if(!node)
            {
                casts.push(cast);
                continue;
            }

            cast.end = map.toSource(node.end - 1) + 1;
            cast.operandStart = map.toSource(node.argument.start);
            casts.push(cast);
            const type = cast.target?.kind === 'class' ? cast.typeName.replace(/\?$/, ' | null') : toTsType(cast.typeName);
            const wrappers = this.wrappers(cast, type, options);
            const head = emitted.code.slice(cast.outputStart, cast.outputHeadEnd);
            const comments = head.match(/\/\*[\S\s]*?\*\/|\/\/[^\n\r]*/g) || [];
            const newline = context.content.includes('\r\n') ? '\r\n' : '\n';
            const prefix = comments.length > 0 ? `(${comments.join(newline)}${newline}${wrappers.prefix}` : wrappers.prefix;
            const suffix = comments.length > 0 ? `${wrappers.suffix})` : wrappers.suffix;
            edits.push({ start: cast.outputStart, end: cast.outputHeadEnd, text: prefix });
            edits.push({ start: node.end, end: node.end, text: suffix });
        }

        const segments = emitted.segments.map(segment => ({ ...segment }));
        const code = LgdSourceMap.applyEdits(emitted.code, segments, edits);
        for(const cast of casts)
        {
            const header = segments.find(segment => !segment.verbatim && segment.srcStart === cast.start && segment.srcEnd === cast.headEnd);
            if(header)
            {
                header.nameSrcStart = cast.start;
                header.nameSrcEnd = cast.start;
            }
        }

        const errors = casts.filter(cast => !cast.known).map(cast => ({ offset: cast.typeStart, endOffset: cast.typeEnd,
            code: 'lgd.cast.unknownType', message: `Unknown cast type '${cast.typeName}'.` }));

        return { code: code, segments: segments, casts: casts, errors: errors };
    },

    /** @description Collects verified unary operands, recovering complete casts before unrelated unfinished syntax. */
    operands(probe, candidates, options)
    {
        const plugins = options.typescript ? ['typescript'] : ['jsx'];
        const operands = new Map();
        try
        {
            const tree = parser.parse(probe, { sourceType: 'unambiguous', plugins: plugins, allowReturnOutsideFunction: true });
            traverse(tree, {
                /** @description Collects each unary cast probe without returning a visitor result. */
                UnaryExpression: path =>
                {
                    operands.set(path.node.start, path.node);
                }
            });
            return operands;
        }
        catch
        {
            for(const cast of candidates)
            {
                const expression = this.recoverExpression(probe, cast.outputStart, plugins);
                if(!expression)
                {
                    continue;
                }

                const tree = { type: 'File', program: { type: 'Program', body: [{ type: 'ExpressionStatement', expression: expression }] } };
                traverse(tree, {
                    noScope: true,

                    /** @description Collects recovered unary cast probes without returning a visitor result. */
                    UnaryExpression: path =>
                    {
                        operands.set(path.node.start, path.node);
                    }
                });
            }

            return operands;
        }
    },

    /** @description Trims only a parser-identified trailing boundary, never an unfinished operand or arbitrary source substring. */
    recoverExpression(probe, start, plugins)
    {
        const options = { plugins: plugins, startIndex: start, allowAwaitOutsideFunction: true, allowYieldOutsideFunction: true };
        try
        {
            return parser.parseExpression(probe.slice(start), options);
        }
        catch(error)
        {
            if(!Number.isInteger(error.pos) || error.pos <= start || error.pos >= probe.length)
            {
                return null;
            }

            try
            {
                return parser.parseExpression(probe.slice(start, error.pos), options);
            }
            catch
            {
                return null;
            }
        }
    },

    /** @description Converts builtin Number and Boolean; other casts retain the original value with compile-time type metadata. */
    wrappers(cast, type, options)
    {
        const targetName = baseTypeName(cast.typeName);
        if(targetName === 'Boolean' && !cast.target)
        {
            const conversion = cast.typeName.endsWith('?')
                ? '((_lgdCastValue) => _lgdCastValue === null ? null : !!_lgdCastValue)('
                : '!!(';

            return { prefix: `(${conversion}`, suffix: '))' };
        }

        if(targetName === 'Number' && !cast.target)
        {
            const conversion = cast.typeName.endsWith('?')
                ? '((_lgdCastValue) => _lgdCastValue === null ? null : globalThis.Number(_lgdCastValue))('
                : 'globalThis.Number(';

            return { prefix: `(${conversion}`, suffix: '))' };
        }

        if(options.typescript)
        {
            return { prefix: '((', suffix: `) as unknown as ${type})` };
        }

        return { prefix: `/** @type {${type}} */ (/** @type {unknown} */ (`, suffix: '))' };
    },

    /** @description Finds the outer assertion attached to a parenthesized expression without mistaking its children for assertions. */
    forPath(path, context)
    {
        const start = path.node?.extra?.parenStart;
        if(!Number.isInteger(start))
        {
            return null;
        }

        const sourceStart = context.map.toSource(start);
        const sourceEnd = context.map.toSource(path.node.end);
        const found = context.casts?.find(cast =>
        {
            if(context.ignoredCasts?.has(cast.start) || sourceEnd < cast.operandStart || sourceEnd > cast.end)
            {
                return false;
            }

            const leading = context.content.slice(sourceStart, cast.start);
            const outerGrouping = sourceStart < cast.start && (/^[\s(]*$/).test(maskCode(leading));
            return sourceStart === cast.start || outerGrouping;
        });

        return found || null;
    }
};

module.exports = LgdCastSyntax;
