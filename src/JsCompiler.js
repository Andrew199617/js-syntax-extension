const path = require('path');
const vscode = require('vscode');

const FileParser = require('./Parsers/FileParser');
const FileIO = require('./Logging/FileIO');

const DEFAULT_EXT = '.d.ts';
const DEFAULT_DIR = 'typings';

// compile the given file
async function compile(jsFile, content) {
  const fileParser = FileParser.create();

  let typeFile = null;
  try {
    typeFile = fileParser.parse(content);
  }
  finally {
    await fileParser.logger.write();
  }

  if(fileParser.errorOccured) {
    return false;
  }

  const parsedPath = path.parse(jsFile);

  let dirInRoot = '';
  if(lgd.configuration.options.maintainHierarchy) {
    dirInRoot = parsedPath.dir.replace(vscode.workspace.rootPath, '');
  }

  const baseFilename = parsedPath.name;
  const typeFilePath = `${vscode.workspace.rootPath}\\${DEFAULT_DIR}${dirInRoot}\\${baseFilename}${DEFAULT_EXT}`;

  await FileIO.writeFileContents(typeFilePath, typeFile);

  return true;
}

module.exports = {
  compile
}