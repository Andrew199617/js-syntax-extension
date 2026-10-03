const { typeNamePattern } = require('./LgdTypeMaps');

/** @description Matches an annotated binding at a statement boundary through its initializer delimiter. */
const declarationHeadPattern = new RegExp(`(?:^|(?<=;))(?<indent>[\\t ]*)(?<exportKeyword>export[\\t ]+)?(?<bindingKeyword>(?:const|readonly)[\\t ]+)?(?<typeName>${typeNamePattern})[\\t ]+(?<variableName>[$A-Z_a-z][\\w$]*)[\\t ]*=`, 'gm');

/** @description Finds potential malformed typed bindings without consuming their initializer. */
const typeNameLinePattern = new RegExp(`^[\\t ]*(?:export[\\t ]+)?(?<bindingKeyword>(?:const|readonly)[\\t ]+)?(?<typeName>${typeNamePattern})(?![\\w$.?])(?![\\t ]*(?:\\(|\\[|\\.))`, 'gm');

/** @description Separates immutable variable declarations from class-member syntax and legacy spellings. */
const LgdVariableSyntax = {
    declarationHeadPattern: declarationHeadPattern,
    typeNameLinePattern: typeNameLinePattern,

    /** @description Leaves class-level fields, including recovered invalid modifiers, to the class parser. */
    isClassMemberHead(masked, declarations, headStart, headEnd)
    {
        return declarations.some(declaration =>
        {
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
                quickFix: { kind: 'replaceReadonlyLocal', offset: offset, endOffset: endOffset, declarationStart: declaration.headStart } };
        });
    },

    /** @description Finds a following annotated binding when reporting a missing semicolon. */
    nextLineStartsDeclaration(content, from)
    {
        const pattern = new RegExp(`^\\s*(?:export[\\t ]+)?(?:(?:const|readonly)[\\t ]+)?${typeNamePattern}[\\t ]+[$A-Z_a-z][\\w$]*[\\t ]*=`);
        return pattern.test(content.slice(from));
    },

    /** @description Accepts ordinary JavaScript const bindings whose names happen to be capitalized. */
    isInferredConst(content, match)
    {
        const remainder = content.slice(match.index + match[0].length);
        return match.groups.bindingKeyword?.trim() === 'const' && (/^\s*(?:=|[,;]|$)/).test(remainder);
    }
};

module.exports = LgdVariableSyntax;
