const parser = require('@babel/parser');
const { tsTypeMap } = require('./LgdTypeMaps');
const traverse = require('@babel/traverse').default;
const { maskCode } = require('./LgdInfer');
const { splitTopLevelChunks } = require('./LgdTypedParams');
const LgdClassSyntax = require('./LgdClassSyntax');
const LgdSourceMap = require('./LgdSourceMap');

/** @description Parses explicitly valued LGD enums and preserves their JavaScript serialized values. */
const LgdEnumSyntax = {
    /** @description Reads enum declarations without interpreting strings or comments as syntax. */
    parse(content, compiler)
    {
        const masked = maskCode(content);
        const pattern = /^(?<indent>[\t ]*)(?<exportKeyword>export[\t ]+)?(?<declarationModifiers>(?:(?:public|private|protected|internal)[\t ]+)*)enum[\t ]+(?<name>[$A-Z_a-z][\w$]*)\b/gm;
        const declarations = [];
        const errors = [];
        for(const match of masked.matchAll(pattern))
        {
            const modifierStart = match.index + match.groups.indent.length + (match.groups.exportKeyword || '').length;
            const modifiers = LgdClassSyntax.readDeclarationModifiers(match.groups.declarationModifiers, modifierStart);
            if(modifiers.error)
            {
                errors.push({ ...compiler.createError(content, modifiers.offset, modifiers.error, modifiers.endOffset), code: modifiers.code });
                continue;
            }

            const nameEnd = match.index + match[0].length;
            const bodyStart = LgdClassSyntax.skipSpace(masked, nameEnd);
            const bodyEnd = masked[bodyStart] === '{' ? LgdClassSyntax.findClose(masked, bodyStart) : -1;
            if(bodyEnd === -1)
            {
                errors.push(compiler.createError(content, bodyStart, 'Expected a balanced enum body.'));
                continue;
            }

            const jsdoc = compiler.findPrecedingJsdoc(content, match.index);
            const declaration = {
                kind: 'enum', typeName: 'Object', name: match.groups.name,
                ...LgdClassSyntax.accessibilityMetadata(modifiers),
                typeStart: modifierStart + match.groups.declarationModifiers.length,
                typeEnd: nameEnd - match.groups.name.length - 1,
                nameStart: nameEnd - match.groups.name.length, nameEnd: nameEnd,
                start: jsdoc ? jsdoc.start : match.index, headStart: match.index,
                initializerStart: bodyStart, initializerEnd: bodyEnd + 1,
                initializerText: content.slice(bodyStart, bodyEnd + 1),
                end: bodyEnd + 1 + (content[bodyEnd + 1] === ';' ? 1 : 0),
                indent: match.groups.indent, exported: Boolean(match.groups.exportKeyword), readonly: true,
                jsdoc: jsdoc ? jsdoc.text : null, members: [], children: [], methodTypedParams: []
            };
            if(Object.hasOwn(tsTypeMap, declaration.name))
            {
                errors.push(compiler.createError(content, declaration.nameStart, 'An enum name cannot replace an LGD built-in type name.'));
            }

            const names = new Set();
            for(const chunk of splitTopLevelChunks(declaration.initializerText))
            {
                if(!maskCode(chunk.text, true).trim())
                {
                    continue;
                }

                const head = (/^(?<trivia>\s*)(?<name>[$A-Z_a-z][\w$]*)\s*=/).exec(maskCode(chunk.text, true));
                const offset = bodyStart + chunk.start;
                const value = head ? this.literal(chunk.text.slice(head[0].length)) : null;
                if(!head || !value)
                {
                    errors.push(compiler.createError(content, offset, 'Enum members require an explicit string or finite numeric literal.'));
                    continue;
                }

                const name = head.groups.name;
                if(names.has(name) || name === '__proto__')
                {
                    errors.push(compiler.createError(content, offset, `Duplicate or unsupported enum member '${name}'.`));
                    continue;
                }

                if(declaration.enumValueType && declaration.enumValueType !== value.typeName)
                {
                    errors.push(compiler.createError(content, offset, 'Enum members must all use the same literal type.'));
                }

                names.add(name);
                declaration.enumValueType = value.typeName;
                declaration.members.push({ name: name, kind: 'property', typeName: value.typeName,
                    value: value.value, valueText: value.text,
                    nameStart: offset + head.groups.trivia.length,
                    nameEnd: offset + head.groups.trivia.length + name.length,
                    equalsStart: offset + head[0].length - 1 });
            }

            declarations.push(declaration);
        }

        return { declarations: declarations, errors: errors };
    },

    /** @description Recognizes only explicit string and finite numeric literal values. */
    literal(text)
    {
        try
        {
            const node = parser.parseExpression(text);
            if(node.type === 'StringLiteral')
            {
                return { value: node.value, typeName: 'String', text: text.slice(node.start, node.end) };
            }

            if(node.type === 'NumericLiteral' && Number.isFinite(node.value))
            {
                return { value: node.value, typeName: 'Number', text: text.slice(node.start, node.end) };
            }

            if(node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'NumericLiteral' && Number.isFinite(node.argument.value))
            {
                return { value: -node.argument.value, typeName: 'Number', text: text.slice(node.start, node.end) };
            }
        }
        catch
        {
            return null;
        }

        return null;
    },

    /** @description Emits a frozen object and exact source mappings for names, comments, and literals. */
    emit(content, declaration, typescript = false)
    {
        let code = content.slice(declaration.start, declaration.end);
        const segments = [{ srcStart: declaration.start, srcEnd: declaration.end, outStart: 0, outEnd: code.length, verbatim: true }];
        const edits = declaration.members.map(member => ({ start: member.equalsStart - declaration.start,
            end: member.equalsStart - declaration.start + 1, text: ':' }));

        if(Number.isInteger(declaration.accessibilityStart))
        {
            edits.push({ start: declaration.accessibilityStart - declaration.start, end: declaration.accessibilityEnd - declaration.start, text: '' });
        }

        edits.push({ start: declaration.typeStart - declaration.start, end: declaration.typeStart - declaration.start + 'enum'.length, text: 'const' });
        edits.push({ start: declaration.nameEnd - declaration.start, end: declaration.initializerStart - declaration.start, text: ' = Object.freeze(' });
        edits.push({ start: declaration.initializerEnd - declaration.start, end: declaration.end - declaration.start, text: ');' });
        code = LgdSourceMap.applyEdits(code, segments, edits);
        const newline = content.includes('\r\n') ? '\r\n' : '\n';
        const alias = `typeof ${declaration.name}[keyof typeof ${declaration.name}]`;
        const prefix = typescript
            ? `${declaration.exported ? 'export ' : ''}type ${declaration.name} = ${alias};${newline}`
            : `/** @typedef {${alias}} ${declaration.name} */${newline}`;
        for(const segment of segments)
        {
            segment.outStart += prefix.length;
            segment.outEnd += prefix.length;
            if(segment.nameOutStart !== undefined)
            {
                segment.nameOutStart += prefix.length;
                segment.nameOutEnd += prefix.length;
            }
        }

        const aliasStart = typescript ? prefix.indexOf(declaration.name) : prefix.lastIndexOf(declaration.name);
        segments.unshift({ srcStart: declaration.start, srcEnd: declaration.start, outStart: 0, outEnd: prefix.length, verbatim: false,
            nameSrcStart: declaration.nameStart, nameSrcEnd: declaration.nameEnd, nameOutStart: aliasStart, nameOutEnd: aliasStart + declaration.name.length });
        return { code: prefix + code, segments: segments };
    },

    /** @description Resolves enum receivers through actual lexical bindings, ignoring shadowed names. */
    receiver(path, context)
    {
        if(!path.isIdentifier())
        {
            return null;
        }

        const binding = path.scope.getBinding(path.node.name);
        const offset = binding && context.map.toSource(binding.identifier.start);
        const local = context.declarations.find(declaration => declaration.kind === 'enum' && declaration.nameStart === offset);
        if(local)
        {
            return local;
        }

        const initializer = binding?.path.node.init;
        const requireCall = initializer?.type === 'CallExpression' && initializer.callee.type === 'Identifier' && initializer.callee.name === 'require';
        if(requireCall && binding.constant && !binding.path.scope.getBinding('require') && initializer.arguments.length === 1 && initializer.arguments[0].type === 'StringLiteral')
        {
            const imported = context.externals.get(initializer.arguments[0].value);
            if(imported?.kind === 'enum')
            {
                return { ...imported, name: imported.exportName };
            }
        }

        return null;
    },

    /** @description Identifies a proven enum member value for shared assignment and return checks. */
    memberType(path, context)
    {
        if(!path.isMemberExpression() && !path.isOptionalMemberExpression())
        {
            return null;
        }

        const declaration = this.receiver(path.get('object'), context);
        const name = this.memberName(path.node);
        return declaration?.members.some(member => member.name === name) ? declaration.name : null;
    },

    /** @description Reads only statically known property keys using JavaScript key coercion. */
    memberName(node)
    {
        if(!node.computed)
        {
            return node.property.name;
        }

        const literal = node.property;
        if([ 'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'BigIntLiteral' ].includes(literal.type))
        {
            return String(literal.value);
        }

        return null;
    },

    /** @description Recognizes direct and destructuring writes without treating reads on the right side as writes. */
    isWrite(path)
    {
        let target = path;
        while(target.parentPath)
        {
            const owner = target.parentPath;
            if(owner.isAssignmentExpression())
            {
                return owner.node.left === target.node;
            }

            if(owner.isForInStatement() || owner.isForOfStatement())
            {
                return owner.node.left === target.node;
            }

            if(owner.isUpdateExpression() || owner.isUnaryExpression({ operator: 'delete' }))
            {
                return true;
            }

            const pattern = owner.isArrayPattern() || owner.isObjectPattern() || owner.isRestElement();
            const property = owner.isObjectProperty() && owner.node.value === target.node && owner.parentPath.isObjectPattern();
            const defaultTarget = owner.isAssignmentPattern() && owner.node.left === target.node;
            if(!pattern && !property && !defaultTarget)
            {
                return false;
            }

            target = owner;
        }

        return false;
    },

    /** @description Diagnoses unknown literal members and direct writes to frozen enum members. */
    check(context)
    {
        const errors = [];
        traverse(context.tree, {
            /** @description Rejects a shadowed Object that cannot provide the promised native freeze semantics. */
            VariableDeclarator: path =>
            {
                const offset = context.map.toSource(path.node.id.start);
                const declaration = context.declarations.find(candidate => candidate.kind === 'enum' && candidate.nameStart === offset);

                if(declaration && path.scope.getBinding('Object'))
                {
                    errors.push({ offset: declaration.typeStart, endOffset: declaration.typeEnd,
                        message: 'Enum declarations require the native Object.freeze; Object is shadowed in this scope.' });
                }
            },

            /** @description Validates direct enum member access. */
            'MemberExpression|OptionalMemberExpression': path =>
            {
                const declaration = this.receiver(path.get('object'), context);
                if(!declaration)
                {
                    return;
                }

                const name = this.memberName(path.node);
                const written = this.isWrite(path);
                let message;
                if(written)
                {
                    message = `Cannot modify frozen enum '${declaration.name}'.`;
                }
                else if(typeof name === 'string' && !declaration.members.some(member => member.name === name))
                {
                    message = `Enum '${declaration.name}' has no member '${name}'.`;
                }

                if(message)
                {
                    errors.push({ offset: context.map.toSource(path.node.property.start), endOffset: context.map.toSource(path.node.property.end), message: message });
                }
            }
        });
        return errors;
    }
};

module.exports = LgdEnumSyntax;
