const VscodeError = require('../Errors/VscodeError');
const ErrorTypes = require('../Errors/ErrorTypes');

/**
* @description When defining a property the order of keywords matter.
* @type {KeywordOrderCheckType}
*/
const KeywordOrderCheck = {
  /**
   * @description notify the user if they use static variable incorrectly
   * @param {string} property The whole property including keywords, name and funciton.
   */
  execute(property) {
    const staticCheck = /async\s+static\s+/m;
    if(staticCheck.test(property)) {
      KeywordOrderCheck.throwError.bind(this)('LGD: static async is the correct order not async static.');
    }

    const getterCheck = /async\s+get\s+/m;
    if(getterCheck.test(property)) {
      KeywordOrderCheck.throwError.bind(this)('LGD: Getter method should not be async.');
    }
  },

  throwError(message) {
    VscodeError.create(
      message,
      this.beginLine,
      this.beginCharacter,
      this.endLine,
      this.endCharacter,
      ErrorTypes.Error
    ).notifyUser(this.fileParser || this);
  }
};

module.exports = KeywordOrderCheck;