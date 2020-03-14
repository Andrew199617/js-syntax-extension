const VscodeError = require('../Errors/VscodeError');
const ErrorTypes = require('../Errors/ErrorTypes');

/**
* @description Check to see if any lines have incorrect tab size since it's very important for parsing the js file.
* @type {IncorrectTabSizeCheckType}
*/
const IncorrectTabSizeCheck = {
  /**
   * @description Chec
   * @param {string} file the entire file to check.
   * @param {number} tabSize the default tab size.
   */
  execute(file, tabSize) {
    const numLevelsDeep = 10;
    const spacesToCheck = [];
    for(let i = 1; i < numLevelsDeep; ++i) {
      for(let ii = 1; ii < tabSize; ++ii) {
        spacesToCheck.push(`^ {${ii + (i * tabSize)}}(?! )`);
      }
    }

    const tabRegex = new RegExp(`(${spacesToCheck.join('|')})`, 'gm');

    if(tabRegex.test(file)) {
      IncorrectTabSizeCheck.throwError.bind(this)('Tab Size is invalid!');
    }
  },

  throwError(message) {
    VscodeError.create(
      message,
      this.beginLine,
      this.beginCharacter,
      this.endLine,
      this.endCharacter,
      ErrorTypes.ERROR
    ).notifyUser(this.fileParser || this);
  }

};

module.exports = IncorrectTabSizeCheck;