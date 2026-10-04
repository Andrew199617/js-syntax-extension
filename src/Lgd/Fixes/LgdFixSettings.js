const LgdFixGlob = require('./LgdFixGlob');
const LgdFormattingPolicy = require('./LgdFormattingPolicy');

/** @description Bounds declarative configuration collections and references before host-side discovery. */
const limits = { patterns: 256, overrides: 100, parents: 32, pathLength: 512 };

/** @description Editor-neutral JSON validation and effective rule-policy merging. */
const LgdFixSettings = {
    /** @description Creates a parser for the rule IDs registered by the caller. */
    create(ruleIds)
    {
        const settings = Object.create(this);
        settings.ruleIds = new Set(ruleIds);
        return settings;
    },

    /** @description Parses strict JSON and rejects unknown or invalid configuration before resolving imports. */
    parse(text)
    {
        let configuration;
        try
        {
            configuration = JSON.parse(text);
        }
        catch
        {
            throw new Error('Invalid JSON in LGD configuration. Remove comments, trailing commas, and other JSON syntax errors.');
        }

        this._validate(configuration);
        return configuration;
    },

    _validate(configuration)
    {
        this._validateKeys(configuration, [ '$schema', 'version', 'autoFix', 'rules', 'ignores', 'overrides', 'extends', 'formatting' ], 'configuration');
        if(configuration.version !== 1)
        {
            throw new Error('LGD configuration requires "version": 1.');
        }

        if(configuration.$schema !== undefined && typeof configuration.$schema !== 'string')
        {
            throw new TypeError('LGD configuration $schema must be a string.');
        }

        if(configuration.autoFix !== undefined && typeof configuration.autoFix !== 'boolean')
        {
            throw new TypeError('LGD configuration autoFix must be true or false.');
        }

        LgdFormattingPolicy.validateFormatting(configuration.formatting);
        this._validateRules(configuration.rules, 'rules');
        this._validatePatterns(configuration.ignores, 'ignores');
        this._validateExtends(configuration.extends);
        if(configuration.overrides === undefined)
        {
            return;
        }

        if(!Array.isArray(configuration.overrides) || configuration.overrides.length > limits.overrides)
        {
            throw new TypeError('LGD configuration overrides must be an array of at most 100 entries.');
        }

        for(const override of configuration.overrides)
        {
            this._validateKeys(override, [ 'files', 'ignores', 'rules' ], 'override');
            this._validatePatterns(override.files, 'override.files', true);
            this._validatePatterns(override.ignores, 'override.ignores');
            this._validateRules(override.rules, 'override.rules');
        }
    },

    _validateKeys(value, allowed, label)
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

    _validateRules(rules, label)
    {
        if(rules === undefined)
        {
            return;
        }

        this._validateKeys(rules, [...this.ruleIds], label);
        for(const [ ruleId, setting ] of Object.entries(rules))
        {
            if(LgdFormattingPolicy.definition(ruleId))
            {
                LgdFormattingPolicy.validateRule(ruleId, setting);
                continue;
            }

            if(ruleId === 'unnecessary-reference-cast')
            {
                this._validateKeys(setting, [ 'fix', 'severity' ], `${label}.${ruleId}`);
                if(setting.severity !== undefined && ![ 'off', 'warning', 'error' ].includes(setting.severity))
                {
                    throw new Error(`LGD ${label}.${ruleId}.severity must be off, warning, or error.`);
                }

                if(setting.fix === undefined)
                {
                    continue;
                }
            }
            else
            {
                this._validateKeys(setting, ['fix'], `${label}.${ruleId}`);
            }

            if(![ 'off', 'manual', 'automatic' ].includes(setting.fix))
            {
                throw new Error(`LGD ${label}.${ruleId}.fix must be "off", "manual", or "automatic".`);
            }
        }
    },

    _validatePatterns(patterns, label, required = false)
    {
        if(patterns === undefined && !required)
        {
            return;
        }

        if(!Array.isArray(patterns) || patterns.length > limits.patterns || required && patterns.length === 0)
        {
            throw new TypeError(`LGD ${label} must be an array of at most 256 glob strings${required ? ' with at least one pattern' : ''}.`);
        }

        if(patterns.some(pattern => !LgdFixGlob.isValidPattern(pattern)))
        {
            throw new Error(`LGD ${label} accepts project-relative globs with *, ?, and full-segment ** only (maximum 512 characters).`);
        }
    },

    _validateExtends(references)
    {
        if(references === undefined)
        {
            return;
        }

        const parents = typeof references === 'string' ? [references] : references;
        if(!Array.isArray(parents) || parents.length > limits.parents)
        {
            throw new TypeError('LGD extends must be a relative JSON path or an array of at most 32 paths.');
        }

        for(const reference of parents)
        {
            const relative = typeof reference === 'string' && (reference.startsWith('./') || reference.startsWith('../'));
            if(!relative || reference.length > limits.pathLength || !reference.endsWith('.json') || (/[\p{Cc}*:?\\]/u).test(reference))
            {
                throw new Error('LGD extends accepts only relative ./ or ../ JSON paths inside the workspace folder.');
            }
        }
    },

    /** @description Applies validated configuration layers and matching overrides without editor access. */
    applyLayers(result, layers, relativePath)
    {
        for(const layer of layers)
        {
            if(layer.autoFix !== undefined)
            {
                result.autoFix = layer.autoFix;
            }

            result.rules = LgdFormattingPolicy.mergeRules(result.rules, layer.rules);
            result.formatting = LgdFormattingPolicy.mergeFormatting(result.formatting, layer.formatting);
            if(layer.ignores?.some(pattern => LgdFixGlob.matches(pattern, relativePath)))
            {
                result.ignored = true;
            }

            for(const override of layer.overrides || [])
            {
                const matched = override.files.some(pattern => LgdFixGlob.matches(pattern, relativePath));
                const excluded = override.ignores?.some(pattern => LgdFixGlob.matches(pattern, relativePath));
                if(matched && !excluded)
                {
                    result.rules = LgdFormattingPolicy.mergeRules(result.rules, override.rules);
                }
            }
        }
    }
};

module.exports = LgdFixSettings;
