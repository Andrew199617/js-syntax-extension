const LgdFormattingOptions = require('../Formatting/LgdFormattingOptions');

/** @description Configuration adapters are data readers, ordered from lower to higher precedence. */
const sourceNames = [ 'editorconfig', 'clang-format', 'eslint' ];

/** @description Validates native formatting preferences and resolves family/option fix policies from one catalog. */
const LgdFormattingPolicy = {
    sourceNames: sourceNames,

    /** @description Lists formatting families and their independently configurable option rules. */
    rules()
    {
        return [ ...LgdFormattingOptions.catalog, ...LgdFormattingOptions.optionRules || [] ];
    },

    /** @description Finds a supported formatting rule without accepting arbitrary prefixed names. */
    definition(ruleId) { return this.rules().find(rule => rule.id === ruleId); },

    /** @description Merges an option's explicit policy over its family's settings. */
    setting(ruleId, rules)
    {
        const definition = this.definition(ruleId);
        const parent = definition?.parentRuleId ? rules[definition.parentRuleId] : null;
        return { ...parent, ...rules[ruleId] };
    },

    /** @description Overlays partial rule settings without losing a previously selected fix or severity. */
    mergeRules(base, additional)
    {
        const merged = { ...base };
        for(const [ ruleId, setting ] of Object.entries(additional || {}))
        {
            merged[ruleId] = { ...merged[ruleId], ...setting };
            if(setting.options)
            {
                merged[ruleId].options = { ...base[ruleId]?.options, ...setting.options };
                if(setting.options.wrapping)
                {
                    merged[ruleId].options.wrapping = { ...base[ruleId]?.options?.wrapping, ...setting.options.wrapping };
                }
            }
        }

        return merged;
    },

    /** @description Checks enabled adapters and native options before any filesystem import or edit. */
    validateFormatting(formatting)
    {
        if(formatting === undefined)
        {
            return;
        }

        this._keys(formatting, [ 'enabled', 'sources', 'options' ], 'formatting');
        if(formatting.enabled !== undefined && typeof formatting.enabled !== 'boolean')
        {
            throw new TypeError('LGD formatting.enabled must be true or false.');
        }

        if(formatting.sources !== undefined)
        {
            const valid = Array.isArray(formatting.sources) && formatting.sources.every(source => sourceNames.includes(source));
            if(!valid || new Set(formatting.sources).size !== formatting.sources.length)
            {
                throw new TypeError('LGD formatting.sources must contain unique editorconfig, clang-format, or eslint entries.');
            }
        }

        if(formatting.options !== undefined)
        {
            const groups = Object.fromEntries(LgdFormattingOptions.catalog.map(rule => [ this._group(rule.id), { type: 'object', properties: rule.properties } ]));
            this._properties(formatting.options, groups, 'formatting.options');
        }
    },

    /** @description Validates family option shapes and leaf severity/fix overrides using catalog definitions. */
    validateRule(ruleId, setting)
    {
        const definition = this.definition(ruleId);
        const keys = definition.parentRuleId ? [ 'fix', 'severity' ] : [ 'fix', 'severity', 'options' ];
        this._keys(setting, keys, `rules.${ruleId}`);
        if(setting.fix !== undefined && ![ 'off', 'manual', 'automatic' ].includes(setting.fix))
        {
            throw new Error(`LGD rules.${ruleId}.fix must be off, manual, or automatic.`);
        }

        if(setting.severity !== undefined && ![ 'off', 'warning', 'error' ].includes(setting.severity))
        {
            throw new Error(`LGD rules.${ruleId}.severity must be off, warning, or error.`);
        }

        if(setting.options !== undefined)
        {
            this._properties(setting.options, definition.properties, `rules.${ruleId}.options`);
        }
    },

    /** @description Merges explicit native layers while preserving independent brace location settings. */
    mergeFormatting(base, additional)
    {
        return { ...base, ...additional, options: LgdFormattingOptions.merge(base.options || {}, additional?.options) };
    },

    /** @description Applies imported preferences below native options and per-rule overrides. */
    resolve(native, imported, rules)
    {
        const combinedRules = this.mergeRules(imported.rules || {}, rules);
        const options = LgdFormattingOptions.merge(imported.options || {}, native.options);
        return {
            rules: combinedRules,
            formatting: { ...native, options: LgdFormattingOptions.resolve({ options: options, rules: combinedRules }) }
        };
    },

    _group(ruleId) { return ruleId.slice('lgd.format.'.length); },

    _keys(value, allowed, label)
    {
        if(!value || typeof value !== 'object' || Array.isArray(value))
        {
            throw new TypeError(`LGD ${label} must be an object.`);
        }

        for(const key of Object.keys(value))
        {
            if(!allowed.includes(key))
            {
                throw new Error(`Unknown LGD ${label} setting "${key}".`);
            }
        }
    },

    _properties(value, properties, label)
    {
        this._keys(value, Object.keys(properties), label);
        for(const [ key, option ] of Object.entries(value))
        {
            const schema = properties[key];
            const name = `${label}.${key}`;
            if(schema.enum && !schema.enum.includes(option))
            {
                throw new Error(`LGD ${name} must be one of: ${schema.enum.join(', ')}.`);
            }

            if(schema.type === 'boolean' && typeof option !== 'boolean')
            {
                throw new TypeError(`LGD ${name} must be true or false.`);
            }

            if(schema.type === 'integer' && (!Number.isInteger(option) || option < schema.minimum || option > schema.maximum))
            {
                throw new TypeError(`LGD ${name} must be an integer from ${schema.minimum} through ${schema.maximum}.`);
            }

            if(schema.type === 'object')
            {
                this._properties(option, schema.properties, name);
            }
        }
    }
};

module.exports = LgdFormattingPolicy;
