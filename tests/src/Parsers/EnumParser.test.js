const fs = require('fs').promises;

const FileParser = require('SRC/Parsers/FileParser');

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
    const originalFile = await fs.readFile(`./tests/mocks/EnumTests/${filePath}.js`, 'utf8');

    const classParser = FileParser.create();
    const parseResult = await classParser.parse('', originalFile);

    const compiledFile = await fs.readFile(`./tests/mocks/EnumTests/${filePath}.d.ts`, 'utf8');

    const typeFileAry = parseResult.split('\n');
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


describe('Enum Parser.', () =>
{
    test('Properties being parsed correctly.', async () =>
    {
        await checkFile('AccessorTypes');
    });
});
