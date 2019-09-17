/**
* @description mimic document class provided by vscode for us to create and pass.
* @type {DocumentType}
*/
const Document = {
  /**
  * @description Initialize an instace of LGD.
  * @param {string} fileName
  * @param {string} text
  * @param uri
  * @returns {DocumentType}
  */
  create(fileName, text, uri) {
    const document = Object.assign({}, Document);

    document.fileName = fileName;
    document._text = text;
    document.uri = uri;

    return document;
  },

  getText() {
    return this._text;
  }
};

module.exports = Document;