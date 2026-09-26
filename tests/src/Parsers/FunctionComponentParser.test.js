const fs = require('fs').promises;

const FunctionComponentParser = require('../../../src/Parsers/FunctionComponentParser');

/**
 * @description We shouldn't be trimming but there is a bug in jest that doesn't allow this check to work without trimming.
 * @param {string} str
 */
function fixString(str)
{
    return str.trim();
}

async function checkFile(filePath)
{
    const originalFile = await fs.readFile(`./tests/mocks/FunctionTests/${filePath}.js`, 'utf8');

    const functionParser = FunctionComponentParser.create();
    const parseResult = await functionParser.parse(originalFile, '');

    const compiledFile = await fs.readFile(`./tests/mocks/FunctionTests/${filePath}.d.ts`, 'utf8');

    const typeFileAry = parseResult.typeFile.split('\n');
    const compileAry = compiledFile.split('\n');

    expect(typeFileAry.length).toBe(compileAry.length);

    for(let i = 0; i < typeFileAry.length; ++i)
    {
        expect(fixString(typeFileAry[i])).toEqual(fixString(compileAry[i]));
    }
}

lgd = {};

lgd.configuration = {
    createDebugLog: false,
    tabSize: 2,
    extractPropsAndState: true
};


describe('Function Component Parser.', () =>
{
    beforeEach(() =>
    {
        lgd.configuration.extractPropsAndState = true;
    });

    test('Props are created.', async () =>
    {
        await checkFile('CollapsablePanel');
    });

    test('Props are not created when extractPropsAndState set to false.', async () =>
    {
        lgd.configuration.extractPropsAndState = false;

        const originalFile = await fs.readFile(`./tests/mocks/FunctionTests/CollapsablePanel.js`, 'utf8');

        const functionParser = FunctionComponentParser.create();
        const parseResult = await functionParser.parse(originalFile, '');

        expect(parseResult.typeFile).toBe('');
    });
});
