const LgdCompiler = require('../../Compilers/LgdCompiler');
const LgdFormattingModel = require('./LgdFormattingModel');

/** @description Arrow body conversion is opt-in and preserves lexical receiver, arguments and return contracts. */
const LgdArrowStyles = {
    /** @description Converts only exact mapped arrow bodies with a single value-return and no directives or comments. */
    analyze(context, analyzer, entry)
    {
        const mode = context.options.lambdaBodies;
        const node = entry.node;
        if(!mode || mode === 'preserve' || node.type !== 'ArrowFunctionExpression' || !analyzer.text(context, node))
        {
            return;
        }

        const body = node.body;
        const block = body.type === 'BlockStatement';
        if(mode === 'never' && block || mode !== 'never' && !block)
        {
            return;
        }

        let expression = body;
        if(block)
        {
            if(body.directives.length > 0 || body.body.length !== 1 || body.body[0].type !== 'ReturnStatement' || !body.body[0].argument)
            {
                return;
            }

            expression = body.body[0].argument;
        }

        const expressionText = analyzer.text(context, expression);
        const arrowRange = LgdFormattingModel.range(context.model, node);
        const bodyRange = LgdFormattingModel.range(context.model, body);
        if(!expressionText || !arrowRange || !bodyRange || mode === 'when_on_single_line' && (/[\r\n]/u).test(expressionText))
        {
            return;
        }

        const arrow = context.model.codeTokens.findLast(token => token.start >= arrowRange.start && token.end <= bodyRange.start && token.text === '=>');
        if(!arrow)
        {
            return;
        }

        const start = arrow.end;
        const original = context.source.slice(start, arrowRange.end);
        const expressionBody = ` (${expressionText})`;
        const blockBody = ` { return (${expressionText}); }`;
        const newText = block ? expressionBody : blockBody;
        if(original === newText)
        {
            return;
        }

        const preview = context.source.slice(0, start) + newText + context.source.slice(arrowRange.end);
        const checked = LgdFormattingModel.create(preview);
        if(!checked || this.signature(checked) !== this.signature(context.model) || !this.sameContracts(context, preview))
        {
            return;
        }

        analyzer.add(context, 'lambdaBodies', node, { newText: newText, range: { start: start, end: arrowRange.end } });
    },

    /** @description Normalizes only the proven arrow expression/single-return equivalence before complete tree comparison. */
    signature(model)
    {
        const tree = JSON.parse(JSON.stringify(model.tree));
        this.normalize(tree);
        return LgdFormattingModel.signature({ ...model, tree: tree });
    },

    /** @description Preserves every other node and strict-mode directive while canonicalizing arrow returns. */
    normalize(node)
    {
        if(!node || typeof node !== 'object')
        {
            return;
        }

        const body = node.body;
        const returnBlock = body?.type === 'BlockStatement' && body.directives.length === 0 && body.body.length === 1;
        const statement = returnBlock ? body.body[0] : null;
        const singleReturn = statement?.type === 'ReturnStatement' && statement.argument;
        if(node.type === 'ArrowFunctionExpression' && singleReturn)
        {
            node.body = body.body[0].argument;
        }

        for(const child of Object.values(node))
        {
            if(Array.isArray(child))
            {
                child.forEach(entry => this.normalize(entry));
            }
            else if(child && typeof child === 'object')
            {
                this.normalize(child);
            }
        }
    },

    /** @description Full compiler checks must succeed without changing declared member or parameter contracts. */
    sameContracts(context, preview)
    {
        const compiler = LgdCompiler.create();
        context.arrowCompilation ||= compiler.compileToJs(context.source);
        const compiled = compiler.compileToJs(preview);
        if(context.arrowCompilation.errors.length > 0 || compiled.errors.length > 0)
        {
            return false;
        }

        return this.contracts(context.arrowCompilation) === this.contracts(compiled);
    },

    /** @description Compares semantic declaration metadata independently of source positions and body layout. */
    contracts(compiled)
    {
        return JSON.stringify(compiled.allDeclarations.map(declaration => ({
            name: declaration.name, type: declaration.typeName, readonly: declaration.readonly, exported: declaration.exported,
            parameters: this.parameters(declaration.typedParams?.params), returns: declaration.typedParams?.returnTypeName,
            members: (declaration.classMembers || []).map(member => ({ name: member.name, kind: member.kind,
                accessibility: member.accessibility, static: member.static, readonly: member.readonly,
                returns: member.returnTypeName, parameters: this.parameters(member.params) }))
        })));
    },

    /** @description Keeps parameter names, optional initializers, rest status and type annotations unchanged. */
    parameters(parameters)
    {
        return (parameters || []).map(parameter => ({ name: parameter.name, type: parameter.typeName,
            rest: parameter.rest, defaultText: parameter.defaultText }));
    }
};

module.exports = LgdArrowStyles;
