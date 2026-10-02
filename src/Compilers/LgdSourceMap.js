/**
 * @description Maps offsets between LGD source text and compiled output using the segments recorded by LgdCompiler.
 * @type {LgdSourceMapType}
 */
const LgdSourceMap = {
    /**
     * @description Creates a source map from compiler segments.
     * @param {Array} segments the mapping segments from a compile result.
     * @returns {LgdSourceMapType}
     */
    create(segments)
    {
        const map = Object.create(LgdSourceMap);
        map.bySource = segments.slice().sort((first, second) => first.srcStart - second.srcStart);
        map.byOutput = segments.slice().sort((first, second) => first.outStart - second.outStart);
        return map;
    },

    /**
     * @description Applies output edits while retaining exact mappings around each rewrite.
     * Edits must lie in verbatim source spans; generated declaration heads stay intact.
     * @param {string} code the compiled text before edits.
     * @param {Array} segments the source-to-output mapping segments, updated in place.
     * @param {Array} edits the {start, end, text} output edits.
     * @returns {string} the rewritten output.
     */
    applyEdits(code, segments, edits)
    {
        let output = code;
        const ordered = edits.slice().sort((first, second) => second.start - first.start);
        for(const edit of ordered)
        {
            const map = this.create(segments);
            const sourceStart = map.toSource(edit.start);
            const sourceEnd = map.toSource(edit.end);
            const delta = edit.text.length - (edit.end - edit.start);
            const rewritten = [];
            for(const segment of segments)
            {
                this.appendEditedSegment(rewritten, segment, edit, delta);
            }

            rewritten.push({
                srcStart: sourceStart,
                srcEnd: sourceEnd,
                outStart: edit.start,
                outEnd: edit.start + edit.text.length,
                verbatim: false,
                nameSrcStart: sourceEnd,
                nameSrcEnd: sourceEnd,
                nameOutStart: edit.start + edit.text.length,
                nameOutEnd: edit.start + edit.text.length
            });
            segments.splice(0, segments.length, ...rewritten);
            output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
        }

        return output;
    },

    /**
     * @description Retains the portions of a mapping before and after one output edit.
     * @param {Array} result the replacement segments to append to.
     * @param {Object} segment the original mapping segment.
     * @param {Object} edit the {start, end, text} output edit.
     * @param {number} delta the output length change.
     * @returns {void}
     */
    appendEditedSegment(result, segment, edit, delta)
    {
        if(segment.outEnd <= edit.start)
        {
            result.push(segment);
            return;
        }

        if(segment.outStart >= edit.end)
        {
            const shifted = { ...segment, outStart: segment.outStart + delta, outEnd: segment.outEnd + delta };
            if(segment.nameOutStart !== undefined)
            {
                shifted.nameOutStart += delta;
                shifted.nameOutEnd += delta;
            }

            result.push(shifted);
            return;
        }

        if(segment.outStart < edit.start)
        {
            result.push({
                ...segment,
                srcEnd: segment.srcStart + edit.start - segment.outStart,
                outEnd: edit.start
            });
        }

        if(segment.outEnd > edit.end)
        {
            result.push({
                ...segment,
                srcStart: segment.srcStart + edit.end - segment.outStart,
                outStart: edit.end + delta,
                outEnd: segment.outEnd + delta
            });
        }
    },

    /**
     * @description Maps an LGD source offset to the corresponding compiled output offset.
     * Verbatim segments map 1:1; offsets inside a rewritten declaration head map to the
     * variable name span in the output, so hovering the head still resolves the variable.
     * The name end offset maps to the output name end, keeping symbol ranges intact.
     * @param {number} offset the source offset.
     * @returns {number} the output offset.
     */
    toOutput(offset)
    {
        for(const segment of this.bySource)
        {
            if(offset < segment.srcStart)
            {
                break;
            }

            if(offset < segment.srcEnd)
            {
                if(segment.verbatim)
                {
                    return segment.outStart + Math.min(offset - segment.srcStart, segment.outEnd - segment.outStart);
                }

                if(offset >= segment.nameSrcStart && offset <= segment.nameSrcEnd)
                {
                    return segment.nameOutStart + Math.min(offset - segment.nameSrcStart, segment.nameOutEnd - segment.nameOutStart);
                }

                return segment.nameOutStart;
            }
        }

        const last = this.bySource[this.bySource.length - 1];
        return last ? last.outEnd : 0;
    },

    /**
     * @description Maps a compiled output offset back to the LGD source offset.
     * The output name end offset maps back to the source name end, keeping symbol ranges intact.
     * @param {number} offset the output offset.
     * @returns {number} the source offset.
     */
    toSource(offset)
    {
        for(const segment of this.byOutput)
        {
            if(offset < segment.outStart)
            {
                break;
            }

            if(offset < segment.outEnd)
            {
                if(segment.verbatim)
                {
                    return segment.srcStart + Math.min(offset - segment.outStart, segment.srcEnd - segment.srcStart);
                }

                if(offset >= segment.nameOutStart && offset <= segment.nameOutEnd)
                {
                    return segment.nameSrcStart + Math.min(offset - segment.nameOutStart, segment.nameSrcEnd - segment.nameSrcStart);
                }

                return segment.nameSrcStart;
            }
        }

        const last = this.byOutput[this.byOutput.length - 1];
        return last ? last.srcEnd : 0;
    }
};

module.exports = LgdSourceMap;
