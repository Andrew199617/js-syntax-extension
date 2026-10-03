/** @description Reports legacy object inheritance annotations that need LGD class syntax. */
const LgdObjectInheritance = {
    /** @description Finds unsupported inheritance tags without blocking the editor mirror. */
    check(declarations)
    {
        const errors = [];
        for(const declaration of declarations)
        {
            if(declaration.kind || declaration.typeName !== 'Object' || !declaration.jsdoc || !declaration.initializerText.trimStart().startsWith('{'))
            {
                continue;
            }

            const tags = /@(?<tag>extends|augments)\b(?:[\t ]*{(?<baseTypeName>[^\n\r}]*)})?/g;
            for(const match of declaration.jsdoc.matchAll(tags))
            {
                const baseTypeName = match.groups.baseTypeName?.trim() || null;
                const offset = declaration.start + match.index;
                errors.push({
                    offset: offset,
                    endOffset: offset + match[0].length,
                    code: 'lgd.object.inheritance',
                    category: 'inheritance',
                    message: `Object @${match.groups.tag} inheritance is not supported in LGD. Use class ${declaration.name} : BaseClass { ... } with a compatible base class or object.`,
                    quickFix: { kind: 'convertObjectInheritance', declarationStart: declaration.start, name: declaration.name, baseTypeName: baseTypeName }
                });
            }
        }

        return errors;
    }
};

module.exports = LgdObjectInheritance;
