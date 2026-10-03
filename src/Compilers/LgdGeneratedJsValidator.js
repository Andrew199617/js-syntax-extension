const parser = require('@babel/parser');
const LgdSourceMap = require('./LgdSourceMap');

/** @description Validates the complete emitted JavaScript independently of LGD type checking. */
const LgdGeneratedJsValidator = {
    /**
     * @description Parses a complete emitted file and returns its reusable syntax tree or mapped syntax diagnostics.
     * @param {Object} emitted the final JavaScript code and source-mapping segments.
     * @returns {Object} the Babel tree and source-relative errors.
     */
    validate(emitted)
    {
        try
        {
            const tree = this.parse(emitted.code);
            return { tree: tree, errors: [] };
        }
        catch(error)
        {
            if(!(error instanceof SyntaxError))
            {
                throw error;
            }

            const map = LgdSourceMap.create(emitted.segments);
            const position = Math.min(error.pos ?? 0, emitted.code.length);
            const offset = map.toSource(position);
            const endOffset = Math.max(offset, map.toSource(Math.min(position + 1, emitted.code.length)));
            return { tree: null, errors: [{
                offset: offset,
                endOffset: endOffset,
                code: 'lgd.output.syntax',
                message: `Generated JavaScript is invalid: ${error.message.replace(/ \(\d+:\d+\)$/, '')}`
            }] };
        }
    },

    /** @description Accepts JavaScript/JSX modules and scripts, retaining Node-wrapper returns only in script output. */
    parse(code)
    {
        try
        {
            return parser.parse(code, { sourceType: 'unambiguous', plugins: ['jsx'] });
        }
        catch(error)
        {
            if(error.reasonCode !== 'IllegalReturn')
            {
                throw error;
            }

            const tree = parser.parse(code, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
            if(tree.program.sourceType !== 'script')
            {
                throw error;
            }

            return tree;
        }
    }
};

module.exports = LgdGeneratedJsValidator;
