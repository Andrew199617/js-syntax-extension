const LgdDeclarationStyleOptions = require('./LgdDeclarationStyleOptions');

/** @description Translates declaration preferences only to the guarded LGD declaration subset. */
const LgdDeclarationStyleImport = {
    /** @description Returns null for unhandled preferences so adapters can report them rather than silently ignoring them. */
    map(adapter, result, property)
    {
        const { key, value } = property;
        if(key === 'csharp_preferred_modifier_order')
        {
            const names = value.split(',').map(name => name.trim());
            if(names.some(name => !(/^[a-z]+$/u).test(name)) || new Set(names).size !== names.length)
            {
                return adapter.unsupported(result, key, 'Expected a comma-separated list of unique modifier names.');
            }

            const supported = LgdDeclarationStyleOptions.properties.modifierOrder.properties;
            const ranks = Object.fromEntries(names.filter(name => Object.hasOwn(supported, name)).map((name, index) => [ name, index ]));
            return adapter.setOption(result, [ 'declarations', 'modifierOrder' ], ranks);
        }

        if(key === 'dotnet_style_require_accessibility_modifiers')
        {
            if([ 'always', 'for_non_interface_members' ].includes(value))
            {
                return adapter.setOption(result, [ 'declarations', 'accessibility' ], value);
            }

            return adapter.unsupported(result, key, 'LGD supports explicit public defaults on class members; removing accessibility is not inferred.');
        }

        if(key === 'csharp_style_var_for_built_in_types')
        {
            if([ 'true', 'false' ].includes(value))
            {
                return adapter.setOption(result, [ 'declarations', 'localTypes' ], value === 'true' ? 'inferred' : 'explicit');
            }

            return adapter.unsupported(result, key, 'Expected true or false; LGD changes only immutable primitive-literal bindings.');
        }

        return null;
    }
};

module.exports = LgdDeclarationStyleImport;
