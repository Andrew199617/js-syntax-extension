const Types = require('../Parsers/Types');

/** @description Maps each LGD type keyword to its TypeScript type, reusing the shared Types constants. */
const tsTypeMap = {
    Number: Types.NUMBER,
    String: Types.STRING,
    Boolean: Types.BOOLEAN,
    BigInt: 'bigint',
    Symbol: 'symbol',
    Object: Types.OBJECT,
    Array: Types.ANYARRAY,
    Function: Types.FUNCTION
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
