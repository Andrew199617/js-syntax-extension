const { collectScopes, collectBindings } = require('./LgdBaseChecker');
const { maskCode } = require('./LgdInfer');
const LgdContractChecker = require('./LgdContractChecker');
const LgdSourceMap = require('./LgdSourceMap');
const { tsTypeMap } = require('./LgdTypeMaps');

/** @description Converts an explicit LGD contract annotation into a JavaScript documentation type. */
function annotationType(typeName)
{
    return typeName === 'void' ? 'void' : tsTypeMap[typeName] || typeName || 'unknown';
}

/** @description Formats one contract method parameter for a documentation function type. */
function parameterType(parameter, index)
{
    const name = parameter.name || `argument${index + 1}`;
    const type = annotationType(parameter.typeName);
    if(parameter.rest)
    {
        return `...${name}: ${type}[]`;
    }

    const optional = parameter.optional || parameter.defaultText !== null && parameter.defaultText !== undefined;
    return `${name}${optional ? '?' : ''}: ${type}`;
}

/** @description Builds an editor-only interface shape from the same contracts used by validation. */
function interfaceShape(signatures)
{
    const members = new Map();
    for(const signature of signatures || [])
    {
        let type = annotationType(signature.propertyTypeName);
        if(signature.kind === 'method')
        {
            const params = (signature.params || []).map(parameterType).join(', ');
            type = `(${params}) => ${annotationType(signature.returnTypeName)}`;
        }

        const readonly = signature.kind === 'property' && signature.getter && !signature.setter ? 'readonly ' : '';
        members.set(signature.name, `${readonly}${signature.name}: ${type}`);
    }

    return `{${[...members.values()].join(', ')}}`;
}

/**
 * @description Retains interface type evidence in JavaScript comments after runtime declarations are erased.
 * @param {string} content the LGD source text.
 * @param {Array} declarations all parsed declarations.
 * @param {Map} externals resolved relative exports.
 * @param {Object} emitted JavaScript code and source mapping segments.
 * @returns {Object} code and mappings with comment-only structural typedefs.
 */
function apply(content, declarations, externals, emitted)
{
    const masked = maskCode(content, true);
    const bindings = collectBindings({ content: content, masked: masked, declarations: declarations,
        scopes: collectScopes(masked), externals: externals });
    const map = LgdSourceMap.create(emitted.segments);
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const edits = [];
    const seen = new Set();
    for(const binding of bindings)
    {
        const declaration = binding.declaration;
        if(declaration.kind !== 'interface' && declaration.contractKind !== 'interface')
        {
            continue;
        }

        const identity = `${binding.name}:${binding.scope.start}`;
        if(seen.has(identity))
        {
            continue;
        }

        seen.add(identity);
        const local = declarations.includes(declaration);
        const contracts = local
            ? LgdContractChecker.describeContracts(content, declarations, declaration, externals)
            : declaration;
        const offset = local ? declaration.start : binding.offset;
        const indent = local ? declaration.indent : '';
        const shape = interfaceShape(contracts.contractSignatures);
        const position = map.toOutput(offset);
        edits.push({ start: position, end: position,
            text: `${indent}/** @typedef {${shape}} ${binding.name} */${newline}` });
    }

    if(edits.length === 0)
    {
        return emitted;
    }

    const segments = emitted.segments.map(segment => ({ ...segment }));
    return { code: LgdSourceMap.applyEdits(emitted.code, segments, edits), segments: segments };
}

module.exports = { apply: apply };
