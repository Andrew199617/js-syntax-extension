/* eslint-disable max-lines-per-function */
const FileParser = require('./FileParser');

const VscodeError = require('../Errors/VscodeError');
const ErrorTypes = require('../Errors/ErrorTypes');

const StaticAccessorCheck = require('../Checks/StaticAccessorCheck');
const KeywordOrderCheck = require('../Checks/KeywordOrderCheck');

const { Oloo } = require('@mavega/oloo');

const Types = require('./Types');

const ConstructorMethodName = 'constructor';

/**
* @description Parse a function from a JS File into a TS Interface.
* parses a React function into a typescript interface.
* @type {FunctionComponentParserType}
* @extends {FileParserType}
*/
const FunctionComponentParser = {
  /**
  * @description Initialize an instance of FunctionComponentParser.
  * @returns {FunctionComponentParserType & FileParserType}
  */
  create() {
    const functionComponentParser = Oloo.assignSlow(FileParser.create(), FunctionComponentParser);
    return functionComponentParser;
  },

  async parseType(options, properties) {
    if(options && !options.type) {

      if(!properties.groups.function) {
        options.type = Types.ANY;
        return;
      }

      if(properties.groups.name === 'render') {
        options.type = Types.JSXELEMENT;
      }
      else if(properties.groups.name === ConstructorMethodName) {
        options.type = `${this.className}Type`;
      }
      else if(properties.groups.function.includes('return')) {
        options.type = await this.functionParser.parseFunctionReturn(properties.groups.function);
      }
      else {
        options.type = Types.VOID;
      }
    }
    else if(options) {
      options.type = this.fixType(options.type);
    }
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
  async parseClass(object) {
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
        property += await this.parseCreate(properties.groups.function);
      }

      property += `\n\t`;
      property += await this.parseComment(properties.groups.comment, options, isAsync);

      let functionParamaters = '';
      if(properties.groups.params) {
        // Already updated.
        if(properties.groups.name !== ConstructorMethodName) {
          this.updatePosition(object, properties, 'function', lastBeginLine);
        }

        functionParamaters = await this.functionParser.parseFunctionParams(properties.groups.params, options.params);
        StaticAccessorCheck.execute.bind(this)(properties.groups.function);
      }

      if(isStatic) {
        keywords = 'static ';
      }

      await this.parseType(options, properties);

      options.type = isAsync && !options.type.includes('Promise') ? `Promise<${options.type}>` : options.type;

      let type = await this.parseValue(properties.groups.value)
        || await this.parseArray(properties.groups.array)
        || options.type;

      if(this.staticVariables.includes(properties.groups.name)) {
        VscodeError.create(`LGD: Already defined ${properties.groups.name} as static variable or function.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .notifyUser(this);
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

  /**
   * @description
   * @param {string} content
   * @param {string} typeFile
   * @returns {{ typeFile: string, content: string }}
   */
  async parse(content, typeFile) {
    const funcComponent = /(?<comment>\/\*\*.*?\*\/.*?|)function (?<name>\w+?)\(props\) {(?<func>.*?)^}/gms;
    let func;
    while((func = funcComponent.exec(content)) !== null) {
      this.variables = {};
      this.staticVariables = [];
      this.updatePosition(content, func, 'func');

      await this.parseProps(func.groups.name, content);

      typeFile += this.propsInterface || '';
    }

    content = content.replace(funcComponent, '');
    return { typeFile, content };
  }
};

module.exports = FunctionComponentParser;