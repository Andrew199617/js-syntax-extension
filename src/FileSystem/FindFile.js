const vscode = require('vscode');
const Document = require('../Core/Document');

/**
* @description Find a file in the users workspace.
* @type {FindFileType}
*/
const FindFile = {
  supportedFileExt: ['js', 'jsx'],
  paths: {},

  /**
   * @description Check every directory in users workspace for a file.
   * Add all fileNames to paths object as we check them.
   * @param {string} fileName the file name to search for. File name should not include the file extension. Should not include the directory path.
   * @returns {DocumentType | null}
   */
  async generateDocumentFromType(fileName) {
    fileName = fileName.replace('Type', '');
    return await FindFile.generateDocumentFromFile(fileName);
  },

  /**
   * @description Check every directory in users workspace for a file.
   * Add all fileNames to paths object as we check them.
   * @param {string} fileName the file name to search for. File name should not include the file extension. Should not include the directory path.
   * @returns {DocumentType | null}
   */
  async generateDocumentFromFile(fileName) {
    const uri = await FindFile._findURIByName(fileName);
    if (!uri) {
      return;
    }

    let text = null;
    try {
      text = await fs.readFile(fileName, 'utf8');
    }
    catch (err) {
      lgd.logger.logError(`Could not read ${fileName}.`, err);
      return;
    }

    return Document.create(fileName, text, uri);
  },

  /**
   * @description Check every directory in users workspace for a file.
   * Add all fileNames to paths object as we check them.
   * @param {string} fileName the file name to search for. File name should not include the file extension. Should not include the directory path.
   * @returns {vscode.Uri}
   */
  async _findURIByName(fileName) {
    // Check if we already have the file path.
    const filePath = FindFile.paths[fileName];
    if (filePath) {
      return filePath;
    }

    const uris = await vscode.workspace.findFiles('**/*.js', '**/node_modules/**')
    if (!uris) {
      return;
    }

    for (let i = 0; i < uris.length; ++i) {
      const uri = uris[i];
      const filePath = uri.fsPath;

      if (!FindFile._checkFileExtension(filePath)) {
        continue;
      }

      // get fileName without ext from fsPath
      const newFileName = filePath.split('/').pop().split('.').shift();

      FindFile.paths[newFileName] = uri;
      if (newFileName === fileName) {
        return uri;
      }
    }
  },

  /**
  * @description Check if the file extension is supported.
  */
  _checkFileExtension(fileName) {
    for (let i = 0; i < FindFile.supportedFileExt.length; ++i) {
      const fileExt = FindFile.supportedFileExt[i];
      if (!fileName.endsWith(fileExt)) {
        return true;
      }
    }
  }
};

Object.freeze(FindFile);

module.exports = FindFile;