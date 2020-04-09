/* eslint-disable max-lines-per-function */
const VscodeError = require('../Errors/VscodeError');

const ErrorTypes = require('../Errors/ErrorTypes');
const Types = require('./Types');

const EnumParser = require('./EnumParser');
const FunctionParser = require('./FunctionParser');
const ClassParser = require('./ClassParser');

const CheckForThisInConstructor = require('../Checks/CheckForThisInConstructor');
const KeywordOrderCheck = require('../Checks/KeywordOrderCheck');

const ConstructorMethodName = 'create';

/**
 * @description Parse a JS file and convert it to a TS file.
 * @type {FileParserType}
 */
const FileParser = {
  /**
   * @returns {FileParserType}
   */
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

    /**
     * @description The name of the class we parsed.
     * @type {string}
     */
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

    /** @type {EnumParserType} */
    fileParser.enumParser = EnumParser.create(fileParser);

    /** @type {FunctionParserType} */
    fileParser.functionParser = FunctionParser.create(this.parseValue.bind(fileParser));

    /** @type {ClassParserType} */
    fileParser.classParser = ClassParser.create(fileParser);

    /** @description Compilation was not a success don't reset problems. */
    fileParser.errorOccured = false;

    /** @type {number} */
    fileParser.defaultTabSize = lgd.configuration.options.tabSize;

    /** @type {number} */
    fileParser.tabSize = 0;

    return fileParser;
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
      lgd.logger.logInfo(`${valuesStr} | No array of array implemented yet.`);
      return '(any | any[])[]';
    }

    const values = valuesStr.split(',').map(val => val.trim());

    const types = {
      length: 0
    };

    for(let i = 0; i < values.length; ++i) {
      const type = this.parseValue(values[i]);
      if(!type) {
        return 'any[]';
      }

      if(!types[type]) {
        types[type] = 1;
        types.length++;
      }
    }

    if(types.length === 1) {
      delete types.length;
      const typeKeys = Object.keys(types);
      return `${typeKeys[0]}[]`;
    }
    else if(types.length > 1) {
      delete types.length;
      const typeKeys = Object.keys(types);
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

    // Parse recursive object.
    if(value.includes('{') && value.includes(':')) {
      const tempParser = FileParser.create();
      tempParser.staticVariables = [];
      tempParser.tabSize = this.tabSize;

      const tabSize = this.tabSize > this.defaultTabSize ? this.tabSize - this.defaultTabSize : this.tabSize;
      const tabs = new Array(tabSize / this.defaultTabSize)
        .fill('\t')
        .join('');
      return `{${tempParser.parseClass(value)}${tabs}}`;
    }

    if((/function\s*?\(|=>/m).test(value)) {
      return Types.FUNCTION;
    }

    let className = (/new\s+(?<className>\w+)\(/m).exec(value);
    if(className !== null && className.groups.className) {
      return className.groups.className;
    }

    const stringRegex = /^("|').*?("|')\s*?(;$|$)/m;
    if(stringRegex.test(value)) {
      return Types.STRING;
    }

    if(value === 'null' || value === 'undefined') {
      return Types.ANY;
    }

    if(value.includes('[') && value.includes(']')) {
      return Types.ANYARRAY;
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
        const val = eval(value);
        let valType = typeof val;
        if(valType === 'object' && val === null) {
          valType = Types.ANY;
        }

        return this.fixType(valType);
      }
      catch(err) {
        lgd.logger.logError(`Error occured parsing value using "any": ${err}`);
      }

      return Types.ANY;
    }

    if(value === 'true' || value === 'false' || value.includes('!!')) {
      return Types.BOOLEAN;
    }

    if(!isNaN(parseInt(value))) {
      return Types.NUMBER;
    }

    if(value.includes('{') && value.includes('}')) {
      return Types.OBJECT;
    }

    return Types.ANY;
  },

  /**
   * @description Parse the comment of the class to get Template and extends.
   * @param {string} comment The class comment.
   * @returns { { extends: string[], template: string[] } }
   */
  parseClassComment(comment) {
    const jsdocRegex = /@(?<jsdoc>(template|extends))(?!$)(\s*{(?<type>.*?)}|)\s*(?<name>\w*)(?<description>.*?( |\*)(?=@|\*\/)|.*?$)/gms;

    const docs = { extends: [], template: [] };
    while((doc = jsdocRegex.exec(comment)) !== null) {
      const jsdoc = doc.groups.jsdoc;
      if(jsdoc === 'template') {

        if(typeof doc.groups.type !== 'undefined') {
          lgd.logger.logWarning("Don't add type for Template");
        }

        docs.template.push(doc.groups.name);
      }
      else if(jsdoc === 'extends') {
        docs.extends.push(doc.groups.type);
      }
    }

    return docs;
  },

  parseComment(comment, options) {
    const jsdocRegex = /@(?<jsdoc>(type|returns|param))(?!$)(\s*{(?<type>.*?)}(?!\s*})|)\s*(?<name>\w*)(?<description>.*?( |\*)(?=@|\*\/)|.*?$)/gms;

    let doc;
    let numReturns = 0;
    const maxReturns = 1;
    let numTypes = 0;
    const maxTypes = 1;
    const params = {
      length: 0
    };

    while((doc = jsdocRegex.exec(comment)) !== null) {
      const jsdoc = doc.groups.jsdoc;
      if(jsdoc === 'type') {
        if(numTypes === maxTypes) {
          continue;
        }

        if(typeof doc.groups.type === 'undefined') {
          lgd.logger.logWarning('Empty Type tag.');
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
          lgd.logger.logWarning('Empty param tag.');
          continue;
        }
        else if(typeof doc.groups.type === 'undefined') {
          params[doc.groups.name] = 'any';
          params.length++;
          lgd.logger.logWarning(`Param type for ${doc.groups.name} not given, using any.`);
          continue;
        }

        doc.groups.type = this.fixType(doc.groups.type);
        params[doc.groups.name] = doc.groups.type;
        params.length++;
      }
    }

    options.params = params;

    if(comment.length > 0) {
      const tabSize = this.tabSize > this.defaultTabSize ? this.tabSize - this.defaultTabSize : this.tabSize;
      comment += `${new Array(tabSize / this.defaultTabSize).fill('\t').join('')}`;
    }

    return comment;
  },

  /**
   * @description Change any obvious types to typescript types.
   * bool -> boolean
   * @param {string} type
   * @returns {string}
   */
  fixType(type) {
    let newType = type;
    newType = newType.replace(/bool(?!ean)/g, Types.BOOLEAN);
    newType = newType.replace(/\*/g, Types.ANY);
    newType = newType.replace(/function/g, Types.FUNCTION);
    newType = newType.replace(/undefined/g, Types.ANY);
    return newType;
  },

  /**
   * @description returns the class name.
   * @param {string} insideFunction
   * @returns {string}
   */
  getClassInCreate(insideFunction) {
    const classNameRegex = /(?<varType>const|let|var) (?<name>\w+?)\s*=\s*(?<object>Object|Oloo)\.(?<creationWay>create|assign|assignSlow|createSlow)\s*?\(/ms;
    const className = classNameRegex.exec(insideFunction);

    if(!className || !className.groups.name) {
      VscodeError.create('LGD: Could not find class instance in create method. Are you creating the instance properly.', this.beginLine, 0, this.endLine, 0, ErrorTypes.ERROR)
        .notifyUser(this);
    }

    return className && className.groups.name;
  },

  /**
   * @description notify the user if they use Create incorrectly.
   * @param {string} insideFunction the inside of the create() funciton.
   */
  checkForThisInCreate(insideFunction) {
    CheckForThisInConstructor.execute.bind(this)(insideFunction);
  },

  /**
   * @description Add varaible to local variables of class.
   * Do checks before adding.
   * @param {string} variableName
   * @param {boolean} strict whether another variable of same name can exist.
   */
  addVariable(variableName, strict = false) {
    if(this.staticVariables.includes(variableName)) {
      VscodeError.create(`LGD: Already defined ${variableName} as static variable or function.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
        .notifyUser(this);
    }
    else if(this.variables.includes(variableName)) {
      if(strict) {
        VscodeError.create(`LGD: Defined ${variableName} as property already.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .notifyUser(this);
      }

      return;
    }

    this.variables.push(variableName);
  },

  /**
   * @description parse the create funciton for variables.
   * These varaibles are treated like normal variables
   * variables on the object literal are treated like static.
   * @param {string} insideFunction
   * @returns {string}
   */
  parseCreate(insideFunction) {
    this.tabSize += this.defaultTabSize;
    this.variables = [];
    const className = this.getClassInCreate(insideFunction);

    if(!className) {
      return;
    }

    this.checkForThisInCreate(insideFunction);

    const tab = `\\s{${this.tabSize}}`;
    const previousTab = `\\s{${this.tabSize - this.defaultTabSize}}`;

    const varName = '\\w+?';
    const varDeliminator = '\\s*?=\\s*';
    const varEnd = `(;|$)(?=\\s*(^${tab}\\/|^${tab}${varName}|^${previousTab}}))`;
    const arrayRegex = `\\[(?<array>.*?)${varEnd}`;

    const commentRegex = '(?<comment>(\\/\\*\\*.*?\\*\\/.*?|))';
    const tabRegex = `^(?<tabs>${tab})`;
    const varaibleName = `${className}\\.(?<name>${varName})${varDeliminator}`;
    const valueRegex = `(${arrayRegex}|(?<value>.*?)${varEnd})`;

    const variablesRegex = new RegExp(
      [
        commentRegex,
        tabRegex,
        varaibleName,
        valueRegex
      ].join(''),
      'gms'
    );

    let variable;
    let variables = '';
    while((variable = variablesRegex.exec(insideFunction)) !== null) {
      const options = {
        type: undefined
      };

      const comment = this.parseComment(variable.groups.comment, options, false);

      if(options.type) {
        options.type = this.fixType(options.type);
      }

      const type = options.type
        || this.parseValue(variable.groups.value)
        || this.parseArray(variable.groups.array);


      // Must be a es6 function.
      if(typeof type === 'undefined') {
        VscodeError.create(`LGD: Could not parse ${variable.groups.name} in create function. No functions declarations in create()`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .notifyUser(this);
      }

      this.addVariable(variable.groups.name);

      variables += `\n\t`;
      variables += comment;
      variables += `${variable.groups.name}: ${type};`;
      variables += `\n`;
    }

    this.tabSize -= this.defaultTabSize;
    return variables || '';
  },

  /**
   * Parse an object literal into properties for a ts file.
   * @param {string} object
   * @returns {string} parsed object.
   */
  parseClass(object) {
    this.tabSize += this.defaultTabSize;
    const lastBeginLine = this.beginLine;

    const tab = `\\s{${this.tabSize}}`;
    const previousTab = `\\s{${this.tabSize - this.defaultTabSize}}`;

    const varName = '\\w+?';
    const varDeliminator = '\\s*?:\\s*';
    const varEndLookAhead = `(?=\\s*(^${tab}\\/|^${previousTab}}|^${tab}${varName}|$(?!.{1})))`;
    const valueEnd = `(,|$)${varEndLookAhead}`;
    const functionEnd = `(},|}|$)${varEndLookAhead}`;

    const invalidKeyword = '(?<invalid>(async\\s+(get|set)\\s+|))';
    const keywordsRegex = `${invalidKeyword}(?<keyword>async\\s+|)(?<getter>get\\s+|)(?<setter>get\\s+|)`;

    const comment = '(?<comment>\\/\\*\\*.*?\\*\\/.*?|)';
    const tabRegex = `^(?<tabs>${tab})`;
    const varaibleNameRegex = `(?<name>${varName})`;
    const functionRegex = `(?<params>\\(.*?\\))\\s*?{(?<function>.*?)${functionEnd}`;
    const arrayRegex = `\\[(?<array>.*?)${valueEnd}`;
    const valueRegex = `|${varDeliminator}(${arrayRegex}|(?<value>.*?)${valueEnd})`;

    const propertiesRegex = new RegExp(
      [
        comment,
        tabRegex,
        keywordsRegex,
        varaibleNameRegex,
        '(',
        functionRegex,
        valueRegex,
        ')'
      ].join(''),
      'gms'
    );

    let properties;
    let property = '';

    while((properties = propertiesRegex.exec(object)) !== null) {
      let keywords = '';
      const options = {
        type: undefined,
        isFunction: false,
        params: {}
      };

      if(properties.groups.invalid) {
        this.updatePosition(object, properties, 'name', lastBeginLine);
        KeywordOrderCheck.execute.bind(this)(properties[0]);
      }

      const isAsync = properties.groups.keyword && properties.groups.keyword.includes('async');
      const isGetter = !!properties.groups.getter && properties.groups.getter.includes('get');
      const isSetter = !!properties.groups.setter && properties.groups.setter.includes('set');

      if(isSetter) {
        continue;
      }

      if(properties.groups.name === ConstructorMethodName) {
        this.updatePosition(object, properties, 'function', lastBeginLine);
        property += this.parseCreate(properties.groups.function);
      }

      const tabSize = this.tabSize > this.defaultTabSize ? this.tabSize - this.defaultTabSize : this.tabSize;
      property += `\n${new Array(tabSize / this.defaultTabSize).fill('\t').join('')}`;
      property += this.parseComment(properties.groups.comment, options, isAsync);
      let functionParamaters = '';
      if(properties.groups.params) {
        // Already updated.
        if(properties.groups.name !== ConstructorMethodName) {
          this.updatePosition(object, properties, 'function', lastBeginLine);
        }

        if(isGetter) {
          keywords = 'readonly ';
          this.addVariable(properties.groups.name, true);
        }
        else {
          functionParamaters = this.functionParser.parseFunctionParams(properties.groups.params, options.params);
        }

        this.functionParser.checkFunction(properties.groups.function, this);
      }
      else {
        keywords = 'static ';
      }

      if(!options.type) {
        options.type = 'any';
        if(properties.groups.function) {
          options.type = this.functionParser.parseFunctionReturn(properties.groups.function);
          if(isGetter && options.type === 'void') {
            options.type = 'any';
          }
        }
      }
      else {
        options.type = this.fixType(options.type);
      }

      options.type = isAsync && !options.type.includes('Promise') ? `Promise<${options.type}>` : options.type;

      let type = this.parseValue(properties.groups.value)
        || this.parseArray(properties.groups.array)
        || options.type;

      if(this.staticVariables.includes(properties.groups.name)) {
        VscodeError.create(`LGD: Already defined ${properties.groups.name} as static variable or function.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .notifyUser(this);
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

    this.tabSize -= this.defaultTabSize;
    return property;
  },

  /**
   * Update Position to a specific string.
   * @param {string} str the string that was parsed. The string we are exec on.
   * @param {string} string the string to update to.
   * @param {number} lastBegin The last begin line we were parsing.
   */
  updatePositionToString(content, string, lastBegin = 0) {
    const lines = content.split(/\r\n|\r|\n/);
    const stringLines = string.split(/\r\n|\r|\n/);
    const linesNoGroup = content.replace(string, '').split(/\r\n|\r|\n/);
    let localBeginLine = 0;
    let localEndLine = 0;

    for(let i = 0; i < lines.length; ++i) {
      if(lines[i] !== linesNoGroup[i]) {
        this.beginCharacter = lines[i].replace(new RegExp(`${stringLines[0]}.*`, 's'), '').length;
        this.endCharacter = stringLines[stringLines.length - 1].length;
        this.beginLine = lastBegin + i;
        localBeginLine = i;
        break;
      }
    }

    if(linesNoGroup.length === lines.length) {
      this.endLine = this.beginLine;
      return;
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
   * @description Update our position in the document to be able to log to the user where an error occurs.
   * @param {string} str the string that was parsed. The string we are exec on.
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
   * @description Parse a js file into a ts file.
   * @param {string} content contains js file.
   * @returns {string} the the type file to write to disk.
   */
  parse(content) {
    let typeFile = '';

    const parse = this.classParser.parse(content, typeFile);
    content = parse.content;
    typeFile = parse.typeFile;

    const objectLiterals = /(?<comment>\/\*\*.*?\*\/.*?|)(?<var>const|let|var) (?<name>\w+?) = (?<react>(createReactClass\(|)){(?<object>.*?)^}/gms;
    let object;
    while((object = objectLiterals.exec(content)) !== null) {
      this.staticVariables = [];
      this.updatePosition(content, object, 'object');

      if(this.enumParser.isEnum(object.groups.comment)) {
        typeFile += this.enumParser.parse(content, object)
        continue;
      }

      typeFile += `\n`;
      typeFile += object.groups.comment;

      const docs = this.parseClassComment(object.groups.comment);

      if(object.groups.react !== '') {
        this.updatePositionToString(content, 'createReactClass');
        VscodeError.create(`LGD: Move createReactClass to the export statement -> export default createReactClass(${object.groups.name});`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .provideCodeAction(lgd.codeActions.moveCreateReactClass)
          .notifyUser(this);
      }

      this.className = object.groups.name;

      typeFile += `declare interface ${object.groups.name}Type${
        docs.template.length > 0
        ? `<${docs.template.join(',')}>`
        : ''} ${
        docs.extends.length > 0
        ? `extends ${docs.extends.join(',')} `
        : '' }{`;
      typeFile += this.parseClass(object.groups.object);
      typeFile += `}\n`;
    }

    return typeFile;
  }
};

module.exports = FileParser;