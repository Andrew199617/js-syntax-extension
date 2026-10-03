const parser = require('@babel/parser');
const LgdSyntaxDiagnostic = require('./LgdSyntaxDiagnostic');

/** @description Validates the complete emitted JavaScript independently of LGD type checking. */
const LgdGeneratedJsValidator = {
    /**
     * @description Parses a complete emitted file and returns its reusable syntax tree or mapped syntax diagnostics.
     * @param {Object} emitted the final JavaScript code and source-mapping segments.
     * @param {string} source the original LGD source, when available for precise diagnostic context.
     * @returns {Object} the Babel tree and source-relative errors.
     */
    validate(emitted, source)
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

            return { tree: null, errors: [LgdSyntaxDiagnostic.create(emitted, source, error)] };
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
