/* eslint-disable max-lines-per-function */
const VscodeError = require('../Errors/VscodeError');
const ErrorTypes = require('../Errors/ErrorTypes');

const StaticAccessorCheck = require('../Checks/StaticAccessorCheck');
const KeywordOrderCheck = require('../Checks/KeywordOrderCheck');

const Types = require('./Types');

const ConstructorMethodName = 'constructor';

/**
* @description
* @type {ClassParserType}
*/
const ClassParser = {
  /**
  * @description Initialize an instace of ClassParser.
  * @param {FileParserType} fileParser
  * @returns {ClassParserType}
  */
  create(fileParser) {
    const classParser = Object.assign({}, ClassParser);

    /** @type {FileParserType} */
    classParser.fileParser = fileParser;

    classParser.className = '';

    /** @type {number} */
    classParser.defaultTabSize = lgd.configuration.options.tabSize;

    /** @type {number} */
    classParser.tabSize = 0;

    return classParser;
  },

  /**
   * @description Update our position in the document to be able to log to the user where an error occurs.
   * @param {string} str the string that was parsed.
   * @param {RegExpExecArray} regExpExecArray the object that was produced from exec.
   * @param {string} group the group that we are updating to.
   * @param {number} lastBegin The last begin line we were parsing.
   */
  updatePosition() {
    this.fileParser.updatePosition.bind(this)(...arguments);
  },

  parseCreate() {
    return this.fileParser.parseCreate.bind(this)(...arguments);
  },

  checkForThisInCreate() {

  },

  parseComment() {
    return this.fileParser.parseComment.bind(this)(...arguments);
  },

  parseFunction() {
    return this.fileParser.parseFunction.bind(this)(...arguments);
  },

  parseValue() {
    return this.fileParser.parseValue.bind(this)(...arguments);
  },

  fixType(type) {
    return this.fileParser.fixType.bind(this)(type);
  },

  parseType(options, properties) {
    if(options && !options.type) {
      options.type = Types.ANY;
      if(properties.groups.function) {
        if(properties.groups.name === 'render') {
          options.type = Types.JSXELEMENT;
        }
        else if(properties.groups.name === ConstructorMethodName) {
          options.type = `${this.className}Type`;
        }
        else if(properties.groups.function.includes('return')) {
          options.type = Types.ANY;
        }
        else {
          options.type = Types.VOID;
        }
      }
    }
    else if(options) {
      options.type = this.fixType(options.type);
    }
  },

  parseArray() {
    return this.fileParser.parseArray.bind(this)(...arguments);
  },

  /**
   * @description returns the class name.
   * @returns {string}
   */
  getClassInCreate() {
    return 'this';
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
      return true;
    }

    return false;
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
    const varDeliminator = '\\s*?=\\s*';

    const varEndLookAhead = `(?=\\s*(^${tab}\\/|^${previousTab}}|^${tab}${varName}|$(?!.{1})))`;
    const varEnd = `(;|$)${varEndLookAhead}`;
    const functionEnd = `(};|}|$)${varEndLookAhead}`;

    const arrayRegex = `\\[(?<array>.*?)${varEnd}`;

    const invalidKeyword = '(?<invalid>(async\\s+(static|get|set)\\s+|))';
    const keywordsRegex = `${invalidKeyword}(?<static>static\\s+|)(?<async>async\\s+|)`;

    const comment = '(?<comment>\\/\\*\\*.*?\\*\\/.*?|)';
    const tabRegex = `^(?<tabs>${tab})`;
    const varaibleNameRegex = `(?<name>${varName})`;
    const functionRegex = `((?<params>\\(.*?\\))\\s*?{(?<function>.*?)${functionEnd}`;
    const valueRegex = `|${varDeliminator}(${arrayRegex}|(?<value>.*?)${varEnd})|;|$)`;

    const propertiesRegex = new RegExp(
      [
        comment,
        tabRegex,
        keywordsRegex,
        varaibleNameRegex,
        functionRegex,
        valueRegex
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

      const isAsync = !!properties.groups.async && properties.groups.async.includes('async');
      const isStatic = !!properties.groups.static && properties.groups.static.includes('static');

      if(properties.groups.name === ConstructorMethodName) {
        this.updatePosition(object, properties, 'function', lastBeginLine);
        property += this.parseCreate(properties.groups.function);
      }

      property += `\n\t`;
      property += this.parseComment(properties.groups.comment, options, isAsync);

      let functionParamaters = '';
      if(properties.groups.params) {
        // Already updated.
        if(properties.groups.name !== ConstructorMethodName) {
          this.updatePosition(object, properties, 'function', lastBeginLine);
        }

        functionParamaters = this.parseFunction(properties.groups.params, options.params);
        StaticAccessorCheck.execute.bind(this)(properties.groups.function);
      }

      if(isStatic) {
        keywords = 'static ';
      }

      this.parseType(options, properties);

      options.type = isAsync && !options.type.includes('Promise') ? `Promise<${options.type}>` : options.type;

      let type = this.parseValue(properties.groups.value)
        || this.parseArray(properties.groups.array)
        || options.type;

      if(this.staticVariables.includes(properties.groups.name)) {
        VscodeError.create(`LGD: Already defined ${properties.groups.name} as static variable or function.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .notifyUser(this.fileParser);
      }

      // Use comment type if not parsed type.
      if(type === Types.ANY || !type) {
        type = options.type;
      }

      if(isStatic) {
        this.staticVariables.push(properties.groups.name);
      }

      property += `${keywords}${properties.groups.name}${functionParamaters}: ${type};`;
      property += `\n`;
    }

    this.tabSize -= this.defaultTabSize;
    return property;
  },

  parse(content, typeFile) {
    if(!this.checkForClassKeyword(content)) {
      return typeFile;
    }

    const objectLiterals = /(?<comment>\/\*\*.*?\*\/.*?|)(?<var>class) (?<name>\w+?) extends React.Component {(?<object>.*?)^}/gms;
    let object;
    while((object = objectLiterals.exec(content)) !== null) {
      this.staticVariables = [];
      this.updatePosition(content, object, 'object');

      typeFile += `\n`;
      typeFile += object.groups.comment;

      this.className = object.groups.name;

      typeFile += `declare interface ${object.groups.name}Type extends React.component {`;
      typeFile += this.parseClass(object.groups.object);
      typeFile += `}\n`;
    }

    return typeFile;
  }
};

module.exports = ClassParser;