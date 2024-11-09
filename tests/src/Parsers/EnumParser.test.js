/* eslint-disable no-sync */
const fs = require('fs');

const FileParser = require('SRC/Parsers/FileParser');

lgd = {};
lgd.configuration = {
  createDebugLog: false,
  tabSize: 2,
  extractPropsAndState: true
};


/**
 * @description We shouldn't be trimming but there is a bug in jest that doesn't allow this check to work without trimming.
 * @param {string} str
 */
function fixString(str) {
  return str.trim();
}

async function checkFile(filePath) {
  const originalFile = fs.readFileSync(`./tests/mocks/EnumTests/${filePath}.js`, 'utf8');

  const classParser = FileParser.create();
  const parseResult = await classParser.parse('', originalFile);

  // fs.writeFileSync(`./tests/debug/${filePath}.debug.d.ts`, parseResult.typeFile);

  const compiledFile = fs.readFileSync(`./tests/mocks/EnumTests/${filePath}.d.ts`, 'binary').toString();

  const typeFileAry = parseResult.split('\n');
  const compileAry = compiledFile.split('\n');

  expect(typeFileAry.length).toBe(compileAry.length);

  for(let i = 0; i < typeFileAry.length; ++i) {
    expect(fixString(typeFileAry[i])).toEqual(fixString(compileAry[i]));
  }
}

describe('Enum Parser.', () => {
  test('Properties being parsed correctly.', () => {
    checkFile('AccessorTypes');
  });
});