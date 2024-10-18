const fs = require('fs');

const FileParser = require('../../../src/Parsers/FileParser');
const Logger = require('../../../src/Logging/Logger');

lgd = {};
// lgd.codeActions = CodeActions.create();
// lgd.lgdDiagnosticCollection = vscode.languages.createDiagnosticCollection();
Logger.logInfo = (info) => {
  console.log(info);
};

Logger.logWarning = (info) => {
  console.warn(info);
};

Logger.logWarning = (info) => {
  throw new Error(info);
};
lgd.logger = Logger.create();

lgd.configuration = {
  options: {
    createDebugLog: false,
    tabSize: 2,
    extractPropsAndState: true
  }
};


/**
 * @description We shouldn't be trimming but there is a bug in jest that doesn't allow this check to work without trimming.
 * @param {string} str
 */
function fixString(str) {
  return str.trim();
}

async function CheckFile(filePath) {
  const originalFile = fs.readFileSync(`./tests/mocks/${filePath}.js`, 'utf8');

  const fileParser = FileParser.create();
  let parseResult = await fileParser.parse('', originalFile);

  // fs.writeFileSync(`./tests/debug/${filePath}.debug.d.ts`, parseResult);

  const compiledFile = fs.readFileSync(`./tests/mocks/${filePath}.d.ts`, 'binary').toString();

  const typeFileAry = parseResult.split('\n');
  const compileAry = compiledFile.split('\n');

  expect(typeFileAry.length).toBe(compileAry.length);

  for(let i = 0; i < typeFileAry.length; ++i) {
    expect(fixString(typeFileAry[i])).toEqual(fixString(compileAry[i]));
  }
}

describe('Object Linked to Other Objects Parser.', () => {

  test('Obj is being parsed when export is at front of obj.', () => {
    CheckFile('ExportConst');
  });

  test('Template comments are parsed properly.', () => {
    CheckFile('BaseCardView');
  });

  test('Don\'t need to add template args when using my own class or some other class.', () => {
    CheckFile('DontRequireTemplates');
  });

  test('default params generate properly.', () => {
    CheckFile('/ObjectTests/TestFileParser');
  });
});