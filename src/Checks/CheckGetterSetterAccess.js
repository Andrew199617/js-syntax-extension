const VscodeError = require('../Errors/VscodeError');
const ErrorTypes = require('../Errors/ErrorTypes');

/**
* @description Check that we are using varaibles that are getters or setters properly.
* @type {CheckCorrectGetterSetterAccessType}
*/
const CheckCorrectGetterSetterAccess = {
  /**
   * @description Check Function for any errors.
   * @param {string} insideFunction the entire inside of a function.
   * @param {ClassParserType | FileParserType} fileParser
   */
  execute(insideFunction, fileParser) {
    const getterVaraiblesRegex = `(${fileParser.variables.map(val => `${val}|`)})`;
  }
};

module.exports = CheckCorrectGetterSetterAccess;