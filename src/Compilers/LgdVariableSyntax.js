const { typeNamePattern, parseTypeName } = require('./LgdTypeMaps');

/** @description Matches an annotated binding at a statement boundary through its initializer delimiter. */
const declarationHeadPattern = new RegExp(`(?:^|(?<=[;{}]))(?<indent>[\\t ]*)(?<exportKeyword>export[\\t ]+)?(?<bindingKeyword>(?:const|let|readonly)[\\t ]+)?(?<typeName>${typeNamePattern})[\\t ]+(?<variableName>[$A-Z_a-z][\\w$]*)[\\t ]*=`, 'gm');

/** @description Finds potential malformed typed bindings without consuming their initializer. */
const typeNameLinePattern = new RegExp(`^[\\t ]*(?:export[\\t ]+)?(?<bindingKeyword>(?:const|let|readonly)[\\t ]+)?(?<typeName>${typeNamePattern})(?![\\w$.?])(?![\\t ]*(?:\\(|\\[|\\.))`, 'gm');

/** @description Separates immutable variable declarations from class-member syntax and legacy spellings. */
const LgdVariableSyntax = {
    /** @description Preserves optional source spans on syntax diagnostics. */
    error(line, offset, message, endOffset)
    {
        const diagnostic = { message: message, line: line, offset: offset };
        if(Number.isInteger(endOffset))
        {
            diagnostic.endOffset = endOffset;
        }

        return diagnostic;
    },

    declarationHeadPattern: declarationHeadPattern,
    typeNameLinePattern: typeNameLinePattern,

    /** @description Leaves fields to the class scanner and rejects malformed matched annotations. */
    excludeHead(context)
    {
        const { masked, classes, head, start, end, errors, failed, compiler } = context;
        if(this.isClassMemberHead(masked, classes.declarations, start, end))
        {
            return true;
        }

        if(parseTypeName(head.typeName))
        {
            return false;
        }

        errors.push(compiler.createError(masked, start, 'Invalid typed declaration.'));
        failed.push(start);
        return true;
    },

    /** @description Leaves class-level fields, including recovered invalid modifiers, to the class parser. */
    isClassMemberHead(masked, declarations, headStart, headEnd)
    {
        return declarations.some(declaration =>
        {
            const classField = declaration.classMembers?.some(member => member.kind === 'field' && member.start <= headEnd && headEnd <= member.initializerStart);

            if(classField)
            {
                return true;
            }

            if(headStart < declaration.initializerStart || headEnd >= declaration.initializerEnd)
            {
                return false;
            }

            let depth = 0;
            for(const character of masked.slice(declaration.initializerStart, headStart))
            {
                if(character === '{') depth++;
                if(character === '}') depth--;
            }

            return depth === 1;
        });
    },

    /** @description Combines variable-only syntax diagnostics and preserves scanner recovery offsets. */
    checkBindings(masked, declarations, failed, compiler)
    {
        const malformed = this.checkMalformedTypes(masked, declarations, compiler);
        failed.push(...malformed.map(error => error.offset));
        return [ ...this.checkLegacy(masked, declarations, compiler), ...malformed ];
    },

    /** @description Keeps old local bindings working while offering a precise token-only migration. */
    checkLegacy(content, declarations, compiler)
    {
        return declarations.filter(declaration => declaration.bindingKind === 'readonly').map(declaration =>
        {
            const offset = declaration.bindingStart;
            const endOffset = offset + 'readonly'.length;
            const message = "Use 'const' for variable declarations. 'readonly' is reserved for members.";
            return { ...compiler.createError(content, offset, message, endOffset),
                code: 'lgd.declaration.readonly', severity: 'warning',
                quickFix: { kind: 'replaceReadonlyLocal', offset: offset, endOffset: endOffset, declarationStart: declaration.headStart, name: declaration.name } };
        });
    },

    /** @description Reports unsupported container, union, and generic spellings before they fall through to JavaScript syntax recovery. */
    checkMalformedTypes(masked, declarations, compiler)
    {
        const errors = [];
        const candidates = (/^[\t ]*(?:export[\t ]+)?(?:(?:const|let|readonly)[\t ]+)?(?<type>(?:(?:[$A-Z_a-z][\w$]*\.)*[A-Z][\w$]*|number|string|boolean|bigint|symbol|object|void)[\w\t $&,.<>?[\]|]*?)[\t ]+(?<name>[$A-Z_a-z][\w$]*)[\t ]*=/gm);
        for(const candidate of masked.matchAll(candidates))
        {
            const type = candidate.groups.type.trim();
            const parsed = parseTypeName(type);
            const valid = parsed && parsed.end === type.length;
            const covered = declarations.some(declaration => declaration.headStart <= candidate.index && candidate.index < declaration.end);
            if(!valid && !covered && !this.isClassMemberHead(masked, declarations, candidate.index, candidate.index + candidate[0].length))
            {
                errors.push(compiler.createError(masked, candidate.index, 'Unsupported type annotation. Use a named type with [] or ? suffixes.'));
            }
        }

        return errors;
    },

    /** @description Finds a following annotated binding when reporting a missing semicolon. */
    nextLineStartsDeclaration(content, from)
    {
        const pattern = new RegExp(`^\\s*(?:export[\\t ]+)?(?:(?:const|let|readonly)[\\t ]+)?${typeNamePattern}[\\t ]+[$A-Z_a-z][\\w$]*[\\t ]*=`);
        return pattern.test(content.slice(from));
    },

    /** @description Accepts ordinary JavaScript const bindings whose names happen to be capitalized. */
    isInferredConst(content, match)
    {
        const remainder = content.slice(match.index + match[0].length);
        const inferredBinding = [ 'const', 'let' ].includes(match.groups.bindingKeyword?.trim());
        const primitiveAssignment = (/^(?:number|string|boolean|bigint|symbol|object)$/).test(match.groups.typeName);
        return (inferredBinding || primitiveAssignment) && (/^\s*(?:=|[,;]|$)/).test(remainder);
    }
};

module.exports = LgdVariableSyntax;
