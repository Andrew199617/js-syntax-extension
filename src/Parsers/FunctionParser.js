const StaticAccessorCheck = require('../Checks/StaticAccessorCheck');

/**
* @description Class that handles parsing a Function.
* @type {FunctionParserType}
*/
const FunctionParser = {
  /**
  * @description Initialize an instance of FunctionParser.
  * @param {Function} parseValue
  * @returns {FunctionParserType}
  */
  create(parseValue) {
    const functionParser = Object.create(FunctionParser);

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
  async parseFunctionReturn(insideFunction) {
    // TODO check we are not inside of a function.
    const returnRegex = /return(\s+(?<return>.*?);|)/gm;

    let returns;

    let types = new Map();
    while((returns = returnRegex.exec(insideFunction)) !== null) {
      if(typeof returns.groups.return === 'undefined') {
        types.set('null', 'null');
        continue;
      }

      const parsedType = await this.parseValue(returns.groups.return);
      if(parsedType === 'any') {
        return 'any';
      }

      types.set(parsedType, parsedType);
    }

    let returnType = '';
    types.forEach(type => {
      returnType += returnType.length === 0 ? type : ` | ${type}`;
    });

    return returnType || 'void';
  },

  /**
   * @description Split the function parameters into an array.
   * @param {string} params the parameters of a function.
   * @returns {string[]} the split parameters.
   */
  splitFunctionParams(params) {
    // Regex to split object, parsingOptions = { preferComments: false, ignoreDuplicate: false } into an array of two items. ['object', 'parsingOptions = { preferComments: false, ignoreDuplicate: false }'].
    const regex = /\w+\s*=\s*[a-zA-Z0-9]+(,|)|\w+\s*=\s*\{[^}]+\}|\w+/g;
    return params.match(regex) || [];
  },

  /**
   * Parse the function paramaters.
   * @param {string} params
   */
  async parseFunctionParams(params, commentParams) {
    if(typeof params === 'undefined') {
      return '';
    }

    let functionCall = '(';

    let variables = params.replace('(', '').replace(')', '');
    variables = this.splitFunctionParams(variables);

    for(let i = 0; i < variables.length; ++i) {
      if(!variables[i]) {
        continue;
      }

      let type = commentParams[variables[i]];

      // The type gotten from the default value.
      let parsedType = null;
      if(variables[i].includes('=')) {
        const expr = variables[i].split('=').map(val => val.trim());

        variables[i] = expr[0];
        type = commentParams[variables[i]];

        if(!type) {
          const defaultValue = expr[1];
          parsedType = await this.parseValue(defaultValue);
        }
      }

      functionCall += `${variables[i]}: ${type || parsedType || 'any'}${i < variables.length - 1 ? ', ' : ''}`;
    }

    functionCall += ')';
    return functionCall;
  }
};

module.exports = FunctionParser;