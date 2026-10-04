/** @description Declaration preferences remain opt-in and each option has its own diagnostic/fix policy. */
const modifiers = [ 'public', 'private', 'protected', 'internal', 'static', 'abstract', 'virtual', 'override', 'readonly', 'async' ];

module.exports = {
    id: 'lgd.format.declarations', title: 'Declaration style',
    defaults: { modifierOrder: {}, accessibility: 'preserve', localTypes: 'preserve' },
    properties: {
        modifierOrder: { type: 'object', additionalProperties: false, properties: Object.fromEntries(modifiers.map(name => [ name, { type: 'integer', minimum: 0, maximum: 100 } ])) },
        accessibility: { enum: [ 'preserve', 'always', 'for_non_interface_members' ] },
        localTypes: { enum: [ 'preserve', 'explicit', 'inferred' ] }
    }
};
