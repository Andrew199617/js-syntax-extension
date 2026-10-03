const LgdStyleJson = require('./LgdStyleJson');

/** @description Maps supported, data-only ESLint formatting preferences without loading ESLint or plugins. */
const LgdEslintStyle = {
    /** @description Reads declarative JSONC configuration only; executable configs, extends and plugin code are never evaluated. */
    parse(text, filename = '.eslintrc.json')
    {
        const result = { options: {}, rules: {}, issues: [], overrides: [], root: false, filename: filename };
        try
        {
            const configuration = LgdStyleJson.parse(text);
            if(!configuration || typeof configuration !== 'object' || Array.isArray(configuration))
            {
                throw new Error('Expected a JSON object.');
            }

            result.root = configuration.root === true;
            this.map(configuration.rules || {}, result);
            result.overrides = configuration.overrides || [];
            if(configuration.extends || configuration.plugins)
            {
                result.issues.push('ESLint extends and plugins are not executed; only explicit supported rule preferences are imported.');
            }
        }
        catch(error)
        {
            result.disabled = true;
            result.issues.push(`Cannot import ${filename}: ${error.message}`);
        }

        return result;
    },

    /** @description Supports standard and @stylistic rule spellings with independent severity mapping. */
    map(rules, result)
    {
        for(const [ sourceName, configured ] of Object.entries(rules))
        {
            const name = sourceName.replace(/^@stylistic\/(?:js\/)?/u, '');
            const entries = Array.isArray(configured) ? configured : [configured];
            const [ level, preference, details = {} ] = entries;
            const severities = { 0: 'off', 1: 'warning', 2: 'error', off: 'off', warn: 'warning', error: 'error' };
            const severity = severities[level];
            const changes = this.ruleOptions(name, preference, details);
            if(!changes)
            {
                result.issues.push(`ESLint rule ${sourceName} has no supported LGD style mapping.`);
                continue;
            }

            for(const [ group, options ] of Object.entries(changes))
            {
                if(severity !== 'off')
                {
                    result.options[group] = { ...result.options[group], ...options };
                }

                this.setSeverity(result, group, options, severity);
            }
        }
    },

    /** @description Keeps each imported option severity independent of unrelated formatting preferences. */
    setSeverity(result, group, options, severity)
    {
        if(!severity)
        {
            return;
        }

        for(const option of Object.keys(options))
        {
            const key = option === 'style' && group === 'braces' ? 'lgd.format.braces' : `lgd.format.${group}.${option}`;
            result.rules[key] = { severity: severity };
        }
    },

    /** @description Exposes supported foreign-rule variants rather than assuming all ESLint rules are formatters. */
    ruleOptions(name, preference, details)
    {
        const inside = preference === 'always';
        if(name === 'brace-style')
        {
            const styles = { '1tbs': 'attach', allman: 'allman', stroustrup: 'stroustrup' };
            if(!styles[preference])
            {
                return null;
            }

            return { braces: { style: styles[preference], beforeElse: preference !== '1tbs', beforeCatch: preference !== '1tbs', beforeFinally: preference !== '1tbs' }, lineBreaks: { shortBlocks: details.allowSingleLine ? 'always' : 'never' } };
        }

        if(name === 'curly')
        {
            if(![ undefined, 'all', 'multi-line' ].includes(preference))
            {
                return null;
            }

            return { bracesRequired: { mode: preference === 'multi-line' ? 'multiLine' : 'always' } };
        }

        if(name === 'indent')
        {
            const options = { style: preference === 'tab' ? 'tab' : 'space' };
            if(Number.isInteger(preference))
            {
                options.size = preference;
            }

            if(Number.isInteger(details.SwitchCase))
            {
                options.caseLabels = details.SwitchCase > 0;
            }

            return { indentation: options };
        }

        const simple = {
            'space-in-parens': { spacing: { insideControlParens: inside, insideDeclarationParens: inside, insideCallParens: inside, insideOtherParens: inside } },
            'array-bracket-spacing': { spacing: { insideSquareBrackets: inside } },
            'object-curly-spacing': { spacing: { insideObjectBraces: inside } },
            'space-infix-ops': { spacing: { binaryOperators: 'both', beforeAssignment: true, afterAssignment: true } },
            'no-trailing-spaces': { whitespace: { trimTrailingWhitespace: true } },
            'eol-last': { whitespace: { finalNewline: preference === 'never' ? 'never' : 'always' } },
            'linebreak-style': { whitespace: { endOfLine: preference === 'windows' ? 'crlf' : 'lf' } },
            'no-multiple-empty-lines': { lineBreaks: { maxEmptyLines: preference?.max ?? 1 } },
            'operator-linebreak': { wrapping: { binaryOperators: preference === 'before' ? 'before' : 'after' } }
        };
        if(simple[name])
        {
            return simple[name];
        }

        if(name === 'comma-spacing')
        {
            return { spacing: { beforeComma: preference?.before === true, afterComma: preference?.after !== false } };
        }

        if(name === 'keyword-spacing')
        {
            return { spacing: { afterControlKeywords: preference?.after !== false } };
        }

        if(name === 'space-before-function-paren')
        {
            if(typeof preference === 'object')
            {
                return null;
            }

            return { spacing: { beforeMethodParen: inside, beforeFunctionParen: inside } };
        }

        return null;
    }
};

module.exports = LgdEslintStyle;
