const path = require('node:path');
const register = require('@babel/register');

/** @description Loads only the editor's ESM rules through ESLint's CommonJS rule loader. */
function registerEslintRules()
{
    const ruleDirectory = path.resolve(__dirname, '../.vscode/eslint-rules');
    register({
        babelrc: false,
        configFile: false,
        cache: false,
        only: [ruleDirectory],
        plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')]
    });
}

module.exports = registerEslintRules;
