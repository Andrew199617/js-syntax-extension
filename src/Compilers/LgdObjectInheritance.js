const LgdDocComment = require('./LgdDocComment');

/** @description Reports legacy object inheritance annotations that need LGD class syntax. */
const LgdObjectInheritance = {
    /** @description Reads real inheritance tags outside fenced documentation examples. */
    tags(declaration)
    {
        const tags = [];
        for(const line of LgdDocComment.lines(declaration.jsdoc || '/** */'))
        {
            const match = (/^@(?<tag>extends|augments)\b(?:[\t ]*{(?<baseTypeName>[^\n\r}]*)})?/).exec(line.text);
            if(match)
            {
                tags.push({ name: match.groups.tag, baseTypeName: match.groups.baseTypeName?.trim() || null,
                    offset: line.offset, endOffset: line.offset + match[0].length });
            }
        }

        return tags;
    },

    /** @description Links reserved constructor spellings to conservative class migration strategies. */
    constructorError(declaration, member)
    {
        const factory = member.name === 'create';
        let message = `Use ${declaration.name}(...) for the constructor.`;
        if(factory)
        {
            message += ' Replace factory allocation and returned objects with this initialization and an optional : base(...) call.';
        }

        return { offset: member.nameStart, endOffset: member.nameEnd, message: message,
            code: factory ? 'lgd.constructor.factory' : 'lgd.constructor.name', category: 'syntax',
            quickFix: { kind: factory ? 'convertObjectInheritance' : 'renameClassConstructor',
                declarationStart: declaration.start, memberStart: member.start, name: declaration.name } };
    },

    /** @description Finds unsupported inheritance tags without blocking the editor mirror. */
    check(declarations)
    {
        const errors = [];
        for(const declaration of declarations)
        {
            const supportedKind = !declaration.kind || declaration.kind === 'class';
            if(!supportedKind || declaration.typeName !== 'Object' || !declaration.jsdoc || !declaration.initializerText.trimStart().startsWith('{'))
            {
                continue;
            }

            for(const tag of this.tags(declaration))
            {
                const { baseTypeName, offset, endOffset } = tag;
                errors.push({
                    offset: declaration.start + offset,
                    endOffset: declaration.start + endOffset,
                    code: declaration.kind === 'class' ? 'lgd.class.inheritanceDoc' : 'lgd.object.inheritance',
                    category: 'inheritance',
                    message: `${declaration.kind === 'class' ? 'Class' : 'Object'} @${tag.name} inheritance is not supported in LGD. Use class ${declaration.name} : BaseClass { ... } with a compatible base class or object.`,
                    quickFix: { kind: 'convertObjectInheritance', declarationStart: declaration.start, name: declaration.name, baseTypeName: baseTypeName }
                });
            }
        }

        return errors;
    }
};

module.exports = LgdObjectInheritance;
