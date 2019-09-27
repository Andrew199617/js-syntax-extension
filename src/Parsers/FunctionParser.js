const StaticAccessorCheck = require('../Checks/StaticAccessorCheck');

/**
* @description Class that handles parsing a Function.
* @type {FunctionParserType}
*/
const FunctionParser = {
  /**
  * @description Initialize an instace of FunctionParser.
  * @param {Funciton} parseValue
  * @returns {FunctionParserType}
  */
  create(parseValue) {
    const functionParser = Object.assign({}, FunctionParser);

    /** @type {Function} */
    functionParser.parseValue = parseValue;

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
    const returnRegex = /return(\s+(?<return>.*?);|)/g;

    let type = 'void';
    let returns;

    while((returns = returnRegex.exec(insideFunction)) !== null) {
      if(typeof returns.groups.return === 'undefined') {
        type = 'any';
        continue;
      }

      const parsedType = this.parseValue(returns.groups.return);
      if(parsedType !== 'any' || type === 'void') {
        type = parsedType;
      }
    }

    return type;
  },

  /**
   * Parse the function paramaters.
   * @param {string} params
   */
  parseFunctionParams(params, commentParams) {
    if(typeof params === 'undefined') {
      return '';
    }

    let functionCall = '(';

    let variables = params.replace('(', '').replace(')', '');
    variables = variables.split(',').map(val => val.trim());

    for(let i = 0; i < variables.length; ++i) {
      if(!variables[i]) {
        continue;
      }

      const type = commentParams[variables[i]];

      // The type gotten from the default value.
      let parsedType = null;
      if(variables[i].includes('=')) {
        const expr = variables[i].split('=').map(val => val.trim());
        variables[i] = expr[0];
        const defaultValue = expr[1];
        parsedType = this.parseValue(defaultValue);
      }

      functionCall += `${variables[i]}: ${type || parsedType || 'any'}${i < variables.length - 1 ? ', ' : ''}`;
    }

    functionCall += ')';
    return functionCall;
  }
};

module.exports = FunctionParser;