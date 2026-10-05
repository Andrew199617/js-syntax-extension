const LgdConstructorOverloadEmitter = require('./LgdConstructorOverloadEmitter');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const LgdClassSyntax = require('./LgdClassSyntax');
const LgdClassFields = require('./LgdClassFields');
const LgdBaseCalls = require('./LgdBaseCalls');
const LgdBaseChecker = require('./LgdBaseChecker');
const LgdSourceMap = require('./LgdSourceMap');
const { maskCode } = require('./LgdInfer');

/** @description Emits the opt-in native JavaScript class object model from shared LGD declaration records. */
const LgdNativeClassEmitter = {
    /** @description Reports established object bases and OLOO-only dispatch that native classes cannot represent. */
    check(content, declarations, externals, analysis)
    {
        if(!declarations.some(declaration => declaration.kind === 'class'))
        {
            return [];
        }

        const masked = maskCode(content, true);
        const scopes = LgdBaseChecker.collectScopes(masked);
        const bindings = LgdBaseChecker.collectBindings({ content: content, masked: masked, declarations: declarations, scopes: scopes, externals: externals });
        const errors = [];
        for(const declaration of declarations)
        {
            const prototypeField = declaration.classMembers?.find(member => member.kind === 'field' && member.static && member.name === 'prototype');
            if(prototypeField)
            {
                errors.push({ offset: prototypeField.nameStart, endOffset: prototypeField.nameEnd, code: 'lgd.output.staticPrototype',
                    message: 'Native class output reserves the static name prototype. Rename this field or select OLOO output.' });
            }

            if(declaration.kind !== 'class' || !declaration.baseName)
            {
                continue;
            }

            if(declaration.hasDeclaredInstanceFieldsInHierarchy)
            {
                errors.push({ offset: declaration.baseStart, endOffset: declaration.baseEnd, code: 'lgd.output.fieldInitializationOrder',
                    message: 'Native class output cannot preserve C# declared instance-field initialization order across inheritance. Use OLOO output for this class hierarchy.' });
            }

            const visible = LgdBaseChecker.visibleBindings(bindings, declaration.headStart);
            const base = visible.get(declaration.baseName);
            if(base && base.kind !== 'class' && (base.keyword === 'Object' || base.typeName === 'Object' || base.initializerText?.trim().startsWith('{')))
            {
                errors.push({ offset: declaration.baseStart, endOffset: declaration.baseEnd, code: 'lgd.output.objectBase',
                    message: `Native class output does not support object base '${declaration.baseName}'. Use OLOO output or inherit from an LGD class.` });
            }
        }

        if(!analysis.tree)
        {
            // The final-output validator has already reported invalid JavaScript.
            return errors;
        }

        const map = LgdSourceMap.create(analysis.emitted.segments);
        function inspectDispatch(path)
        {
            const node = path.node;
            const isOloo = node.object.type === 'Identifier' && node.object.name === 'Oloo';
            const isBase = node.computed ? node.property.type === 'StringLiteral' && node.property.value === 'base' : node.property.name === 'base';
            if(!isOloo || !isBase)
            {
                return;
            }

            const offset = map.toSource(node.start);
            if(LgdBaseCalls.ownerAt(declarations, offset))
            {
                errors.push({ offset: offset, endOffset: map.toSource(node.end), code: 'lgd.output.olooDispatch',
                    message: 'Native class output does not support Oloo.base dispatch. Use base.method(...) or select OLOO output.' });
            }
        }

        traverse(analysis.tree, { MemberExpression: inspectDispatch, OptionalMemberExpression: inspectDispatch });
        return errors;
    },

    /** @description Emits native class syntax while retaining typed documentation, nested declarations and source mappings. */
    emit(content, backend, declaration, compiler)
    {
        const context = { content: content, backend: backend, declaration: declaration, compiler: compiler, syntax: LgdClassSyntax };
        const output = { code: '', segments: [] };
        if(declaration.kind === 'interface')
        {
            LgdClassSyntax.appendGenerated(output, '', declaration.start, { end: declaration.end });
            return output;
        }

        const newline = compiler.detectNewline(content);
        const comment = declaration.jsdoc ? `${declaration.jsdoc}${newline}` : '';
        const prefix = `${comment}${declaration.indent}${declaration.exported ? 'export ' : ''}class `;
        LgdClassSyntax.appendGenerated(output, `${prefix}${declaration.name}`, declaration.start, {
            end: declaration.baseStart === null ? declaration.initializerStart : declaration.baseStart,
            name: { srcStart: declaration.nameStart, srcEnd: declaration.nameEnd, outStart: prefix.length, outEnd: prefix.length + declaration.name.length }
        });
        if(declaration.baseName)
        {
            LgdClassSyntax.appendGenerated(output, ' extends ', declaration.baseStart);
            LgdClassSyntax.appendGenerated(output, declaration.baseName, declaration.baseStart, {
                end: declaration.baseEnd,
                name: { srcStart: declaration.baseStart, srcEnd: declaration.baseEnd, outStart: 0, outEnd: declaration.baseName.length }
            });
        }

        LgdClassSyntax.appendGenerated(output, ' {', declaration.initializerStart, { end: declaration.initializerStart + 1 });
        this.emitFactory(output, context);
        let cursor = declaration.initializerStart + 1;
        for(const member of declaration.classMembers)
        {
            const memberStart = member.abstract ? member.erasureStart ?? member.start : member.start;
            if(member.isConstructor && member !== declaration.constructorMember)
            {
                const prefixStart = LgdConstructorOverloadEmitter.memberPrefixStart(context, member);
                LgdClassSyntax.appendSource(output, context, cursor, prefixStart);
                cursor = member.bodyEnd;
                continue;
            }

            LgdClassSyntax.appendMemberPrefix(output, context, cursor, member);
            if(member.abstract)
            {
                LgdClassSyntax.appendGenerated(output, '', memberStart, { end: member.bodyEnd });
            }
            else if(member.kind === 'field')
            {
                LgdClassSyntax.appendGenerated(output, '', memberStart);
            }
            else if(member.isConstructor)
            {
                if(declaration.constructorMembers.length < 2)
                {
                    this.emitConstructor(output, context, member);
                }
                else if(member === declaration.constructorMember)
                {
                    LgdConstructorOverloadEmitter.emitNative(output, context);
                }
            }
            else
            {
                LgdClassSyntax.emitMethod(output, context, { ...member, modifierSpans: member.modifierSpans.filter(span => span.start !== member.staticStart) });
            }

            cursor = member.bodyEnd;
        }

        if(!declaration.constructorMember)
        {
            this.emitConstructor(output, context, null);
        }

        LgdClassFields.emitInstanceInitializer(output, context);
        LgdClassSyntax.appendSource(output, context, cursor, declaration.initializerEnd);
        LgdClassFields.emitRuntimeAliases(output, context);
        LgdClassFields.emitStaticFields(output, context);
        if(declaration.baseCalls?.length > 0)
        {
            output.code = LgdBaseCalls.rewrite(declaration, output.code, output.segments);
            const helper = `${newline}${declaration.indent}/** @returns {${declaration.baseName}} */`
                + `${newline}${declaration.indent}const ${declaration.baseOwnerName} = () => Object.getPrototypeOf(${declaration.name}.prototype);`;
            LgdClassSyntax.appendGenerated(output, helper, declaration.end);
        }

        const groups = declaration.methodTypedParams.filter(group => !group.abstract).map(group =>
        {
            if(declaration.constructorMembers.length > 1 && group.name === 'create')
            {
                return { ...group, methodStart: undefined };
            }

            return group;
        });

        const concrete = { ...declaration, methodTypedParams: groups };
        output.code = backend.rewriteInitializer(concrete, output.code, output.segments);
        const constructorMember = declaration.constructorMember;
        if(constructorMember && (/\breturn\b/).test(maskCode(content.slice(constructorMember.bodyStart, constructorMember.bodyEnd), true)))
        {
            output.code = this.rewriteConstructorReturns(output.code, output.segments);
        }

        return output;
    },

    /** @description Builds a native constructor retaining LGD initialization order and arguments behavior. */
    emitConstructor(output, context, member)
    {
        const declaration = context.declaration;
        const anchor = member ? member.nameStart : declaration.nameStart;
        const newline = context.compiler.detectNewline(context.content);
        const indent = `${declaration.indent}    `;
        if(member)
        {
            LgdClassSyntax.appendGenerated(output, 'constructor', member.nameStart, {
                end: member.nameEnd,
                name: { srcStart: member.nameStart, srcEnd: member.nameEnd, outStart: 0, outEnd: 'constructor'.length }
            });
            LgdClassSyntax.appendSource(output, context, member.nameEnd, member.paramEnd);
        }
        else
        {
            LgdClassSyntax.appendGenerated(output, `${newline}${indent}constructor()`, anchor);
        }

        LgdClassSyntax.appendGenerated(output, ` {${newline}`, anchor);
        if(declaration.baseName)
        {
            LgdClassSyntax.appendGenerated(output, `${indent}    super(`, anchor);
            if(member && member.baseArgumentsStart !== null)
            {
                LgdClassSyntax.appendSource(output, context, member.baseArgumentsStart, member.baseArgumentsEnd);
            }

            LgdClassSyntax.appendGenerated(output, `);${newline}`, anchor);
        }

        LgdClassFields.emitInstanceInitializerCall(output, context, 'this');
        if(member)
        {
            LgdClassSyntax.appendSource(output, context, member.bodyStart + 1, member.bodyEnd - 1);
            LgdClassSyntax.appendGenerated(output, newline, member.bodyEnd - 1);
        }

        LgdClassSyntax.appendGenerated(output, `${indent}}`, member ? member.bodyEnd - 1 : anchor, { end: member ? member.bodyEnd : anchor });
    },

    /** @description Retains editor recovery for rejected constructor value returns without changing nested returns or instance-field inference. */
    rewriteConstructorReturns(code, segments)
    {
        let tree;
        try
        {
            tree = parser.parse(code, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
        }
        catch
        {
            return code;
        }

        const edits = [];
        traverse(tree, {
            /** @description Lowers value returns belonging directly to a native constructor. */
            ReturnStatement: path =>
            {
                const owner = path.getFunctionParent();
                if(!path.node.argument || !owner?.isClassMethod() || owner.node.kind !== 'constructor')
                {
                    return;
                }

                const statement = path.node;
                const terminated = code[statement.end - 1] === ';';
                const suffixStart = terminated ? statement.end - 1 : statement.end;
                edits.push({ start: statement.start, end: statement.start + 'return'.length, text: '{ void (' });
                edits.push({ start: suffixStart, end: statement.end, text: '); return; }' });
            }
        });
        return LgdSourceMap.applyEdits(code, segments, edits);
    },

    /** @description Retains the create caller API and derives its argument tuple from the native constructor signature. */
    emitFactory(output, context)
    {
        const declaration = context.declaration;
        const newline = context.compiler.detectNewline(context.content);
        const indent = `${declaration.indent}    `;
        const text = `${newline}${indent}/**${newline}${indent} * @param {ConstructorParameters<typeof ${declaration.name}>} args`
            + `${newline}${indent} * @returns {${declaration.name}}${newline}${indent} */`
            + `${newline}${indent}static create(...args) { return new this(...args); }`;
        LgdClassSyntax.appendGenerated(output, text, declaration.initializerEnd - 1);
    }
};

module.exports = LgdNativeClassEmitter;
