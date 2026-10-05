const LgdFormattingPolicy = require('./Fixes/LgdFormattingPolicy');

/** @description Short editor categories, independent of stable compiler diagnostic identities. */
const categories = Object.freeze({
    syntax: 'syntax',
    style: 'style',
    type: 'type',
    inheritance: 'inheritance',
    configuration: 'configuration',
    compilation: 'compilation',
    warning: 'warning',
    error: 'error'
});

/** @description Explicit diagnostic definitions link internal IDs to presentation and permitted fix strategies. */
const definitions = Object.freeze({
    'lgd.cast.redundant': { category: 'style', proposalKind: 'removeRedundantCast', fixKinds: ['removeRedundantCast'] },
    'lgd.jsdoc.returnType': { category: 'warning', proposalKind: 'removeReturnDocType', fixKinds: ['removeReturnDocType'] },
    'lgd.syntax.declarationModifier': { category: 'syntax' },
    'lgd.access.inaccessible': { category: 'type' },
    'lgd.access.signature': { category: 'type' },
    'lgd.access.override': { category: 'type' },
    'lgd.access.privateVirtual': { category: 'type' },
    'lgd.access.interfaceMember': { category: 'type' },
    'lgd.access.accessor': { category: 'syntax' },
    'lgd.jsdoc.virtual': { category: 'warning', proposalKind: 'moveVirtualModifier', fixKinds: ['moveVirtualModifier'] },
    'lgd.declaration.readonly': { category: 'warning', proposalKind: 'replaceReadonlyLocal', fixKinds: ['replaceReadonlyLocal'] },
    'lgd.object.inheritance': { category: 'inheritance', proposalKind: 'convertObjectInheritance', fixKinds: [ 'convertObjectInheritance', 'prepareObjectInheritance' ] },
    'lgd.class.inheritanceDoc': { category: 'inheritance', proposalKind: 'convertObjectInheritance', proposalKinds: ['removeInheritanceDoc'],
        fixKinds: [ 'convertObjectInheritance', 'prepareObjectInheritance', 'removeInheritanceDoc' ] },
    'lgd.constructor.factory': { category: 'syntax', proposalKind: 'convertObjectInheritance', fixKinds: [ 'convertObjectInheritance', 'prepareObjectInheritance' ] },
    'lgd.constructor.name': { category: 'syntax', proposalKind: 'renameClassConstructor', fixKinds: ['renameClassConstructor'] },
    'lgd.output.syntax': { category: 'syntax' },
    'lgd.output.nativeSyntax': { category: 'syntax' },
    'lgd.assignment.typeMismatch': { category: 'type', proposalKind: 'changeParameterType',
        fixKinds: [ 'changeParameterType', 'changeParameterAndReturnType' ] },
    'lgd.member.unresolvedBaseImport': { category: 'inheritance' },
    'lgd.member.foreignBaseFields': { category: 'inheritance' },
    'lgd.output.fieldInitializationOrder': { category: 'inheritance' },
    'lgd.member.receiverKind': { category: 'type', proposalKind: 'useStaticTypeReceiver', fixKinds: ['useStaticTypeReceiver'] },
    'lgd.constructor.returnValue': { category: 'syntax', proposalKind: 'replaceConstructorReturnThis',
        proposalKinds: [ 'replaceConstructorReturnThis', 'convertObjectInheritance' ],
        fixKinds: [ 'replaceConstructorReturnThis', 'convertObjectInheritance', 'prepareObjectInheritance' ] },
    'lgd.return.typeMismatch': { category: 'type', proposalKind: 'changeReturnType', fixKinds: ['changeReturnType'] },
    'lgd.base.argumentCount': { category: 'inheritance', proposalKind: 'removeExtraBaseArguments', fixKinds: ['removeExtraBaseArguments'] },
    'lgd.override.nonVirtual': { category: 'inheritance', proposalKind: 'makeBaseVirtual', fixKinds: ['makeBaseVirtual'] },
    'lgd.override.required': { category: 'inheritance', proposalKind: 'addOverride', fixKinds: ['addOverride'] },
    'lgd.output.objectBase': { category: 'inheritance' },
    'lgd.output.mixedBase': { category: 'inheritance' },
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
        let definition = Object.hasOwn(definitions, error.code) ? definitions[error.code] : null;
        if(!definition && LgdFormattingPolicy.definition(error.code))
        {
            const kind = `format:${error.code}`;
            definition = { category: 'style', proposalKind: kind, fixKinds: [kind] };
        }

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
            proposalKind: definition?.proposalKind, proposalKinds: definition?.proposalKinds?.slice() || [], fixKinds: definition?.fixKinds?.slice() || [] };
    },

    /** @description Allows only the registered strategy kinds for authoritative compiler-provided proposal metadata. */
    fixKinds(error)
    {
        const definition = this.get(error);
        if(!error.quickFix || error.quickFix.kind !== definition.proposalKind && !definition.proposalKinds.includes(error.quickFix.kind))
        {
            return [];
        }

        return definition.fixKinds;
    }
};

module.exports = LgdDiagnosticDefinitions;
