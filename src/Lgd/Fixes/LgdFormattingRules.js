const LgdFormatter = require('../Formatting/LgdFormatter');
const LgdFormattingPolicy = require('./LgdFormattingPolicy');

/** @description Adapts editor-neutral formatter findings to the shared diagnostic and fix-rule protocol. */
const LgdFormattingRules = {
    /** @description Produces only supported current style diagnostics and exact source edit metadata. */
    analyze(source, configuration)
    {
        if(!configuration?.valid || configuration.ignored || !configuration.formatting?.enabled)
        {
            return [];
        }

        const findings = LgdFormatter.analyze(source, { options: configuration.formatting.options, rules: configuration.rules });
        const errors = [];
        for(const finding of findings)
        {
            const ruleIds = Array.from(new Set([ finding.ruleId, ...finding.relatedRuleIds || [] ]));
            const supported = ruleIds.every(ruleId => LgdFormattingPolicy.definition(ruleId));
            const enabled = ruleIds.every(ruleId => LgdFormattingPolicy.setting(ruleId, configuration.rules).severity !== 'off');
            if(!supported || !enabled || finding.expectedText !== source.slice(finding.offset, finding.endOffset))
            {
                continue;
            }

            const severity = LgdFormattingPolicy.setting(finding.ruleId, configuration.rules).severity || 'warning';
            errors.push({ ...finding, severity: severity, relatedRuleIds: ruleIds,
                quickFix: { kind: `format:${finding.ruleId}`, offset: finding.offset, endOffset: finding.endOffset, newText: finding.newText } });
        }

        return errors;
    }
};

module.exports = LgdFormattingRules;
