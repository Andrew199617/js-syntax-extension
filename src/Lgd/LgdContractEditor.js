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
        return { ...member, typeName: signature?.propertyTypeName || signature?.returnTypeName || member.typeName };
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

module.exports = { getContractMetadata: getContractMetadata, getTypedMembers: getTypedMembers, getInterfaceMembers: getInterfaceMembers };
