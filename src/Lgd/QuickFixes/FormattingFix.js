const DiagnosticQuickFix = require('./DiagnosticQuickFix');

/** @description Adapts a verified formatter edit to the common guarded diagnostic-fix pipeline. */
class FormattingFix extends DiagnosticQuickFix
{
    /** @description Registers one family or option rule with a stable native action kind. */
    constructor(rule)
    {
        super(`format:${rule.id}`, true);
        this.ruleId = rule.id;
        this.parentRuleId = rule.parentRuleId;
        this.title = rule.title;
    }

    /** @description Uses only freshly analyzed source and the exact current configuration for a proposed edit. */
    createProposal(context, fix)
    {
        if(!context.configuration?.valid || !context.configuration.formatting?.enabled)
        {
            return null;
        }

        const error = context.formattingErrors?.find(candidate =>
        {
            const sameRange = candidate.offset === fix.offset && candidate.endOffset === fix.endOffset;
            return sameRange && candidate.ruleId === this.ruleId && candidate.newText === fix.newText;
        });

        if(!error || error.expectedText !== context.source.text.slice(error.offset, error.endOffset))
        {
            return null;
        }

        return { title: `Apply LGD ${this.title.toLowerCase()}`, target: context.source, snapshots: context.snapshots,
            offset: error.offset, endOffset: error.endOffset, newText: error.newText,
            ruleIds: Array.from(new Set([ this.ruleId, ...error.relatedRuleIds || [] ])) };
    }
}

module.exports = FormattingFix;
