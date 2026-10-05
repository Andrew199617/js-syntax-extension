const LgdConstructorSignatures = require('../Compilers/LgdConstructorSignatures');
const LgdMethodDocumentation = require('../Compilers/LgdMethodDocumentation');
const { getConstructorParams } = require('../Compilers/LgdBaseChecker');
const LgdClassMemberSemantics = require('../Compilers/LgdClassMemberSemantics');
const LgdContractChecker = require('../Compilers/LgdContractChecker');
const LgdClassMemberLookup = require('./LgdClassMemberLookup');

/**
 * @description Describes a declared name for hover and completions: its type and members.
 * Require initializers are followed into the sibling .lgd file they load.
 * @param {Uri} uri the LGD document uri.
 * @param {string} name the hovered or completed name.
 * @returns {Promise<Object|null>} the {name, typeName, readonly, members, params} summary, or null.
 */
async function getTypeSummary(service, uri, name)
{
    const state = service.getState(uri);
    if(!state || !state.declarations)
    {
        return null;
    }

    const context = service.getMemberContext(state);
    const declaration = state.declarations.find(candidate => candidate.name === name);
    if(!declaration)
    {
        const imported = service.findImportedType(name, context);
        return imported
            ? {
                name: name, typeName: imported.keyword, kind: imported.kind, baseName: imported.baseName,
                documentation: LgdMethodDocumentation.parse(imported.jsdoc || '/** */'),
                abstract: imported.abstract, interfaceNames: imported.interfaceNames,
                accessibility: imported.accessibility, explicitAccessibility: imported.explicitAccessibility,
                readonly: true, members: imported.members || [], params: [],
                constructorSignatures: imported.constructorSignatures,
                constructorParams: imported.constructorParams || []
            }
            : null;
    }

    let required = service.getRequiredType(declaration.initializerText || '', context.externals);
    let members = service.getDeclaredMembers(declaration, context);
    if(required || members.length === 0)
    {
        const target = await service.resolveRequireTarget(state.document, declaration);
        if(target)
        {
            members = target.members;
            required = target;
        }
    }

    const summary = {
        kind: required?.kind === 'enum' ? 'enum' : declaration.kind,
        name: declaration.name,
        typeName: declaration.typeName,
        readonly: declaration.readonly,
        members: members,
        params: service.describeTypedParams(declaration.typedParams)
    };
    if([ 'class', 'interface', 'enum' ].includes(summary.kind))
    {
        summary.accessibility = required?.accessibility || declaration.accessibility;
        summary.explicitAccessibility = required?.explicitAccessibility || Number.isInteger(declaration.accessibilityStart);
    }

    if(declaration.kind === 'class' || declaration.kind === 'interface' || required?.kind === 'class' || required?.kind === 'interface')
    {
        summary.kind = required?.kind || declaration.kind;
        summary.documentation = LgdMethodDocumentation.parse(required?.jsdoc || declaration.jsdoc || '/** */');
        summary.abstract = declaration.abstract || required?.abstract;
        summary.interfaceNames = declaration.interfaceNames || required?.interfaceNames || [];
        summary.baseName = declaration.baseName || required?.baseName;
        summary.constructorParams = getConstructorParams(declaration) || required?.constructorParams || [];
        summary.constructorSignatures = LgdConstructorSignatures.describeAll(required?.kind === 'class' ? required : declaration);
    }

    return summary;
}

/**
 * @description Copies source-independent interface and abstract metadata into imported type entries.
 * @param {Object} exported the resolved LGD export.
 * @returns {Object} contract fields and declaration offsets for editor navigation.
 */
function getContractMetadata(exported)
{
    return {
        contractKind: exported.contractKind,
        abstract: exported.abstract,
        interfaceNames: exported.interfaceNames,
        contractSignatures: exported.contractSignatures,
        contractsKnown: exported.contractsKnown,
        nameStart: exported.nameStart,
        nameEnd: exported.nameEnd
    };
}

/**
 * @description Adds declared property and return types to parsed members without mutating shared declarations.
 * @param {Object} declaration the parsed LGD declaration.
 * @returns {Array} fresh member descriptions.
 */
function getTypedMembers(declaration)
{
    return (declaration.members || []).map(member =>
    {
        const signature = declaration.classMembers?.find(candidate => candidate.name === member.name);
        return { ...member, typeName: signature?.propertyTypeName || signature?.returnTypeName || member.typeName,
            static: signature ? Boolean(signature.static) : member.static, declaringType: declaration.kind === 'class' ? declaration.name : member.declaringType };
    });
}

/**
 * @description Describes inherited interface members without presenting them as executable class members.
 * @param {Object} declaration the parsed interface.
 * @param {Object} context the source declarations and imports.
 * @returns {Array} deduplicated transitive contract members.
 */
function getInterfaceMembers(declaration, context)
{
    const contracts = LgdContractChecker.describeContracts(context.sourceText, context.declarations, declaration, context.externals);
    const members = new Map();
    for(const signature of contracts.contractSignatures)
    {
        members.set(signature.name, { name: signature.name, kind: signature.kind,
            typeName: signature.propertyTypeName || signature.returnTypeName });
    }

    return [...members.values()];
}

/** @description Describes class runtime members while preserving legacy object constructor summaries. */
function getRuntimeMembers(declaration, context, getObjectMembers)
{
    if(declaration.kind === 'class')
    {
        const described = LgdClassMemberSemantics.describeMembers(context.sourceText, context.declarations, declaration, context.externals);
        return getObjectMembers(declaration).map(member =>
        {
            const sourceMember = described.find(candidate => candidate.name === member.name);
            const description = LgdClassMemberLookup.withInheritedSignature(sourceMember, declaration);
            return { ...member, ...description, declaringSourcePath: description?.declaringSourcePath || context.sourcePath || null };
        });
    }

    return getObjectMembers(declaration);
}

/** @description Filters known class type or instance receiver members for editor completion. */
function filterReceiverMembers(members, typeReceiver)
{
    return members.filter(member => Boolean(member.static) === typeReceiver);
}

/** @description Hides static members from instance this and all members from static this. */
function filterThisMembers(members, declaration, offset)
{
    const owner = declaration.classMembers?.find(member => member.start <= offset && offset < member.bodyEnd);
    if(owner?.static)
    {
        return [];
    }

    return declaration.kind === 'class' ? filterReceiverMembers(members, false) : members;
}

/** @description Selects declared members for an instance while preserving imported type objects. */
function filterDeclaredMembers(members, declaration, required)
{
    return declaration.kind !== 'class' && !required ? filterReceiverMembers(members, false) : members;
}

module.exports = { getTypeSummary: getTypeSummary, filterDeclaredMembers: filterDeclaredMembers,
    getRuntimeMembers: getRuntimeMembers, filterReceiverMembers: filterReceiverMembers, filterThisMembers: filterThisMembers,
    getContractMetadata: getContractMetadata, getTypedMembers: getTypedMembers, getInterfaceMembers: getInterfaceMembers };
