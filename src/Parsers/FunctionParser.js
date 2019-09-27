const StaticAccessorCheck = require('../Checks/StaticAccessorCheck');

/**
* @description Class that handles parsing a Function.
* @type {FunctionParserType}
*/
const FunctionParser = {
  /**
  * @description Initialize an instace of FunctionParser.
  * @param {Funciton} valueParser
  * @returns {FunctionParserType}
  */
  create(valueParser) {
    const functionParser = Object.assign({}, FunctionParser);

    /** @type {Function} */
    functionParser.valueParser = valueParser;

    return functionParser;
  },

  /**
   * @description Check Function for any errors.
   * @param {string} insideFunction the entire inside of a function.
   * @param {ClassParserType | FileParserType} fileParser
   */
  checkFunction(insideFunction, fileParser) {
    StaticAccessorCheck.execute.bind(fileParser)(insideFunction);
  },

  /**
   * @description Parse the return of a function.
   * @param {string} insideFunction the entire inside of a function.
   * @returns {string} the type that was parsed.
   */
  parseFunctionReturn(insideFunction) {
    const returnRegex = /return\s+(?<return>.*?);/g;

    let type = 'void';
    let returns;

    while((returns = returnRegex.exec(insideFunction)) !== null) {
      const parsedType = this.valueParser(returns.groups.return);
      if(parsedType !== 'any' || type === 'void') {
        type = parsedType;
      }
    }

    return type;
  }
};

module.exports = FunctionParser;