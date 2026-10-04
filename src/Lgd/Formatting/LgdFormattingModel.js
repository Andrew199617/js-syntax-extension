const parser = require('@babel/parser');
const LgdCompiler = require('../../Compilers/LgdCompiler');
const LgdCastSyntax = require('../../Compilers/LgdCastSyntax');
const JsBackend = require('../../Compilers/JsBackend');
const LgdSourceMap = require('../../Compilers/LgdSourceMap');

/** @description Operators must be matched longest-first to avoid changing lexical meaning. */
const tokenPattern = /(?:===|!==|>>>|\*\*=|&&=|\|\|=|\?\?=|=>|==|!=|<=|>=|\+\+|--|&&|\|\||\?\?|\?\.|\*\*|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\.\.\.|[$\p{ID_Start}][$\p{ID_Continue}]*|(?:\d[\w.]*|\.\d[\w.]*)|[^\s])/uy;

/** @description Builds source-aware formatting context using the existing LGD parser and emitted JavaScript AST. */
const LgdFormattingModel = {
    /** @description Reads only syntactically valid source; recovery nodes never authorize formatting edits. */
    create(source)
    {
        try
        {
            const compiler = LgdCompiler.create();
            const parsed = compiler.parse(source, new Map(), { deferAnalysis: true });
            const emitted = LgdCastSyntax.emit(compiler, source, JsBackend.create(compiler.detectNewline(source)), { parsed: parsed, externals: new Map() });
            const tree = parser.parse(emitted.code, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
            const model = {
                source: source, parsed: parsed, casts: parsed.casts || [], emitted: emitted, tree: tree, map: LgdSourceMap.create(emitted.segments),
                protected: [], nodes: [], braces: new Map(), parens: new Map(), controls: [], cases: [], labels: new Set(),
                heritageColons: new Set(), constructorColons: new Set(), functionParens: new Set(), doWhileKeywords: new Set(),
                conditionalTokens: new Set(), returnTypes: new Set(), declarationHeads: [], declarationGaps: new Set(), importStarts: new Map(), importEnds: new Map()
            };
            this.collectNodes(model, tree, null, '');
            model.tokens = this.tokenize(model);
            if(!model.tokens)
            {
                return null;
            }

            model.codeTokens = model.tokens.filter(token => !token.comment);
            model.byStart = new Map(model.codeTokens.map((token, index) => [ token.start, index ]));
            if(!this.matchPairs(model))
            {
                return null;
            }

            this.classify(model);
            return model;
        }
        catch(error)
        {
            if(!(error instanceof SyntaxError))
            {
                throw error;
            }

            return null;
        }
    },

    /** @description Ignores only source positions, comments and compiler-generated offset suffixes in semantic comparisons. */
    signature(model)
    {
        return JSON.stringify(model.tree, (key, value) =>
        {
            if([ 'start', 'end', 'loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'errors' ].includes(key))
            {
                return;
            }

            if(key === 'name' && typeof value === 'string')
            {
                return value.replace(/^(?<prefix>_lgd(?:Class|BaseClass)[$\w]*_)\d+$/u, '$<prefix>offset');
            }

            const controlBody = [ 'body', 'consequent', 'alternate' ].includes(key);
            const singleStatement = value?.type === 'BlockStatement' && value.body.length === 1;
            const safeTypes = [ 'ExpressionStatement', 'ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement', 'EmptyStatement' ];
            if(controlBody && singleStatement && safeTypes.includes(value.body[0].type))
            {
                return value.body[0];
            }

            return value;
        });
    },

    /** @description Requires exact characters at mapped AST boundaries, rejecting synthetic compiler ranges. */
    range(model, node)
    {
        if(!Number.isInteger(node.start) || !Number.isInteger(node.end) || node.end <= node.start)
        {
            return null;
        }

        const start = model.map.toSource(node.start);
        const end = model.map.toSource(node.end - 1) + 1;
        if(end <= start || model.source[start] !== model.emitted.code[node.start] || model.source[end - 1] !== model.emitted.code[node.end - 1])
        {
            return null;
        }

        return { start: start, end: end };
    },

    /** @description Retains AST relationships and opaque literals, including complete nested template and JSX bodies. */
    collectNodes(model, node, parent, key)
    {
        if(!node || typeof node !== 'object')
        {
            return;
        }

        if(typeof node.type === 'string')
        {
            const span = this.range(model, node);
            if(span)
            {
                model.nodes.push({ node: node, parent: parent, key: key, ...span });
                if([ 'StringLiteral', 'NumericLiteral', 'BigIntLiteral', 'RegExpLiteral', 'TemplateLiteral', 'JSXElement', 'JSXFragment' ].includes(node.type))
                {
                    model.protected.push({ ...span, type: node.type });
                }
            }
        }

        for(const [ childKey, child ] of Object.entries(node))
        {
            if([ 'loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments' ].includes(childKey))
            {
                continue;
            }

            if(Array.isArray(child))
            {
                for(const entry of child)
                {
                    this.collectNodes(model, entry, node, childKey);
                }
            }
            else if(child && typeof child === 'object')
            {
                this.collectNodes(model, child, node, childKey);
            }
        }
    },

    /** @description Tokenizes original LGD syntax while treating comments, regex, strings, templates and JSX as opaque. */
    tokenize(model)
    {
        const source = model.source;
        const protectedSpans = model.protected.sort((first, second) => first.start - second.start || second.end - first.end);
        const opaque = new Map();
        for(const span of protectedSpans)
        {
            if(!opaque.has(span.start))
            {
                opaque.set(span.start, span);
            }
        }

        const tokens = [];
        let cursor = 0;
        while(cursor < source.length)
        {
            if((/\s/u).test(source[cursor]))
            {
                cursor++;
                continue;
            }

            const start = cursor;
            const literal = opaque.get(cursor);
            let comment = false;
            if(literal)
            {
                cursor = literal.end;
            }
            else if(source.startsWith('//', cursor))
            {
                const newline = source.slice(cursor).search(/[\r\n]/u);
                cursor = newline === -1 ? source.length : cursor + newline;
                comment = true;
            }
            else if(source.startsWith('/*', cursor))
            {
                const close = source.indexOf('*/', cursor + 2);
                if(close === -1)
                {
                    return null;
                }

                cursor = close + 2;
                comment = true;
            }
            else if(source[cursor] === '"' || source[cursor] === "'")
            {
                const quote = source[cursor++];
                while(cursor < source.length && source[cursor] !== quote)
                {
                    cursor += source[cursor] === '\\' ? 2 : 1;
                }

                if(source[cursor++] !== quote)
                {
                    return null;
                }
            }
            else if(source[cursor] === '`')
            {
                return null;
            }
            else
            {
                tokenPattern.lastIndex = cursor;
                const match = tokenPattern.exec(source);
                if(!match)
                {
                    return null;
                }

                cursor += match[0].length;
            }

            const isLiteral = Boolean(literal) || source[start] === '"' || source[start] === "'";
            tokens.push({ start: start, end: cursor, text: source.slice(start, cursor), comment: comment, literal: isLiteral });
        }

        return tokens;
    },

    /** @description Pairs delimiters outside opaque spans and refuses malformed nesting. */
    matchPairs(model)
    {
        const stack = [];
        const closes = { ')': '(', ']': '[', '}': '{' };
        for(const [ index, token ] of model.codeTokens.entries())
        {
            if(token.literal)
            {
                continue;
            }

            if([ '(', '[', '{' ].includes(token.text))
            {
                token.index = index;
                token.parent = stack.at(-1);
                stack.push(token);
            }
            else if(Object.hasOwn(closes, token.text))
            {
                const open = stack.pop();
                if(!open || open.text !== closes[token.text])
                {
                    return false;
                }

                open.close = index;
                token.open = open.index;
                token.parent = open.parent;
            }
            else
            {
                token.parent = stack.at(-1);
            }
        }

        return stack.length === 0;
    },

    /** @description Classifies LGD-only declaration braces before augmenting regular JavaScript statement contexts. */
    classify(model)
    {
        for(const declaration of model.parsed.allDeclarations)
        {
            if(![ 'class', 'interface', 'enum' ].includes(declaration.kind))
            {
                model.declarationHeads.push({ start: declaration.headStart, end: declaration.initializerStart });
                model.declarationGaps.add(`${declaration.typeEnd}:${declaration.nameStart}`);
                const keyword = model.codeTokens.findLast(token => token.start >= declaration.headStart && token.end <= declaration.typeStart);
                if(keyword && [ 'const', 'let', 'readonly' ].includes(keyword.text))
                {
                    model.declarationGaps.add(`${keyword.end}:${declaration.typeStart}`);
                }
            }

            if([ 'class', 'interface', 'enum' ].includes(declaration.kind))
            {
                const locations = { class: 'classes', interface: 'interfaces', enum: 'enums' };
                const location = locations[declaration.kind];
                if(declaration.heritage?.length > 0)
                {
                    const colon = model.codeTokens.find(token => token.start >= declaration.nameEnd && token.start < declaration.initializerStart && token.text === ':');
                    if(colon)
                    {
                        model.heritageColons.add(colon.start);
                    }
                }

                model.braces.set(declaration.initializerStart, { location: location, definition: true, headStart: declaration.headStart });
                for(const member of declaration.classMembers || [])
                {
                    if(!member.isConstructor && member.returnTypeName && Number.isInteger(member.returnTypeEnd))
                    {
                        model.returnTypes.add(declaration.initializerStart + member.returnTypeEnd);
                    }

                    if(member.kind === 'field' && Number.isInteger(member.propertyTypeEnd))
                    {
                        const typeEnd = declaration.initializerStart + member.propertyTypeEnd;
                        model.declarationGaps.add(`${typeEnd}:${member.nameStart}`);
                        model.declarationHeads.push({ start: member.start, end: member.initializerStart ?? member.nameEnd });
                    }

                    let memberLocation = 'methods';
                    if(member.isConstructor)
                    {
                        memberLocation = 'constructors';
                    }
                    else if(member.accessor)
                    {
                        memberLocation = 'accessors';
                    }

                    if(model.source[member.bodyStart] === '{')
                    {
                        model.braces.set(member.bodyStart, { location: memberLocation, definition: true, headStart: member.start });
                    }

                    model.parens.set(member.paramStart, 'declaration');
                    if(member.baseArgumentsStart !== null && member.baseArgumentsStart !== undefined)
                    {
                        const colon = model.codeTokens.find(token => token.start >= member.paramEnd && token.start < member.bodyStart && token.text === ':');
                        if(colon)
                        {
                            model.constructorColons.add(colon.start);
                        }
                    }
                }
            }
        }

        for(const record of model.nodes)
        {
            this.classifyNode(model, record);
        }

        for(const cast of model.casts)
        {
            model.parens.set(cast.start, 'cast');
        }

        for(const [ index, token ] of model.codeTokens.entries())
        {
            if(token.text === '(' && !model.parens.has(token.start))
            {
                const previous = model.codeTokens[index - 1];
                let kind = 'other';
                if(previous && [ 'if', 'while', 'for', 'switch', 'catch', 'with' ].includes(previous.text))
                {
                    kind = previous.text === 'for' ? 'for' : 'control';
                }
                else if(previous && (/^(?:[$\p{ID_Start}]|\)|\])/u).test(previous.text))
                {
                    kind = 'call';
                }

                model.parens.set(token.start, kind);
            }
        }
    },

    /** @description Adds structural locations only when original source delimiters agree with mapped AST positions. */
    classifyNode(model, record)
    {
        const { node, parent, key, start, end } = record;
        if(node.type === 'DoWhileStatement')
        {
            const body = this.range(model, node.body);
            const keyword = body && model.codeTokens.find(token => token.start >= body.end && token.start < end && token.text === 'while');
            if(keyword)
            {
                model.doWhileKeywords.add(keyword.start);
            }
        }

        if(node.type === 'ConditionalExpression')
        {
            for(const [ branch, punctuation ] of [ [ 'consequent', '?' ], [ 'alternate', ':' ] ])
            {
                const span = this.range(model, node[branch]);
                const token = span && model.codeTokens.findLast(candidate => candidate.end <= span.start && candidate.start >= start);
                if(token?.text === punctuation)
                {
                    model.conditionalTokens.add(token.start);
                }
            }
        }

        if(node.type === 'VariableDeclaration' && node.declarations.length > 0)
        {
            const binding = this.range(model, node.declarations[0].id);
            const keyword = model.codeTokens.find(token => token.start === start && token.text === node.kind);
            if(keyword && binding)
            {
                model.declarationGaps.add(`${keyword.end}:${binding.start}`);
                model.declarationHeads.push({ start: keyword.start, end: binding.start });
            }
        }

        if(node.type === 'VariableDeclarator' && node.init)
        {
            const initializer = this.range(model, node.init);
            if(initializer)
            {
                model.declarationHeads.push({ start: start, end: initializer.start });
            }
        }

        if(parent?.type === 'Program')
        {
            let moduleName = node.type === 'ImportDeclaration' ? node.source?.value : null;
            const expression = node.type === 'VariableDeclaration' && node.declarations.length === 1 ? node.declarations[0].init : node.expression;
            if(expression?.type === 'CallExpression' && expression.callee.type === 'Identifier' && expression.callee.name === 'require' && expression.arguments.length === 1)
            {
                moduleName = expression.arguments[0].type === 'StringLiteral' ? expression.arguments[0].value : null;
            }

            if(typeof moduleName === 'string')
            {
                const group = moduleName.startsWith('.') || moduleName.startsWith('/') ? 'relative' : 'external';
                model.importStarts.set(start, group);
                model.importEnds.set(end, group);
            }
        }

        if(node.type === 'SwitchCase')
        {
            model.cases.push(record);
        }

        if(node.type === 'LabeledStatement')
        {
            model.labels.add(start);
        }

        if([ 'ObjectExpression', 'ObjectPattern', 'BlockStatement', 'SwitchStatement' ].includes(node.type))
        {
            let braceStart = start;
            let location = node.type === 'ObjectPattern' ? 'objectPatterns' : 'objectLiterals';
            if(node.type === 'BlockStatement')
            {
                location = this.blockLocation(parent, key);
            }
            else if(node.type === 'SwitchStatement')
            {
                const discriminant = this.range(model, node.discriminant);
                const brace = model.codeTokens.find(token => token.start > (discriminant?.end || start) && token.start < end && token.text === '{');
                braceStart = brace?.start;
                location = 'switchBlocks';
            }

            if(model.source[braceStart] === '{' && !model.braces.has(braceStart))
            {
                const argumentParent = model.nodes.find(entry => entry.node === parent)?.parent;
                const inlineArgument = location === 'lambdas' && [ 'CallExpression', 'NewExpression' ].includes(argumentParent?.type);
                const headStart = parent && this.range(model, parent)?.start;
                model.braces.set(braceStart, {
                    location: location, definition: [ 'functions', 'lambdas', 'methods', 'accessors' ].includes(location),
                    inlineArgument: inlineArgument, headStart: headStart ?? start
                });
            }
        }

        if([ 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod' ].includes(node.type) && node.body)
        {
            const body = this.range(model, node.body);
            const beforeBody = model.codeTokens.findLast(token => token.start >= start && token.end <= (body?.start || end) && token.text === ')');
            const open = beforeBody && model.codeTokens[beforeBody.open];
            if(open)
            {
                model.parens.set(open.start, 'declaration');
                if([ 'FunctionDeclaration', 'FunctionExpression' ].includes(node.type))
                {
                    model.functionParens.add(open.start);
                }
            }
        }

        if([ 'IfStatement', 'WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement' ].includes(node.type))
        {
            for(const branch of [ 'consequent', 'alternate', 'body' ])
            {
                const statement = node[branch];
                const span = statement && this.range(model, statement);
                if(span && statement.type !== 'BlockStatement' && !(branch === 'alternate' && statement.type === 'IfStatement'))
                {
                    model.controls.push({ ...span, statement: statement, parent: node, branch: branch });
                }
            }
        }
    },

    /** @description Distinguishes every supported statement and member brace location. */
    blockLocation(parent, key)
    {
        if(!parent)
        {
            return 'controlBlocks';
        }

        if(parent.type === 'ArrowFunctionExpression')
        {
            return 'lambdas';
        }

        if([ 'FunctionDeclaration', 'FunctionExpression' ].includes(parent.type))
        {
            return 'functions';
        }

        if([ 'ObjectMethod', 'ClassMethod' ].includes(parent.type))
        {
            return [ 'get', 'set' ].includes(parent.kind) ? 'accessors' : 'methods';
        }

        if(parent.type === 'CatchClause')
        {
            return 'catchBlocks';
        }

        if(parent.type === 'TryStatement')
        {
            return key === 'finalizer' ? 'finallyBlocks' : 'tryBlocks';
        }

        if(parent.type === 'IfStatement' && key === 'alternate')
        {
            return 'elseBlocks';
        }

        if(parent.type === 'SwitchCase')
        {
            return 'caseBlocks';
        }

        return 'controlBlocks';
    }
};

module.exports = LgdFormattingModel;
