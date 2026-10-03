const LgdAccessibility = require('./LgdAccessibility');

/** @description Preserves nominal member-result identities across files as an acyclic table of source-backed types. */
const LgdMemberTypeGraph = {
    /** @description Keys a nominal type by its defining source and declaration span rather than its imported alias. */
    key(declaration)
    {
        const sourcePath = declaration?.sourceIdentityPath || declaration?.sourcePath;
        return sourcePath && Number.isInteger(declaration.nameStart) ? `${sourcePath}#${declaration.nameStart}` : null;
    },

    /** @description Indexes known exported type records without resolving foreign annotations in local scope. */
    imports(externals)
    {
        const types = new Map();
        for(const external of externals.values())
        {
            for(const declaration of [ external, ...external.typeTable || [] ])
            {
                const key = this.key(declaration);
                if(key)
                {
                    types.set(key, declaration);
                }
            }
        }

        return types;
    },

    /** @description Serializes named types and their member-result links without recursive object references. */
    describe(registry)
    {
        const types = this.imports(registry._context.externals);
        for(const declaration of registry._context.declarations)
        {
            const key = this.key(declaration);
            if(declaration.kind !== 'class' || !key)
            {
                continue;
            }

            const identity = LgdAccessibility.identity(declaration);
            const members = registry.members(declaration).map(member =>
            {
                const owner = registry._declaringTypes.get(member);
                const sourcePath = owner ? LgdAccessibility.identity(owner).sourcePath : member.declaringSourcePath;
                return { ...member, declaringSourcePath: sourcePath };
            });

            types.set(key, { ...identity, exportName: declaration.name, kind: declaration.kind,
                accessibility: declaration.accessibility, constructorAccessibility: declaration.constructorMember?.accessibility || 'public',
                ancestry: LgdAccessibility.ancestry(declaration, registry), members: members });
        }

        return [...types.values()].map(declaration =>
        {
            const record = { ...declaration };
            delete record.typeTable;
            delete record.sourceText;
            return record;
        });
    }
};

module.exports = LgdMemberTypeGraph;
