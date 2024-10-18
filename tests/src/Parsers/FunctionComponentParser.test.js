const fs = require('fs');

const FunctionComponentParser = require('../../../src/Parsers/FunctionComponentParser');

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

async function CheckFile(filePath) {
  const originalFile = fs.readFileSync(`./tests/mocks/FunctionTests/${filePath}.js`, 'utf8');

  const functionParser = FunctionComponentParser.create();
  let parseResult = await functionParser.parse(originalFile, '');

  // fs.writeFileSync(`./tests/debug/${filePath}.debug.d.ts`, parseResult.typeFile);

  const compiledFile = fs.readFileSync(`./tests/mocks/FunctionTests/${filePath}.d.ts`, 'binary').toString();

  const typeFileAry = parseResult.typeFile.split('\n');
  const compileAry = compiledFile.split('\n');

  expect(typeFileAry.length).toBe(compileAry.length);

  for(let i = 0; i < typeFileAry.length; ++i) {
    expect(fixString(typeFileAry[i])).toEqual(fixString(compileAry[i]));
  }
}

describe('Function Component Parser.', () => {
  test('Props are created.', () => {
    CheckFile('CollapsablePanel');
  });

  test('Props are not created when extractPropsAndState set to false.', async () => {
    lgd.configuration.options.extractPropsAndState = false;

    const originalFile = fs.readFileSync(`./tests/mocks/FunctionTests/CollapsablePanel.js`, 'utf8');

    const functionParser = FunctionComponentParser.create();
    let parseResult = await functionParser.parse(originalFile, '');

    expect(parseResult.typeFile).toBe('');
  });
});