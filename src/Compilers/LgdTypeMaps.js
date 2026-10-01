/** @description Maps each LGD type keyword to its TypeScript type. */
const tsTypeMap = {
    Number: 'number',
    String: 'string',
    Boolean: 'boolean',
    BigInt: 'bigint',
    Symbol: 'symbol',
    Object: 'Object',
    Array: 'any[]',
    Function: 'Function'
};

/** @description Maps each LGD type keyword to its C# type. Array and Function need special handling, see CSharpBackend. */
const csharpTypeMap = {
    Number: 'double',
    String: 'string',
    Boolean: 'bool',
    BigInt: 'long',
    Symbol: 'object',
    Object: 'dynamic',
    Array: 'List<dynamic>',
    Function: 'Func<dynamic>'
};

module.exports = {
    tsTypeMap: tsTypeMap,
    csharpTypeMap: csharpTypeMap
};
