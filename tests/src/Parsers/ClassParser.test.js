const fs = require('fs');

const ClassParser = require('../../../src/Parsers/ClassParser');

lgd = {};
// lgd.codeActions = CodeActions.create();
// lgd.lgdDiagnosticCollection = vscode.languages.createDiagnosticCollection();
// lgd.logger = Logger.create('LGD.FileParser');
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

function CheckFile(filePath) {
  const originalFile = fs.readFileSync(`./tests/mocks/${filePath}.js`, 'utf8');

  const classParser = ClassParser.create();
  let parseResult = classParser.parse(originalFile, '');

  const compiledFile = fs.readFileSync(`./tests/mocks/${filePath}.d.ts`, 'binary').toString();

  // fs.writeFileSync(`./tests/debug/${filePath}.debug.d.ts`, parseResult.typeFile);

  const typeFileAry = parseResult.typeFile.split('\n');
  const compileAry = compiledFile.split('\n');

  expect(typeFileAry.length).toBe(compileAry.length);

  for(let i = 0; i < typeFileAry.length; ++i) {
    expect(fixString(typeFileAry[i])).toEqual(fixString(compileAry[i]));
  }
}

describe('Class Parser.', () => {
  test('Parsing Class without extends React.Component', () => {
    CheckFile('Recommendation');
  });

  test('State is being parsed for React Class.', () => {
    CheckFile('ReactStateExample');
  });

  test('Props are being parsed for React Class.', () => {
    CheckFile('ReactPropsExample');
  });
});