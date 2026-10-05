const DiagnosticQuickFix = require('../QuickFixes/DiagnosticQuickFix');
const LgdFormattingRules = require('./LgdFormattingRules');
const LgdFormattingOptions = require('../Formatting/LgdFormattingOptions');

/** @description Bounds local whitespace settling without changing the requested syntax transformation. */
const MAX_PASSES = 10;

/** @description Composes canonical, permitted whitespace cleanup with a requested fix in one original-source edit. */
const LgdFixComposition = {
    /** @description Leaves unrelated tokens, disabled rules and protected source to their own explicit actions. */
    compose(proposal, configurations, eligible)
    {
        const edits = DiagnosticQuickFix.edits(proposal);
        if(edits.every(edit => this.whitespace(edit.target.text.slice(edit.offset, edit.endOffset)) && this.whitespace(edit.newText)))
        {
            return proposal;
        }

        const documents = new Map();
        for(const edit of edits)
        {
            const key = edit.target.document.uri.toString();
            const group = documents.get(key) || { target: edit.target, edits: [] };
            group.edits.push(edit);
            documents.set(key, group);
        }

        const composed = [];
        let changed = false;
        for(const [ key, group ] of documents)
        {
            const configuration = configurations.get(key);
            const windows = this.windows(group.target.text, group.edits);
            const normalized = this.normalize(group.target.text, windows, configuration, eligible);
            for(const window of normalized)
            {
                if(window.newText === window.originalNewText)
                {
                    composed.push(...window.edits);
                    continue;
                }

                changed = true;
                composed.push({ target: group.target, offset: window.offset, endOffset: window.endOffset, newText: window.newText,
                    expectedText: group.target.text.slice(window.offset, window.endOffset),
                    ruleIds: Array.from(new Set([ ...proposal.ruleIds || [], ...window.ruleIds ])),
                    endOfLine: LgdFormattingOptions.resolve({ options: configuration?.formatting?.options, rules: configuration?.rules }).whitespace.endOfLine });
            }
        }

        if(!changed)
        {
            return proposal;
        }

        const [ primary, ...additional ] = composed;
        return { ...proposal, ...primary, additionalEdits: additional };
    },

    /** @description Extends only into the whitespace touching an edit, then merges its own adjacent edit windows. */
    windows(source, edits)
    {
        const windows = [];
        for(const edit of edits.slice().sort((left, right) => left.offset - right.offset))
        {
            let offset = edit.offset;
            let endOffset = edit.endOffset;
            while(offset > 0 && this.whitespace(source[offset - 1]))
            {
                offset--;
            }

            while(endOffset < source.length && this.whitespace(source[endOffset]))
            {
                endOffset++;
            }

            const previous = windows.at(-1);
            if(previous && offset <= previous.endOffset)
            {
                previous.endOffset = Math.max(previous.endOffset, endOffset);
                previous.edits.push(edit);
            }
            else
            {
                windows.push({ offset: offset, endOffset: endOffset, edits: [edit], ruleIds: new Set() });
            }
        }

        for(const window of windows)
        {
            window.newText = source.slice(window.offset, window.endOffset);
            for(const edit of window.edits.slice().reverse())
            {
                const start = edit.offset - window.offset;
                const end = edit.endOffset - window.offset;
                window.newText = window.newText.slice(0, start) + edit.newText + window.newText.slice(end);
            }

            window.originalNewText = window.newText;
        }

        return windows;
    },

    /** @description Reuses the ordinary findings and complete related-rule policy inside each affected whitespace boundary. */
    normalize(source, windows, configuration, eligible)
    {
        const seen = new Set();
        for(let pass = 0; pass < MAX_PASSES; pass++)
        {
            const preview = this.preview(source, windows);
            if(seen.has(preview))
            {
                break;
            }

            seen.add(preview);
            const localWhitespace = error => this.whitespace(error.expectedText) && this.whitespace(error.newText) && eligible(error, configuration);
            const errors = LgdFormattingRules.analyze(preview, configuration).filter(localWhitespace);

            let changed = false;
            for(const window of windows)
            {
                const findings = errors.filter(error => error.offset >= window.previewStart && error.endOffset <= window.previewEnd);
                for(const error of findings.sort((left, right) => right.offset - left.offset))
                {
                    const start = error.offset - window.previewStart;
                    const end = error.endOffset - window.previewStart;
                    window.newText = window.newText.slice(0, start) + error.newText + window.newText.slice(end);
                    window.ruleIds.add(error.ruleId);
                    for(const ruleId of error.relatedRuleIds || [])
                    {
                        window.ruleIds.add(ruleId);
                    }

                    changed = true;
                }
            }

            if(!changed)
            {
                break;
            }
        }

        return windows;
    },

    /** @description Tracks post-edit windows without interpreting original offsets as offsets in the preview. */
    preview(source, windows)
    {
        let result = '';
        let boundary = 0;
        for(const window of windows)
        {
            result += source.slice(boundary, window.offset);
            window.previewStart = result.length;
            result += window.newText;
            window.previewEnd = result.length;
            boundary = window.endOffset;
        }

        return result + source.slice(boundary);
    },

    /** @description Rejects token-changing or comment-changing follow-on transformations. */
    whitespace(text) { return typeof text === 'string' && (/^\s*$/u).test(text); }
};

module.exports = LgdFixComposition;
