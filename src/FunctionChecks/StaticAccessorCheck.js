const VscodeError = require('../Errors/VscodeError');
const ErrorTypes = require('../Errors/ErrorTypes');

/**
* @description When defining a Static Varaible will always want to access it in a static way.
* This class checks the inside of a function for wrong access to static varaible.
* @type {StaticAccessorCheckType}
*/
const StaticAccessorCheck = {
  /**
   * @description notify the user if they use static variable incorrectly
   * @param {string} insideFunction the inside of a funciton.
   * @this {FileParserType}
   */
  execute(insideFunction) {
    const staticVariables = this.staticVariables.reduce((accumulator, val) => {
      let lastVal = accumulator == '' ? '' : accumulator + '|';
      return lastVal + val;
    });

    const staticCheck = new RegExp(`this\\.(?<variableName>(${staticVariables}))`, 'm')
    let object;
    if((object = staticCheck.exec(insideFunction)) !== null) {

      throw VscodeError.create(`LGD: Using static varaible in non static way. Use ${this.className}.${object.groups.variableName} instead of this.${object.groups.variableName}`,
        this.beginLine,
        this.beginCharacter,
        this.endLine,
        this.endCharacter,
        ErrorTypes.Error);
    }
  }
};

module.exports = StaticAccessorCheck;