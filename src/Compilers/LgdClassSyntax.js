const { maskCode } = require('./LgdInfer');
const { parseTypedParams } = require('./LgdTypedParams');

/** @description Reads LGD class declarations and lowers them to prototype objects with create factories. */
const LgdClassSyntax = {
    /** @description Finds balanced parentheses or braces in already-masked source. */
    findClose(masked, start)
    {
        const open = masked[start];
        const close = open === '(' ? ')' : '}';
        let depth = 0;
        for(let index = start; index < masked.length; index++)
        {
            if(masked[index] === open)
            {
                depth++;
            }
            else if(masked[index] === close)
            {
                depth--;
                if(depth === 0)
                {
                    return index;
                }
            }
        }

        return -1;
    },

    /** @description Skips whitespace and masked comments. */
    skipSpace(masked, start)
    {
        let index = start;
        while(index < masked.length && (/\s/).test(masked[index]))
        {
            index++;
        }

        return index;
    },

    /** @description Collects class declarations while preserving absolute source offsets. */
    parse(content, compiler)
    {
        const masked = maskCode(content);
        const pattern = /^(?<indent>[\t ]*)(?<exportKeyword>export[\t ]+)?class[\t ]+(?<name>[$A-Z_a-z][\w$]*)\b/gm;
        const declarations = [];
        const errors = [];
        let match = pattern.exec(masked);
        while(match)
        {
            const parsed = this.parseDeclaration(content, masked, match, compiler);
            if(parsed.error)
            {
                errors.push(compiler.createError(content, parsed.offset, parsed.error));
            }
            else
            {
                declarations.push(parsed.declaration);
                for(const error of parsed.errors)
                {
                    errors.push(compiler.createError(content, error.offset, error.message));
                }
            }

            match = pattern.exec(masked);
        }

        return { declarations: declarations, errors: errors };
    },

    /** @description Parses one named class and its optional colon-style base. */
    parseDeclaration(content, masked, match, compiler)
    {
        const name = match.groups.name;
        const nameEnd = match.index + match[0].length;
        const nameStart = nameEnd - name.length;
        let cursor = this.skipSpace(masked, nameEnd);
        let baseName = null;
        let baseStart = null;
        if(masked[cursor] === ':')
        {
            cursor = this.skipSpace(masked, cursor + 1);
            const base = (/^(?<name>[$A-Z_a-z][\w$]*(?:\.[$A-Z_a-z][\w$]*)*)/).exec(masked.slice(cursor));
            if(!base)
            {
                return { error: 'Expected a base object name after ":".', offset: cursor };
            }

            baseName = base.groups.name;
            baseStart = cursor;
            cursor = this.skipSpace(masked, cursor + baseName.length);
        }

        if(masked[cursor] !== '{')
        {
            return { error: 'Expected "{" in LGD class declaration. Inheritance uses ": BaseName".', offset: cursor };
        }

        const bodyEnd = this.findClose(masked, cursor);
        if(bodyEnd === -1)
        {
            return { error: 'Unclosed LGD class body.', offset: cursor };
        }

        const jsdoc = compiler.findPrecedingJsdoc(content, match.index);
        const declaration = {
            kind: 'class',
            typeName: 'Object',
            typeStart: match.index + match.groups.indent.length + (match.groups.exportKeyword || '').length,
            typeEnd: nameStart - 1,
            name: name,
            nameStart: nameStart,
            nameEnd: nameEnd,
            readonly: true,
            exported: Boolean(match.groups.exportKeyword),
            indent: match.groups.indent,
            jsdoc: jsdoc ? jsdoc.text : null,
            start: jsdoc ? jsdoc.start : match.index,
            headStart: match.index,
            initializerStart: cursor,
            initializerEnd: bodyEnd + 1,
            initializerText: content.slice(cursor, bodyEnd + 1),
            end: bodyEnd + 1,
            baseName: baseName,
            baseStart: baseStart,
            baseEnd: baseName ? baseStart + baseName.length : null,
            constructorMember: null,
            classMembers: [],
            members: [{ name: 'create', kind: 'method' }],
            methodTypedParams: [],
            children: []
        };
        const errors = this.parseMembers(content, masked, declaration);
        return { declaration: declaration, errors: errors };
    },

    /** @description Reads named methods and accessors, rejecting unsupported class member syntax. */
    parseMembers(content, masked, declaration)
    {
        const errors = [];
        let cursor = this.skipSpace(masked, declaration.initializerStart + 1);
        while(cursor < declaration.initializerEnd - 1)
        {
            const parsed = this.parseMember(content, masked, cursor, declaration);
            if(parsed.error)
            {
                errors.push({ offset: parsed.offset, message: parsed.error });
                break;
            }

            const member = parsed.member;
            declaration.classMembers.push(member);
            if(member.isConstructor)
            {
                if(declaration.constructorMember)
                {
                    errors.push({ offset: member.nameStart, message: 'LGD classes support one constructor.' });
                }

                declaration.constructorMember = member;
            }
            else if(member.name === 'constructor' || member.name === 'create')
            {
                errors.push({ offset: member.nameStart, message: `Use ${declaration.name}(...) for the constructor; create() is generated.` });
            }
            else
            {
                declaration.members.push({ name: member.name, kind: member.kind });
            }

            this.addTypedParams(declaration, member);
            cursor = this.skipSpace(masked, member.bodyEnd);
        }

        return errors;
    },

    /** @description Parses a method signature, optional base initializer, and balanced body. */
    parseMember(content, masked, start, declaration)
    {
        const head = (/^(?:(?<modifier>async|get|set)\s+)?(?<generator>\*\s*)?(?<name>[$A-Z_a-z][\w$]*)\s*\(/).exec(masked.slice(start));
        if(!head)
        {
            return { error: 'Expected a named LGD method or class-name constructor. Fields, static, and private members are not supported.', offset: start };
        }

        const paramStart = start + head[0].length - 1;
        const paramClose = this.findClose(masked, paramStart);
        if(paramClose === -1 || paramClose >= declaration.initializerEnd)
        {
            return { error: 'Unclosed LGD method parameters.', offset: paramStart };
        }

        const name = head.groups.name;
        const nameEnd = masked.slice(0, paramStart).trimEnd().length;
        const isConstructor = name === declaration.name;
        if(isConstructor && (head.groups.modifier || head.groups.generator))
        {
            return { error: 'An LGD constructor cannot be async, a generator, or an accessor.', offset: start };
        }

        let cursor = this.skipSpace(masked, paramClose + 1);
        let baseArgumentsStart = null;
        let baseArgumentsEnd = null;
        if(masked[cursor] === ':')
        {
            const baseHead = (/^:\s*base\s*\(/).exec(masked.slice(cursor));
            if(!isConstructor || !declaration.baseName || !baseHead)
            {
                return { error: 'Only a derived class constructor can use ": base(...)".', offset: cursor };
            }

            const baseOpen = cursor + baseHead[0].length - 1;
            const baseClose = this.findClose(masked, baseOpen);
            if(baseClose === -1 || baseClose >= declaration.initializerEnd)
            {
                return { error: 'Unclosed base initializer arguments.', offset: baseOpen };
            }

            baseArgumentsStart = baseOpen + 1;
            baseArgumentsEnd = baseClose;
            cursor = this.skipSpace(masked, baseClose + 1);
        }

        if(masked[cursor] !== '{')
        {
            return { error: 'Expected an LGD method body.', offset: cursor };
        }

        const close = this.findClose(masked, cursor);
        if(close === -1 || close >= declaration.initializerEnd - 1)
        {
            return { error: 'Unclosed LGD method body.', offset: cursor };
        }

        const parameters = parseTypedParams(content.slice(paramStart, paramClose + 1));
        const params = parameters ? parameters.params.filter(parameter => parameter.raw !== '') : [];
        for(const parameter of params)
        {
            if(parameter.typeStart !== -1)
            {
                parameter.typeStart += paramStart - declaration.initializerStart;
                parameter.typeEnd += paramStart - declaration.initializerStart;
            }
        }

        return { member: {
            name: name,
            kind: head.groups.modifier === 'get' || head.groups.modifier === 'set' ? 'property' : 'method',
            start: start,
            nameStart: nameEnd - name.length,
            nameEnd: nameEnd,
            paramStart: paramStart,
            paramEnd: paramClose + 1,
            params: params,
            bodyStart: cursor,
            bodyEnd: close + 1,
            baseArgumentsStart: baseArgumentsStart,
            baseArgumentsEnd: baseArgumentsEnd,
            isConstructor: isConstructor
        } };
    },

    /** @description Exposes typed method groups using the existing backend and semantic-token contract. */
    addTypedParams(declaration, member)
    {
        if(!member.params.some(parameter => parameter.typeName))
        {
            return;
        }

        const base = declaration.initializerStart;
        declaration.methodTypedParams.push({
            name: member.isConstructor ? 'create' : member.name,
            methodStart: member.start - base,
            start: member.paramStart - base,
            end: member.paramEnd - base,
            params: member.params,
            hasTypes: true,
            bodyStart: member.bodyStart - base,
            bodyEnd: member.bodyEnd - base
        });
    },

    /** @description Appends generated syntax with an explicit source anchor and optional name mapping. */
    appendGenerated(output, text, start, mapping = {})
    {
        const end = mapping.end === undefined ? start : mapping.end;
        const name = mapping.name;
        const nameMapping = name || { srcStart: start, srcEnd: end, outStart: 0, outEnd: 0 };
        output.segments.push({
            srcStart: start,
            srcEnd: end,
            outStart: output.code.length,
            outEnd: output.code.length + text.length,
            verbatim: false,
            nameSrcStart: nameMapping.srcStart,
            nameSrcEnd: nameMapping.srcEnd,
            nameOutStart: output.code.length + nameMapping.outStart,
            nameOutEnd: output.code.length + nameMapping.outEnd
        });
        output.code += text;
    },

    /** @description Recursively emits a verbatim class source span, including its typed locals. */
    appendSource(output, context, start, end)
    {
        const children = context.declaration.children.filter(child => child.start >= start && child.end <= end);
        const inner = context.compiler.emitRange(context.content, context.backend, { start: start, end: end, declarations: children });
        for(const segment of inner.segments)
        {
            output.segments.push(context.compiler.shiftSegment(segment, output.code.length));
        }

        output.code += inner.code;
    },

    /** @description Emits a class as an object literal, retaining method descriptors and the create caller API. */
    emit(content, backend, declaration, compiler)
    {
        const context = { content: content, backend: backend, declaration: declaration, compiler: compiler };
        const output = { code: '', segments: [] };
        const newline = compiler.detectNewline(content);
        const comment = declaration.jsdoc ? `${declaration.jsdoc}${newline}` : '';
        const prefix = `${comment}${declaration.indent}${declaration.exported ? 'export ' : ''}const `;
        const head = `${prefix}${declaration.name} = {`;
        this.appendGenerated(output, head, declaration.start, {
            end: declaration.baseStart === null ? declaration.initializerStart + 1 : declaration.baseStart,
            name: {
                srcStart: declaration.nameStart,
                srcEnd: declaration.nameEnd,
                outStart: prefix.length,
                outEnd: prefix.length + declaration.name.length
            }
        });

        let cursor = declaration.initializerStart + 1;
        for(const member of declaration.classMembers)
        {
            this.appendSource(output, context, cursor, member.start);
            if(member.isConstructor)
            {
                this.emitConstructor(output, context, member);
            }
            else
            {
                this.appendSource(output, context, member.start, member.bodyEnd);
            }

            this.appendGenerated(output, ',', member.bodyEnd);
            cursor = member.bodyEnd;
        }

        if(!declaration.constructorMember)
        {
            this.emitConstructor(output, context, null);
            this.appendGenerated(output, ',', cursor);
        }

        this.appendSource(output, context, cursor, declaration.initializerEnd);
        this.appendGenerated(output, ';', declaration.end);
        output.code = backend.rewriteInitializer(declaration, output.code, output.segments);
        return output;
    },

    /** @description Builds create() around base construction and runs the constructor body on its fresh instance. */
    emitConstructor(output, context, member)
    {
        const declaration = context.declaration;
        const anchor = member ? member.nameStart : declaration.nameStart;
        const newline = context.compiler.detectNewline(context.content);
        const indent = `${declaration.indent}    `;
        let instanceName = '_lgdInstance';
        while(context.content.includes(instanceName))
        {
            instanceName += '$';
        }

        if(member)
        {
            this.appendGenerated(output, 'create', member.nameStart, {
                end: member.nameEnd,
                name: { srcStart: member.nameStart, srcEnd: member.nameEnd, outStart: 0, outEnd: 'create'.length }
            });
            this.appendSource(output, context, member.nameEnd, member.paramEnd);
        }
        else
        {
            this.appendGenerated(output, `${newline}${indent}create()`, anchor);
        }

        this.appendGenerated(output, ` {${newline}${indent}    const ${instanceName} = `, anchor);
        if(declaration.baseName)
        {
            this.appendGenerated(output, 'Oloo.assign(', anchor);
            this.appendGenerated(output, declaration.baseName, declaration.baseStart, {
                end: declaration.baseEnd,
                name: { srcStart: declaration.baseStart, srcEnd: declaration.baseEnd, outStart: 0, outEnd: declaration.baseName.length }
            });
            this.appendGenerated(output, '.create(', declaration.baseEnd, { end: declaration.initializerStart + 1 });
            if(member && member.baseArgumentsStart !== null)
            {
                this.appendSource(output, context, member.baseArgumentsStart, member.baseArgumentsEnd);
            }

            this.appendGenerated(output, `), ${declaration.name});`, anchor);
        }
        else
        {
            this.appendGenerated(output, `Object.create(${declaration.name});`, anchor);
        }

        if(member)
        {
            this.appendGenerated(output, `${newline}${indent}    (function() {`, member.bodyStart, { end: member.bodyStart + 1 });
            this.appendSource(output, context, member.bodyStart + 1, member.bodyEnd - 1);
            this.appendGenerated(output, `${newline}${indent}    }).apply(${instanceName}, arguments);`, member.bodyEnd - 1);
        }

        this.appendGenerated(output, `${newline}${indent}    return ${instanceName};${newline}${indent}}`, member ? member.bodyEnd - 1 : anchor, { end: member ? member.bodyEnd : anchor });
    }
};

module.exports = LgdClassSyntax;
