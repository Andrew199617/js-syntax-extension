/** @description Short editor categories, independent of stable compiler diagnostic identities. */
const categories = Object.freeze({
    syntax: 'syntax',
    type: 'type',
    inheritance: 'inheritance',
    configuration: 'configuration',
    compilation: 'compilation',
    warning: 'warning',
    error: 'error'
});

/** @description Explicit diagnostic definitions link internal IDs to presentation and permitted fix strategies. */
const definitions = Object.freeze({
    'lgd.jsdoc.returnType': { category: 'warning', proposalKind: 'removeReturnDocType', fixKinds: ['removeReturnDocType'] },
    'lgd.jsdoc.virtual': { category: 'warning', proposalKind: 'moveVirtualModifier', fixKinds: ['moveVirtualModifier'] },
    'lgd.declaration.readonly': { category: 'warning', proposalKind: 'replaceReadonlyLocal', fixKinds: ['replaceReadonlyLocal'] },
    'lgd.object.inheritance': { category: 'inheritance', proposalKind: 'convertObjectInheritance', fixKinds: ['convertObjectInheritance'] },
    'lgd.output.syntax': { category: 'syntax' },
    'lgd.output.nativeSyntax': { category: 'syntax' },
    'lgd.assignment.typeMismatch': { category: 'type', proposalKind: 'changeParameterType',
        fixKinds: [ 'changeParameterType', 'changeParameterAndReturnType' ] },
    'lgd.member.receiverKind': { category: 'type', proposalKind: 'useStaticTypeReceiver', fixKinds: ['useStaticTypeReceiver'] },
    'lgd.return.typeMismatch': { category: 'type', proposalKind: 'changeReturnType', fixKinds: ['changeReturnType'] },
    'lgd.base.argumentCount': { category: 'inheritance', proposalKind: 'removeExtraBaseArguments', fixKinds: ['removeExtraBaseArguments'] },
    'lgd.override.nonVirtual': { category: 'inheritance', proposalKind: 'makeBaseVirtual', fixKinds: ['makeBaseVirtual'] },
    'lgd.override.required': { category: 'inheritance', proposalKind: 'addOverride', fixKinds: ['addOverride'] },
    'lgd.output.objectBase': { category: 'inheritance' },
    'lgd.output.olooDispatch': { category: 'inheritance' },
    'lgd.output.options': { category: 'configuration' },
    'lgd.output.target': { category: 'configuration' },
    'lgd.output.objectModel': { category: 'configuration' }
});

/** @description Registry shared by editor diagnostics and Quick Fix routing without transporting private compiler IDs. */
const LgdDiagnosticDefinitions = {
    source: 'LGD',

    /** @description Resolves a stable compiler identity to an explicit short editor definition. */
    get(error)
    {
        const definition = Object.hasOwn(definitions, error.code) ? definitions[error.code] : null;
        let category = definition?.category;
        if(Object.hasOwn(categories, error.category))
        {
            category = error.category;
        }

        if(!category)
        {
            category = error.severity === 'warning' ? 'warning' : 'error';
        }

        return { internalId: error.code, source: this.source, visibleCode: categories[category],
            proposalKind: definition?.proposalKind, fixKinds: definition?.fixKinds?.slice() || [] };
    },

    /** @description Allows only the registered strategy kinds for authoritative compiler-provided proposal metadata. */
    fixKinds(error)
    {
        const definition = this.get(error);
        if(!error.quickFix || error.quickFix.kind !== definition.proposalKind)
        {
            return [];
        }

        return definition.fixKinds;
    }
};

module.exports = LgdDiagnosticDefinitions;
