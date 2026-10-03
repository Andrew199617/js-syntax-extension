const LgdClassMemberSemantics = require('../Compilers/LgdClassMemberSemantics');
const LgdContractChecker = require('../Compilers/LgdContractChecker');

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
            const description = described.find(candidate => candidate.name === member.name);
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

module.exports = { filterDeclaredMembers: filterDeclaredMembers,
    getRuntimeMembers: getRuntimeMembers, filterReceiverMembers: filterReceiverMembers, filterThisMembers: filterThisMembers,
    getContractMetadata: getContractMetadata, getTypedMembers: getTypedMembers, getInterfaceMembers: getInterfaceMembers };
