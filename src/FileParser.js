const VscodeError = require('./Errors/VscodeError');
const ErrorTypes = require('./Errors/ErrorTypes');
const Logger = require('./Logging/Logger');
const StaticAccessorCheck = require('./FunctionChecks/StaticAccessorCheck');

/**
 * @description Parse a JS file and convert it to a TS file.
 * @type {FileParserType}
 */
const FileParser = {

  create() {
    const fileParser = Object.assign({}, FileParser);

    /**
     * @description the variables that the class contains.
     * @type {string[]}
     */
    fileParser.variables = null;

    /**
     * @description the static variables that the class contains.
     * @type {string[]}
     */
    fileParser.staticVariables = null;

    /** @description The name of the class we parsed. */
    fileParser.className = null;

    /**
     * @description The current begin line being parsed.
     */
    fileParser.beginLine = 0;

    /**
     * @description The character that is the beinning of the current parse. "This line is being parsed" <- T in "This" is the endCharacter.
     */
    fileParser.beginCharacter = 0;

    /**
     * @description The current end line being parsed.
     */
    fileParser.endLine = 0;

    /**
     * @description The character that ends the parse. "This line is being parsed" <- d is the endCharacter.
     */
    fileParser.endCharacter = 0;

    /** @type {LoggerType} */
    fileParser.logger = Logger.create('LGD.FileParser');

    return fileParser;
  },

  /**
   * Parse the function paramaters.
   * @param {string} params
   */
  parseFunction(params, commentParams) {
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
      let type = commentParams[variables[i]];

      // The type gotten from the default value.
      let parsedType = null;
      if(variables[i].includes('=')) {
        let expr = variables[i].split('=').map(val => val.trim());
        variables[i] = expr[0];
        const defaultValue = expr[1];
        parsedType = this.parseValue(defaultValue);
      }

      functionCall += `${variables[i]}: ${type || parsedType || 'any'}${i < variables.length - 1 ? ', ' : ''}`;
    }

    functionCall += ')';
    return functionCall;
  },

  /**
   * @description Parses any property values.
   * @param {string} valuesStr the value of the property.
   * @returns {any} the type.
   */
  parseArray(valuesStr) {
    if(typeof valuesStr === 'undefined') {
      return null;
    }

    if(valuesStr.includes('[') && valuesStr.includes(']')) {
      this.logger.log.push('LGD: ' + valuesStr + ' | No array of array implemented yet.');
      return '(any | any[])[]';
    }

    let values = valuesStr.split(',').map(val => val.trim());

    let types = {
      length: 0
    };

    for(let i = 0; i < values.length; ++i) {
      const type = this.parseValue(values[i]);
      if(!type) {
        return 'any[]'
      }

      if(!types[type]) {
        types[type] = 1;
        types.length++;
      }
    }

    if(types.length === 1) {
      delete types.length;
      typeKeys = Object.keys(types);
      return `${typeKeys[0]}[]`;
    }
    else if (types.length > 1) {
      delete types.length;
      typeKeys = Object.keys(types);
      let typeStr = '(';
      for(let i = 0; i < typeKeys.length; ++i) {
        typeStr += typeKeys[i];
        typeStr += i < typeKeys.length - 1 ? ' | ' : '';
      }
      typeStr += ')[]';
      return typeStr;
    }

    return 'any[]';
  },

  /**
   * @description Parses any property values.
   * @param {string} value the value of the property.
   * @returns {string | null} the type.
   */
  parseValue(value) {
    if(typeof value === 'undefined') {
      return null;
    }

    if(value === 'true' || value === 'false' || value.includes('!!')) {
      return 'boolean';
    }

    const stringRegex = /^("|').*?("|')\s*?(;$|$)/m;
    if(stringRegex.test(value)) {
      return 'string';
    }
    if(value === 'null' || value === 'undefined') {
      return 'any';
    }
    if(value.includes('{') && value.includes('}')) {
      return 'object';
    }

    if(value.includes('[') && value.includes(']')) {
      return 'any[]';
    }

    if((/(function\s*?\(|=>)/m).test(value)) {
      return 'Function';
    }

    let className = (/new\s+(?<className>\w+)\(/m).exec(value);
    if(className !== null && className.groups.className) {
      return className.groups.className;
    }

    className = (/(?<className>\w+)\.create\s*\(/m).exec(value);
    if(className !== null && className.groups.className) {
      return `${className.groups.className}Type`;
    }

    const ops = ['+', '-\\s+', '*', '/', '=', '<', '>', '<=', '>=', '&', '|', '^']
      .map(op => `\\${op}`)
      .join('|');

    const operationRegex = new RegExp(`(${ops})`,'m');
    if(operationRegex.test(value)) {
      try {
        let val = eval(value);
        return this.parseType(typeof val);
      }
      catch (err) {
        console.error(err);
      }

      return 'any';
    }

    if(!isNaN(parseInt(value))) {
      return 'number';
    }

    return null;
  },

  parseComment(comment, options, isAsync) {
    let description = /@description(?!$)\s*(?<description>.*?(\s|\*)(?=@|\*\/)|.*?$)/gms;
    let jsdocRegex = /@(?<jsdoc>(type|returns|param))(?!$)(\s*{(?<type>.*?)}|)\s*(?<name>\w*)(?<description>.*?( |\*)(?=@|\*\/)|.*?$)/gms;
    let typesRegex = /.*?(?<type>{.*?})/g;

    let doc;
    let numReturns = 0;
    const maxReturns = 1;
    let numTypes = 0;
    const maxTypes = 1;
    let params = {
      length: 0
    };

    while((doc = jsdocRegex.exec(comment)) !== null) {
      let jsdoc = doc.groups.jsdoc;
      if(jsdoc === 'type') {
        if(numTypes === maxTypes) {
          continue;
        }
        if(typeof doc.groups.type === 'undefined') {
          console.warn('LGD: Empty Type tag.');
        }
        numTypes++;
        options.type = doc.groups.type;
      }
      else if(jsdoc === 'returns') {
        if(numReturns === maxReturns) {
          continue;
        }
        numReturns++;
        options.type = doc.groups.type || 'any';
      }
      else if(jsdoc === 'param') {
        if(typeof doc.groups.name === 'undefined') {
          console.warn('LGD: Empty param tag.')
          continue;
        }
        else if(typeof doc.groups.type === 'undefined') {
          params[doc.groups.name] = 'any';
          params.length++;
          console.warn('LGD: Param type not given, using any.')
          continue;
        }
        doc.groups.type = this.parseType(doc.groups.type);
        params[doc.groups.name] = doc.groups.type;
        params.length++;
      }
    }
    options.params = params;

    if(comment.length > 0) {
      comment += '\t';
    }
    return comment;
  },

  /**
   * @description Change any obvious types to typescript types.
   * bool -> boolean
   * @param {string} type
   * @returns {string}
   */
  parseType(type) {
    let newType = type
    newType = newType.replace(/bool(?!ean)/g, 'boolean');
    newType = newType.replace(/\*/g, 'any');
    newType = newType.replace(/function/g, 'Function');
    return newType;
  },

  /**
   * @description returns the class name.
   * @param {string} insideFunction
   * @returns {string}
   */
  getClassInCreate(insideFunction) {
    const classNameRegex = /(const|let|var) (?<name>\w+?)\s*=\s*Object\.(create|assign)\s*?\(/ms;
    let className = classNameRegex.exec(insideFunction);

    if(!className) {
      throw VscodeError.create('LGD: Could not find class instance in create method. Are you creating the instance using Object.create of Object.assign.', this.beginLine, 0, this.endLine, 0, ErrorTypes.ERROR);
    }

    if(!className.groups.name) {
      throw VscodeError.create('LGD: Could not parse class name in create.', this.beginLine, 0, this.endLine, 0, ErrorTypes.ERROR);
    }

    return className.groups.name;
  },

  /**
   * @description notify the user if they use Create incorrectly.
   * @param {string} insideFunction the inside of the create() funciton.
   * @param {string} className the name of the class.
   * @param {number} lastBeginLine the last begin line.
   */
  checkForThisInCreate(insideFunction, className, lastBeginLine) {
    const thisKeywordRegex = /(?<this>this\.)/m;
    let object;
    if((object = thisKeywordRegex.exec(insideFunction)) !== null) {
      // this.updatePosition(insideFunction, object, 'this', lastBeginLine);
      throw VscodeError.create(`LGD: Don't use 'this' in create method. This has unintended consequenses. Use ${className}. instead of this.`,
        this.beginLine,
        this.beginCharacter,
        this.endLine,
        this.endCharacter,
        ErrorTypes.Error);
    }
  },

  /**
   * @description parse the create funciton for variables.
   * These varaibles are treated like normal variables
   * variables on the object literal are treated like static.
   * @param {string} insideFunction
   * @returns {string}
   */
  parseCreate(tabSize, insideFunction) {
    this.variables = [];
    const className = this.getClassInCreate(insideFunction);
    const lastBeginLine = this.beginLine;

    this.checkForThisInCreate(insideFunction, className, lastBeginLine);

    const varName = '\\w+?';
    const varDeliminator = '\\s*?=\\s*';
    const varEnd = `(;|$)(?=\\s*(\\/|\\w+?))`;
    const tab = `\\s{${tabSize}}`;

    const comment = '(?<comment>(\\/\\*\\*.*?\\*\\/.*?|))';
    const tabRegex = `^(?<tabs>${tab})`;
    const varaibleName = `${className}\\.(?<name>${varName})${varDeliminator}`;
    const arrayRegex = `\\[(?<array>.*?)\\](${varEnd}|;\\s*$)`
    const valueRegex = `((${arrayRegex}|(?<value>.*?)${varEnd}))`;
    const variablesRegex = new RegExp([
      comment, tabRegex,
      varaibleName, valueRegex
    ].join(''),'gms');

    let variable;
    let variables = '';
    while((variable = variablesRegex.exec(insideFunction)) !== null) {
      const options = {
        type: undefined
      };

      let comment = this.parseComment(variable.groups.comment, options, false);

      if(options.type) {
        options.type = this.parseType(options.type);
      }

      let type = options.type
        || this.parseValue(variable.groups.value)
        || this.parseArray(variable.groups.array);


      // Must be a es6 function.
      if(typeof type === 'undefined') {
        throw VscodeError.create(`LGD: Could not parse ${variable.groups.name} in create function. No functions declarations in create()`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR);
      }

      if(this.staticVariables.includes(variable.groups.name)) {
        throw VscodeError.create(`LGD: Already defined ${variable.groups.name} as static variable or function.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR);
      }
      else if(this.variables.includes(variable.groups.name)) {
        console.log('Skipping', variable.groups.name);
        continue;
      }
      this.variables.push(variable.groups.name);

      variables += `\n\t`;
      variables += comment;
      variables += `${variable.groups.name}: ${type};`;
      variables += `\n`;
    }

    return variables || '';
  },

  /**
   * Parse an object literal into properties for a ts file.
   * @param {string} object
   * @returns {string} parsed object.
   */
  parseClass(object) {
    const tabSize = lgd.configuration.options.tabSize;
    const lastBeginLine = this.beginLine;

    const varName = '\\w+?';
    const varDeliminator = '\\s*?:\\s*';
    const varEnd = `(,|$)(?=\\s*(\\/|}|${varName}${varDeliminator}))`;
    const tab = `\\s{${tabSize}}`;

    const comment = '(?<comment>\\/\\*\\*.*?\\*\\/.*?|)';
    const tabRegex = `^(?<tabs>${tab})`;
    const functionKeywords = '(?<keyword>async\\s*|)';
    const varaibleNameRegex = `(?<name>${varName})`;
    const functionRegex = `((?<params>\\(.*?\\))\\s*?{(?<function>.*?)^${tab}(}|},)$`;
    const arrayRegex = `\\[(?<array>.*?)\\](${varEnd}|,\\s*$)`
    const valueRegex = `|${varDeliminator}(${arrayRegex}|(?<value>.*?)${varEnd}))`;

    const propertiesRegex = new RegExp([
      comment, tabRegex,
      functionKeywords, varaibleNameRegex,
      functionRegex, valueRegex
    ].join(''),'gms');

    let properties;
    let property = '';

    while((properties = propertiesRegex.exec(object)) !== null) {
      let keywords = '';
      const options = {
        type: undefined,
        isFunction: false,
        params: {}
      };
      const isAsync = properties.groups.keyword && properties.groups.keyword.includes('async');

      if(properties.groups.name === 'create') {
        this.updatePosition(object, properties, 'function', lastBeginLine);
        const tabLevel = 2;
        property += this.parseCreate(tabSize * tabLevel, properties.groups.function);
      }

      property += `\n\t`;
      property += this.parseComment(properties.groups.comment, options, isAsync);
      let functionParamaters = '';
      if(properties.groups.params) {
        if(properties.groups.name !== 'create') {
          this.updatePosition(object, properties, 'function', lastBeginLine);
        }

        functionParamaters = this.parseFunction(properties.groups.params, options.params);
        StaticAccessorCheck.execute.bind(this)(properties.groups.function);
      }
      else {
        keywords = 'static '
      }

      if(!options.type) {
        options.type = (properties.groups.function
          ? (properties.groups.function.includes('return')
            ? 'any'
            : 'void')
          : 'void');
      }
      else {
        options.type = this.parseType(options.type);
      }
      options.type = isAsync && !options.type.includes('Promise') ? `Promise<${options.type}>` : options.type;

      let type = this.parseValue(properties.groups.value)
        || this.parseArray(properties.groups.array)
        || options.type;

      if(this.staticVariables.includes(properties.groups.name)) {
        throw VscodeError.create(`LGD: Already defined ${properties.groups.name} as static variable or function.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR);
      }

      // Use comment type if not parsed type.
      if(type === 'any' || !type) {
        type = options.type;
      }

      if(!properties.groups.function) {
        this.staticVariables.push(properties.groups.name);
      }

      property += `${keywords}${properties.groups.name}${functionParamaters}: ${type};`;
      property += `\n`;
    }

    return property;
  },

  /**
   * @description Update our position in the document to be able to log to the user where an error occurs.
   * @param {string} str the string that was parsed.
   * @param {RegExpExecArray} regExpExecArray the object that was produced from exec.
   * @param {string} group the group that we are updating to.
   * @param {number} lastBegin The last begin line we were parsing.
   */
  updatePosition(str, regExpExecArray, group, lastBegin = 0) {
    const lines = str.split(/\r\n|\r|\n/);
    const linesNoGroup = str.replace(regExpExecArray.groups[group], '').split(/\r\n|\r|\n/);
    let localBeginLine = 0;
    let localEndLine = 0;

    for(let i = 0; i < lines.length; ++i) {
      if(lines[i] !== linesNoGroup[i]) {
        this.beginLine = lastBegin + i;
        localBeginLine = i;
        break;
      }
    }

    if(linesNoGroup.length === localBeginLine + 1) {
      this.endLine = lastBegin + lines.length - 1;
      return;
    }

    let numMatched = 0;
    for(let i = localBeginLine; i < lines.length; ++i) {
      if(lines[i] !== linesNoGroup[localBeginLine + numMatched + 1]) {
        numMatched = 0;
      }
      else if(numMatched < 2) {
        localEndLine = lastBegin + i;
        numMatched++;
      }
      else {
        this.endLine = lastBegin + i - numMatched;
        return;
      }
    }

    if(numMatched > 0) {
      this.endLine = localEndLine;
    }
  },

  /**
   * @description Notify user we don't parse Class.
   * @param {*} content the document string.
   */
  checkForClassKeyword(content) {
    const classKeywordRegex = /(?<class>^class.*?$)/gms;
    let object;
    if((object = classKeywordRegex.exec(content)) !== null) {
      this.updatePosition(content, object, 'class');
      throw VscodeError.create('LGD: There is currently no parsing for Class.', this.beginLine, 0, this.endLine, 0, ErrorTypes.HINT);
    }
  },

  /**
   * @description Parse a js file into a ts file.
   * @param {string} content contains js file.
   * @returns {string} the the type file to write to disk.
   */
  parse(content) {
    this.checkForClassKeyword(content);

    const objectLiterals = /(?<comment>\/\*\*.*?\*\/.*?|)(?<var>const|let|var) (?<name>\w+?) = {(?<object>.*?)^}/gms;
    let object;
    let typeFile = '';
    while((object = objectLiterals.exec(content)) !== null) {

      this.staticVariables = [];
      this.updatePosition(content, object, 'object');

      typeFile += `\n`;
      typeFile += object.groups.comment;

      this.className = object.groups.name;

      typeFile += `declare interface ${object.groups.name}Type {`;
      typeFile += this.parseClass(object.groups.object);
      typeFile += `}\n`;
    }

    return typeFile;
  }
};

module.exports = FileParser;