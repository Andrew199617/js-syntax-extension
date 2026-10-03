const { typeTokenPattern, baseTypeName } = require('./LgdTypeMaps');
const { maskCode } = require('./LgdInfer');
const { parseTypedParams, parseMethodHead } = require('./LgdTypedParams');
const LgdBaseCalls = require('./LgdBaseCalls');
const LgdClassFields = require('./LgdClassFields');
const LgdClassConstructorEmitter = require('./LgdClassConstructorEmitter');
const LgdClassMemberRecovery = require('./LgdClassMemberRecovery');

/** @description Reads LGD classes and interfaces and lowers runtime classes to prototype objects with create factories. */
const LgdClassSyntax = {
    /** @description Finds balanced parentheses or braces in already-masked source. */
    findClose(masked, start) { return LgdClassMemberRecovery.findClose(masked, start); },

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
        const pattern = /^(?<indent>[\t ]*)(?<exportKeyword>export[\t ]+)?(?<abstractKeyword>abstract[\t ]+)?(?<declarationKind>class|interface)[\t ]+(?<name>[$A-Z_a-z][\w$]*)\b/gm;
        const declarations = [];
        const errors = [];
        const unsupported = /^(?<indent>[\t ]*)(?<modifier>static|public|private|protected|internal|sealed|partial)[\t ]+(?:abstract[\t ]+)?(?:class|interface)\b/gm;
        for(const invalid of masked.matchAll(unsupported))
        {
            errors.push(compiler.createError(content, invalid.index + invalid.groups.indent.length, `The '${invalid.groups.modifier}' declaration modifier is not supported in LGD.`));
        }

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
                    errors.push({ ...compiler.createError(content, error.offset, error.message, error.endOffset), ...error });
                }
            }

            match = pattern.exec(masked);
        }

        return { declarations: declarations, errors: errors };
    },

    /** @description Parses one named class or interface and its colon-style heritage list. */
    parseDeclaration(content, masked, match, compiler)
    {
        const name = match.groups.name;
        const nameEnd = match.index + match[0].length;
        const nameStart = nameEnd - name.length;
        let cursor = this.skipSpace(masked, nameEnd);
        const kind = match.groups.declarationKind;
        const abstract = Boolean(match.groups.abstractKeyword);
        const abstractStart = abstract ? match.index + match.groups.indent.length + (match.groups.exportKeyword || '').length : null;
        if(kind === 'interface' && abstract)
        {
            return { error: 'An LGD interface is already abstract; do not add the abstract declaration modifier.', offset: abstractStart };
        }

        const heritage = [];
        if(masked[cursor] === ':')
        {
            do
            {
                cursor = this.skipSpace(masked, cursor + 1);
                const inherited = (/^(?<name>[$A-Z_a-z][\w$]*(?:\.[$A-Z_a-z][\w$]*)*)/).exec(masked.slice(cursor));
                if(!inherited)
                {
                    return { error: 'Expected a base object or interface name in the heritage list.', offset: cursor };
                }

                const inheritedName = inherited.groups.name;
                heritage.push({ name: inheritedName, start: cursor, end: cursor + inheritedName.length });
                cursor = this.skipSpace(masked, cursor + inheritedName.length);
            }
            while(masked[cursor] === ',');
        }

        const base = heritage[0];
        const baseName = base ? base.name : null;
        const baseStart = base ? base.start : null;
        if(masked[cursor] !== '{')
        {
            return { error: 'Expected "{" in LGD declaration. Inheritance uses ": BaseName, InterfaceName".', offset: cursor };
        }

        const bodyEnd = this.findClose(masked, cursor);
        if(bodyEnd === -1)
        {
            return { error: 'Unclosed LGD class or interface body.', offset: cursor };
        }

        const jsdoc = compiler.findPrecedingJsdoc(content, match.index);
        const declaration = {
            ...LgdClassFields.runtimeNames(content, name, nameStart),
            kind: kind,
            abstract: abstract,
            abstractStart: abstractStart,
            abstractEnd: abstractStart === null ? null : abstractStart + 'abstract'.length,
            typeName: 'Object',
            typeStart: match.index + match.groups.indent.length + (match.groups.exportKeyword || '').length + (match.groups.abstractKeyword || '').length,
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
            heritage: heritage,
            baseName: baseName,
            baseStart: baseStart,
            baseEnd: baseName ? baseStart + baseName.length : null,
            constructorMember: null,
            classMembers: [],
            members: kind === 'interface' ? [] : [{ name: 'create', kind: 'method' }],
            methodTypedParams: [],
            children: []
        };
        const errors = this.parseMembers(content, masked, declaration, compiler);
        declaration.contractSyntaxComplete = errors.length === 0;
        return { declaration: declaration, errors: errors };
    },

    /** @description Reads named methods and accessors, rejecting unsupported class member syntax. */
    parseMembers(content, masked, declaration, compiler)
    {
        const errors = [];
        let cursor = this.skipSpace(masked, declaration.initializerStart + 1);
        while(cursor < declaration.initializerEnd - 1)
        {
            const parsed = this.parseMember(content, masked, cursor, { declaration: declaration, compiler: compiler });
            if(parsed.error)
            {
                const { error, recoveryOffset, ...diagnostic } = parsed;
                errors.push({ ...diagnostic, message: error });
                if(!Number.isInteger(recoveryOffset) || recoveryOffset <= cursor)
                {
                    break;
                }

                cursor = this.skipSpace(masked, recoveryOffset);
                continue;
            }

            const member = parsed.member;
            const jsdoc = member.abstract ? compiler.findPrecedingJsdoc(content, member.start) : null;
            member.erasureStart = jsdoc && jsdoc.start > declaration.initializerStart ? jsdoc.start : member.start;
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
                errors.push({ offset: member.nameStart, message: `Use ${declaration.name}(...) for the constructor.` });
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
    parseMember(content, masked, start, context)
    {
        const { declaration, compiler } = context;
        const modifiers = this.readMethodModifiers(masked, start);
        if(modifiers.error)
        {
            return { ...modifiers, recoveryOffset: LgdClassMemberRecovery.findBoundary(masked, start, declaration.initializerEnd - 1) };
        }

        const field = LgdClassFields.parseField({ content: content, masked: masked, start: start, declaration: declaration, modifiers: modifiers, compiler: compiler });
        if(field)
        {
            return field;
        }

        if(modifiers.readonlyStart !== null)
        {
            return { error: "The 'readonly' modifier applies only to typed data fields.",
                offset: modifiers.readonlyStart, endOffset: modifiers.readonlyStart + 'readonly'.length,
                code: 'lgd.syntax.readonlyMember', category: 'syntax',
                recoveryOffset: LgdClassMemberRecovery.findBoundary(masked, start, declaration.initializerEnd - 1) };
        }

        const property = this.parsePropertyContract(masked, start, declaration, modifiers);
        if(property)
        {
            return property;
        }

        const head = parseMethodHead(modifiers.head);
        if(!head)
        {
            return LgdClassMemberRecovery.invalidHead(masked, start, modifiers.head, declaration);
        }

        const contract = declaration.kind === 'interface' || modifiers.abstractStart !== null;
        if(modifiers.staticStart !== null && (contract || modifiers.virtualStart !== null || modifiers.overrideStart !== null || head.modifier === 'get' || head.modifier === 'set'))
        {
            return { error: 'An LGD static method cannot be abstract, virtual, override, or an accessor.', offset: modifiers.staticStart };
        }

        if(modifiers.abstractStart !== null && declaration.kind !== 'interface' && !declaration.abstract)
        {
            return { error: 'Abstract members require an abstract LGD class.', offset: modifiers.abstractStart };
        }

        const paramStart = start + head.paramStart;
        const paramClose = this.findClose(masked, paramStart);
        if(paramClose === -1 || paramClose >= declaration.initializerEnd)
        {
            return { error: 'Unclosed LGD method parameters.', offset: paramStart };
        }

        const name = head.name;
        const nameEnd = masked.slice(0, paramStart).trimEnd().length;
        const isConstructor = name === declaration.name;
        if(declaration.kind === 'interface' && (isConstructor || name === 'constructor' || name === 'create'))
        {
            return { error: 'LGD interfaces cannot declare constructors or create factories.', offset: start + head.nameStart };
        }

        if(isConstructor && (head.modifier || head.generator || head.returnTypeName || modifiers.spans.length > 0))
        {
            return { error: 'An LGD constructor cannot have a return type or be static, virtual, override, async, a generator, or an accessor.', offset: start };
        }

        if(modifiers.virtualStart !== null && (head.modifier === 'get' || head.modifier === 'set'))
        {
            return { error: 'The LGD virtual modifier applies to methods, not accessors.', offset: start };
        }

        if(contract && (head.async || head.generator || head.modifier === 'get' || head.modifier === 'set'))
        {
            return { error: 'Contract methods cannot be async, generators, or accessor methods; use a typed property contract for accessors.', offset: start };
        }

        const parameters = parseTypedParams(content.slice(paramStart, paramClose + 1));
        const parsedParams = parameters ? parameters.params : [];
        const params = parsedParams.filter(parameter => parameter.raw !== '' && (!contract || maskCode(parameter.raw).trim() !== ''));
        const emptyParameter = parsedParams.some(parameter => maskCode(parameter.raw).trim() === '') && masked.slice(paramStart + 1, paramClose).trim() !== '';
        if(contract && (!head.returnTypeName || emptyParameter || params.some(parameter => !parameter.name || !parameter.typeName)))
        {
            return { error: 'Interface and abstract methods require explicit return and parameter types.', offset: start };
        }

        for(const parameter of params)
        {
            if(parameter.typeStart !== -1)
            {
                parameter.typeStart += paramStart - declaration.initializerStart;
                parameter.typeEnd += paramStart - declaration.initializerStart;
            }
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

        let bodyEnd;
        if(contract)
        {
            if(masked[cursor] !== ';')
            {
                return { error: 'Interface and abstract methods must end with ";" and cannot have a body.', offset: cursor };
            }

            bodyEnd = cursor + 1;
        }
        else
        {
            if(masked[cursor] !== '{')
            {
                return LgdClassMemberRecovery.missingBody({
                    content: content, masked: masked, start: cursor, declaration: declaration, compiler: compiler, syntax: this,
                    insertionOffset: baseArgumentsEnd === null ? paramClose + 1 : baseArgumentsEnd + 1,
                    isConstructor: isConstructor, hasBaseInitializer: baseArgumentsEnd !== null, allowBodyRecovery: context.allowBodyRecovery
                });
            }

            const close = this.findClose(masked, cursor);
            if(close === -1 || close >= declaration.initializerEnd - 1)
            {
                return { error: 'Unclosed LGD method body.', offset: cursor };
            }

            bodyEnd = close + 1;
        }

        return { member: {
            name: name,
            kind: head.modifier === 'get' || head.modifier === 'set' ? 'property' : 'method',
            start: start,
            nameStart: nameEnd - name.length,
            nameEnd: nameEnd,
            paramStart: paramStart,
            paramEnd: paramClose + 1,
            params: params,
            bodyStart: cursor,
            bodyEnd: bodyEnd,
            baseArgumentsStart: baseArgumentsStart,
            baseArgumentsEnd: baseArgumentsEnd,
            isConstructor: isConstructor,
            returnTypeName: head.returnTypeName,
            returnTypeStart: head.returnTypeName ? start + head.returnTypeStart - declaration.initializerStart : -1,
            returnTypeEnd: head.returnTypeName ? start + head.returnTypeEnd - declaration.initializerStart : -1,
            async: head.async,
            generator: head.generator,
            accessor: head.modifier === 'get' || head.modifier === 'set',
            accessorKind: head.modifier === 'get' || head.modifier === 'set' ? head.modifier : null,
            getter: head.modifier === 'get',
            setter: head.modifier === 'set',
            static: modifiers.staticStart !== null,
            staticStart: modifiers.staticStart,
            staticEnd: modifiers.staticStart === null ? null : modifiers.staticStart + 'static'.length,
            abstract: contract,
            abstractStart: modifiers.abstractStart,
            abstractEnd: modifiers.abstractStart === null ? null : modifiers.abstractStart + 'abstract'.length,
            virtual: modifiers.virtualStart !== null,
            override: modifiers.overrideStart !== null,
            virtualStart: modifiers.virtualStart,
            virtualEnd: modifiers.virtualStart === null ? null : modifiers.virtualStart + 'virtual'.length,
            overrideStart: modifiers.overrideStart,
            overrideEnd: modifiers.overrideStart === null ? null : modifiers.overrideStart + 'override'.length,
            modifierSpans: modifiers.spans
        } };
    },

    /** @description Reads a typed signature-only property with one or both accessor contracts. */
    parsePropertyContract(masked, start, declaration, modifiers)
    {
        const head = new RegExp(`^\\s*(?<type>${typeTokenPattern})\\s+(?<name>[$A-Z_a-z][\\w$]*)\\s*{`).exec(modifiers.head);
        if(!head)
        {
            return null;
        }

        const contract = declaration.kind === 'interface' || modifiers.abstractStart !== null;
        if(!contract || declaration.kind !== 'interface' && !declaration.abstract)
        {
            return { error: 'Signature-only properties require an interface or an abstract member in an abstract class.', offset: start };
        }

        if(modifiers.virtualStart !== null || baseTypeName(head.groups.type) === 'void')
        {
            return { error: 'A property contract must have a value type and cannot explicitly be virtual.', offset: start };
        }

        if(declaration.kind === 'interface' && modifiers.overrideStart !== null)
        {
            return { error: 'An interface property contract cannot be override.', offset: modifiers.overrideStart };
        }

        const bodyStart = start + head[0].length - 1;
        const close = this.findClose(masked, bodyStart);
        if(close === -1 || close >= declaration.initializerEnd - 1)
        {
            return { error: 'Unclosed LGD property contract.', offset: bodyStart };
        }

        const accessors = {};
        let cursor = this.skipSpace(masked, bodyStart + 1);
        while(cursor < close)
        {
            const accessor = (/^(?<kind>get|set)\b/).exec(masked.slice(cursor));
            if(!accessor)
            {
                return { error: 'A property contract supports only "get;" and "set;" accessors without bodies.', offset: cursor };
            }

            const accessorKind = accessor.groups.kind;
            if(accessors[accessorKind])
            {
                return { error: `Duplicate '${accessorKind}' property accessor.`, offset: cursor };
            }

            accessors[accessorKind] = { start: cursor, end: cursor + accessorKind.length };
            cursor = this.skipSpace(masked, cursor + accessorKind.length);
            if(masked[cursor] !== ';')
            {
                return { error: 'Property contract accessors must end with ";" and cannot have bodies.', offset: cursor };
            }

            cursor = this.skipSpace(masked, cursor + 1);
        }

        if(!accessors.get && !accessors.set)
        {
            return { error: 'A property contract requires at least one get or set accessor.', offset: bodyStart };
        }

        const nameEnd = masked.slice(0, bodyStart).trimEnd().length;
        const typeStart = start + head[0].indexOf(head.groups.type);
        return { member: {
            name: head.groups.name,
            kind: 'property',
            start: start,
            nameStart: nameEnd - head.groups.name.length,
            nameEnd: nameEnd,
            paramStart: nameEnd,
            paramEnd: nameEnd,
            params: [],
            bodyStart: bodyStart,
            bodyEnd: close + 1,
            baseArgumentsStart: null,
            baseArgumentsEnd: null,
            isConstructor: false,
            returnTypeName: null,
            returnTypeStart: -1,
            returnTypeEnd: -1,
            propertyTypeName: head.groups.type,
            propertyTypeStart: typeStart - declaration.initializerStart,
            propertyTypeEnd: typeStart + head.groups.type.length - declaration.initializerStart,
            async: false,
            generator: false,
            accessor: true,
            accessorKind: null,
            getter: Boolean(accessors.get),
            setter: Boolean(accessors.set),
            getterStart: accessors.get ? accessors.get.start : null,
            getterEnd: accessors.get ? accessors.get.end : null,
            setterStart: accessors.set ? accessors.set.start : null,
            setterEnd: accessors.set ? accessors.set.end : null,
            abstract: true,
            abstractStart: modifiers.abstractStart,
            abstractEnd: modifiers.abstractStart === null ? null : modifiers.abstractStart + 'abstract'.length,
            virtual: true,
            override: modifiers.overrideStart !== null,
            virtualStart: null,
            virtualEnd: null,
            overrideStart: modifiers.overrideStart,
            overrideEnd: modifiers.overrideStart === null ? null : modifiers.overrideStart + 'override'.length,
            modifierSpans: modifiers.spans
        } };
    },

    /** @description Reads compile-only abstract/virtual/override modifiers while keeping every signature offset unchanged. */
    readMethodModifiers(masked, start)
    {
        let cursor = start;
        let head = masked.slice(start);
        const spans = [];
        let virtualStart = null;
        let overrideStart = null;
        let abstractStart = null;
        let staticStart = null;
        let readonlyStart = null;
        const seen = new Set();
        let match = (/^(?<modifier>async|virtual|override|abstract|static|readonly|public|private|protected|internal|new|const)\b/).exec(masked.slice(cursor));
        while(match)
        {
            const modifier = match.groups.modifier;
            if([ 'public', 'private', 'protected', 'internal', 'new', 'const' ].includes(modifier))
            {
                return LgdClassMemberRecovery.modifierError(modifier, cursor);
            }

            const end = cursor + modifier.length;
            const after = this.skipSpace(masked, end);
            if(masked[after] === '(')
            {
                break;
            }

            if(seen.has(modifier))
            {
                return { error: `Duplicate '${modifier}' member modifier.`, offset: cursor };
            }

            seen.add(modifier);
            if(modifier !== 'async')
            {
                const virtualConflict = modifier === 'virtual' && (overrideStart !== null || abstractStart !== null);
                const otherConflict = virtualStart !== null && (modifier === 'override' || modifier === 'abstract');
                if(virtualConflict || otherConflict)
                {
                    return { error: 'An LGD member cannot combine virtual with abstract or override.', offset: cursor };
                }

                if(modifier === 'abstract')
                {
                    abstractStart = cursor;
                }
                else if(modifier === 'virtual')
                {
                    virtualStart = cursor;
                }
                else if(modifier === 'readonly')
                {
                    readonlyStart = cursor;
                }
                else if(modifier === 'static')
                {
                    staticStart = cursor;
                }
                else
                {
                    overrideStart = cursor;
                }

                spans.push({ start: cursor, end: end });
                head = `${head.slice(0, cursor - start)}${' '.repeat(modifier.length)}${head.slice(end - start)}`;
            }

            cursor = after;
            match = (/^(?<modifier>async|virtual|override|abstract|static|readonly|public|private|protected|internal|new|const)\b/).exec(masked.slice(cursor));
        }

        return { head: head, spans: spans, virtualStart: virtualStart, overrideStart: overrideStart,
            abstractStart: abstractStart, staticStart: staticStart, readonlyStart: readonlyStart };
    },

    /** @description Exposes typed method groups using the existing backend and semantic-token contract. */
    addTypedParams(declaration, member)
    {
        if(!member.returnTypeName && !member.params.some(parameter => parameter.typeName))
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
            hasTypes: member.params.some(parameter => parameter.typeName),
            returnTypeName: member.returnTypeName,
            returnTypeStart: member.returnTypeStart,
            returnTypeEnd: member.returnTypeEnd,
            async: member.async,
            generator: member.generator,
            accessor: member.accessor,
            abstract: member.abstract,
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
        const context = { content: content, backend: backend, declaration: declaration, compiler: compiler, syntax: this };
        const output = { code: '', segments: [] };
        if(declaration.kind === 'interface')
        {
            this.appendGenerated(output, '', declaration.start, { end: declaration.end });
            return output;
        }

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
            const memberStart = member.abstract ? member.erasureStart : member.start;
            this.appendSource(output, context, cursor, memberStart);
            if(member.abstract)
            {
                this.appendGenerated(output, '', memberStart, { end: member.bodyEnd });
                cursor = member.bodyEnd;
                continue;
            }

            if(member.kind === 'field')
            {
                this.appendGenerated(output, '', memberStart);
                cursor = member.bodyEnd;
                continue;
            }

            if(member.isConstructor)
            {
                this.emitConstructor(output, context, member);
            }
            else
            {
                this.emitMethod(output, context, member);
            }

            this.appendGenerated(output, ',', member.bodyEnd);
            cursor = member.bodyEnd;
        }

        if(!declaration.constructorMember)
        {
            this.emitConstructor(output, context, null);
            this.appendGenerated(output, ',', cursor);
        }

        LgdClassFields.emitInstanceInitializer(output, context);
        this.appendSource(output, context, cursor, declaration.initializerEnd);
        this.appendGenerated(output, ';', declaration.end);
        LgdClassFields.emitRuntimeAliases(output, context);
        if(declaration.baseName)
        {
            this.appendGenerated(output, `${newline}${declaration.indent}Object.setPrototypeOf(${declaration.name}, ${declaration.baseName});`, declaration.end);
        }

        LgdClassFields.emitStaticFields(output, context);
        if(declaration.baseCalls?.length > 0)
        {
            output.code = LgdBaseCalls.rewrite(declaration, output.code, output.segments);
            const helper = `${newline}${declaration.indent}/** @returns {typeof ${declaration.baseName}} */`
                + `${newline}${declaration.indent}const ${declaration.baseOwnerName} = () => Object.getPrototypeOf(${declaration.name});`;
            this.appendGenerated(output, helper, declaration.end);
        }

        const protocolConstructor = !declaration.baseName || declaration.baseIsLgdClass;
        const groups = declaration.methodTypedParams.filter(group => !group.abstract).map(group => LgdClassConstructorEmitter.runtimeGroup(group, protocolConstructor));

        const runtimeDeclaration = { ...declaration, methodTypedParams: groups };
        output.code = backend.rewriteInitializer(runtimeDeclaration, output.code, output.segments);
        return output;
    },

    /** @description Erases compile-only method modifiers while preserving comments, executable code and mappings. */
    emitMethod(output, context, member)
    {
        let cursor = member.start;
        for(const span of member.modifierSpans)
        {
            this.appendSource(output, context, cursor, span.start);
            this.appendGenerated(output, '', span.start, { end: span.end });
            cursor = span.end;
        }

        this.appendSource(output, context, cursor, member.bodyEnd);
    },

    /** @description Builds create() around base construction and runs the constructor body on its fresh instance. */
    emitConstructor(output, context, member)
    {
        if(!context.declaration.baseName || context.declaration.baseIsLgdClass)
        {
            LgdClassConstructorEmitter.emit(output, context, member);
            return;
        }

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

        LgdClassFields.emitInstanceInitializerCall(output, context, instanceName);
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
