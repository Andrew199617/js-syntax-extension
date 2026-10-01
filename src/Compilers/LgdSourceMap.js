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
     * @description Maps an LGD source offset to the corresponding compiled output offset.
     * Verbatim segments map 1:1; offsets inside a rewritten declaration head map to the
     * variable name span in the output, so hovering the head still resolves the variable.
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

                if(offset >= segment.nameSrcStart && offset < segment.nameSrcEnd)
                {
                    return segment.nameOutStart + (offset - segment.nameSrcStart);
                }

                return segment.nameOutStart;
            }
        }

        const last = this.bySource[this.bySource.length - 1];
        return last ? last.outEnd : 0;
    },

    /**
     * @description Maps a compiled output offset back to the LGD source offset.
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

                if(offset >= segment.nameOutStart && offset < segment.nameOutEnd)
                {
                    return segment.nameSrcStart + (offset - segment.nameOutStart);
                }

                return segment.nameSrcStart;
            }
        }

        const last = this.byOutput[this.byOutput.length - 1];
        return last ? last.srcEnd : 0;
    }
};

module.exports = LgdSourceMap;
