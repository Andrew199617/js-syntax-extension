const fs = require('fs').promises;

const ClassParser = require('../../../src/Parsers/ClassParser');

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
    const originalFile = await fs.readFile(`./tests/mocks/${filePath}.js`, 'utf8');

    const classParser = ClassParser.create();
    const parseResult = await classParser.parse(originalFile, '');

    const compiledFile = await fs.readFile(`./tests/mocks/${filePath}.d.ts`, 'utf8');

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


describe('Class Parser.', () =>
{
    test('State is being parsed for React Class.', async () =>
    {
        await checkFile('ReactStateExample');
    });

    test('Props are being parsed for React Class.', async () =>
    {
        await checkFile('ReactPropsExample');
    });
});
