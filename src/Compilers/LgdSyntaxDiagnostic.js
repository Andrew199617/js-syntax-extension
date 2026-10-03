const LgdSourceMap = require('./LgdSourceMap');
const { maskCode } = require('./LgdInfer');

/** @description Builds actionable syntax diagnostics from parser details and verified source-map context. */
const LgdSyntaxDiagnostic = {
    /**
     * @description Keeps parser details for debugging while reporting source syntax only at verified copied positions.
     * @param {Object} emitted the final JavaScript and mapping segments.
     * @param {string} source the original source, when available.
     * @param {SyntaxError} error the original parser failure.
     * @returns {Object} a source-relative diagnostic with parser metadata.
     */
    create(emitted, source, error)
    {
        const map = LgdSourceMap.create(emitted.segments);
        const position = Math.min(error.pos ?? 0, emitted.code.length);
        const offset = map.toSource(position);
        const endOffset = Math.max(offset, map.toSource(Math.min(position + 1, emitted.code.length)));
        const detail = error.message.replace(/ \(\d+:\d+\)$/, '');
        const sourcePosition = typeof source === 'string' && this._isCopiedPosition(emitted, source, position, offset);
        let message = `Unable to compile this syntax: ${detail}`;
        if(sourcePosition && error.reasonCode === 'UnexpectedToken' && this._hasMissingExpression(emitted, source, position, offset))
        {
            message = "Expected an expression after '='.";
        }

        return {
            offset: offset,
            endOffset: endOffset,
            code: 'lgd.output.syntax',
            message: message,
            debug: { reasonCode: error.reasonCode, generatedOffset: position, parserMessage: error.message }
        };
    },

    /** @description Confirms that the failing character or EOF boundary comes from unchanged source text. */
    _isCopiedPosition(emitted, source, position, offset)
    {
        if(position < emitted.code.length)
        {
            return this._isCopiedRange(emitted, source, { outputStart: position, sourceStart: offset, length: 1 });
        }

        if(offset !== source.length)
        {
            return false;
        }

        return emitted.segments.some(segment =>
        {
            const copiedEnd = segment.verbatim && segment.outStart < position && segment.outEnd === position && segment.srcEnd === offset;
            return copiedEnd && source[offset - 1] === emitted.code[position - 1];
        });
    },

    /** @description Verifies contiguous unchanged source coverage across adjacent mapping segments. */
    _isCopiedRange(emitted, source, range)
    {
        let cursor = range.outputStart;
        const end = range.outputStart + range.length;
        while(cursor < end)
        {
            const outputOffset = cursor;
            const segment = emitted.segments.find(candidate => candidate.outStart <= outputOffset && outputOffset < candidate.outEnd);
            const sourceStart = range.sourceStart + cursor - range.outputStart;
            if(!segment?.verbatim || segment.srcStart + cursor - segment.outStart !== sourceStart)
            {
                return false;
            }

            const chunkEnd = Math.min(segment.outEnd, end);
            if(source.slice(sourceStart, sourceStart + chunkEnd - cursor) !== emitted.code.slice(cursor, chunkEnd))
            {
                return false;
            }

            cursor = chunkEnd;
        }

        return true;
    },

    /** @description Recognizes only a plain assignment operator followed by trivia and the failing semicolon or EOF. */
    _missingExpressionOperator(code, position)
    {
        if(position !== code.length && code[position] !== ';')
        {
            return -1;
        }

        const masked = maskCode(code, true);
        let operator = position - 1;
        while(operator >= 0 && (/\s/).test(masked[operator]))
        {
            operator--;
        }

        if(masked[operator] !== '=' || (/[!%&*+/<=>?^|-]/).test(masked[operator - 1] || ''))
        {
            return -1;
        }

        const trailing = code.slice(operator + 1, position);
        const triviaOnly = (/^(?:\s|\/\*[\S\s]*?\*\/|\/\/[^\n\r]*)*$/).test(trailing);
        return triviaOnly ? operator : -1;
    },

    /** @description Requires matching source context and mapping provenance before identifying a missing expression. */
    _hasMissingExpression(emitted, source, position, offset)
    {
        const sourceOperator = this._missingExpressionOperator(source, offset);
        const outputOperator = this._missingExpressionOperator(emitted.code, position);
        if(sourceOperator < 0 || outputOperator < 0)
        {
            return false;
        }

        const trailingLength = position - outputOperator - 1;
        const trailingRange = { outputStart: outputOperator + 1, sourceStart: sourceOperator + 1, length: trailingLength };
        if(trailingLength !== offset - sourceOperator - 1 || !this._isCopiedRange(emitted, source, trailingRange))
        {
            return false;
        }

        if(this._isCopiedRange(emitted, source, { outputStart: outputOperator, sourceStart: sourceOperator, length: 1 }))
        {
            return true;
        }

        // Typed declaration heads rewrite the type and retain the name and final assignment operator.
        return emitted.segments.some(segment =>
        {
            const matchingHeadEnd = segment.srcEnd === sourceOperator + 1 && segment.outEnd === outputOperator + 1;
            const mappedName = segment.nameSrcStart < segment.nameSrcEnd && segment.nameOutStart < segment.nameOutEnd;
            if(segment.verbatim || !matchingHeadEnd || !mappedName)
            {
                return false;
            }

            const sourceName = source.slice(segment.nameSrcStart, segment.nameSrcEnd);
            const outputName = emitted.code.slice(segment.nameOutStart, segment.nameOutEnd);
            const sourceAssignment = (/^\s*=$/).test(source.slice(segment.nameSrcEnd, segment.srcEnd));
            const outputAssignment = (/^\s*=$/).test(emitted.code.slice(segment.nameOutEnd, segment.outEnd));
            return sourceName === outputName && sourceAssignment && outputAssignment;
        });
    }
};

module.exports = LgdSyntaxDiagnostic;
