const path = require('node:path');
const { ESLint } = require('eslint');

/** @description Project root anchors configuration and custom rule resolution. */
const projectRoot = path.resolve(__dirname, '..');

/** @description Checks maintained JavaScript, including the editor's custom ESLint rules. */
async function lintProject()
{
    const options = {
        cwd: projectRoot,
        useEslintrc: false,
        overrideConfigFile: path.join(projectRoot, '.vscode/.eslintrc.json'),
        overrideConfig: { parser: 'espree', parserOptions: { ecmaVersion: 'latest' } },
        rulePaths: [path.join(projectRoot, '.vscode/eslint-rules')],
        fix: process.argv.includes('--fix')
    };
    const eslint = new ESLint(options);
    const results = await eslint.lintFiles([
        '*.js',
        'scripts/**/*.js',
        'src/**/*.{js,jsx,cjs,mjs,html}',
        'tests/**/*.{js,jsx,cjs,mjs,html}',
        '.vscode/eslint-rules/*.js'
    ]);
    if(options.fix)
    {
        await ESLint.outputFixes(results);
    }

    const formatter = await eslint.loadFormatter('stylish');
    const output = formatter.format(results);
    if(output)
    {
        console.log(output);
    }

    const errors = results.reduce((total, result) => total + result.errorCount, 0);
    const warnings = results.reduce((total, result) => total + result.warningCount, 0);
    console.log(`Checked ${results.length} files: ${errors} errors, ${warnings} warnings.`);
    return errors === 0 && warnings === 0;
}

async function main()
{
    try
    {
        const passed = await lintProject();
        if(!passed)
        {
            process.exitCode = 1;
        }
    }
    catch(error)
    {
        console.error(error);
        process.exitCode = 1;
    }
}

main();
