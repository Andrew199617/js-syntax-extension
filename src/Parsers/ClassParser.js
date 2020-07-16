/* eslint-disable max-lines-per-function */
const FileParser = require('./FileParser');

const VscodeError = require('../Errors/VscodeError');
const ErrorTypes = require('../Errors/ErrorTypes');

const StaticAccessorCheck = require('../Checks/StaticAccessorCheck');
const KeywordOrderCheck = require('../Checks/KeywordOrderCheck');

const { Oloo } = require('@learngamedevelopment/oloo');

const Types = require('./Types');

const ConstructorMethodName = 'constructor';

/**
* @description Parse a class from a JS File into a TS Interface.
* @type {ClassParserType}
* @extends {FileParserType}
*/
const ClassParser = {
  /**
  * @description Initialize an instance of ClassParser.
  * @returns {ClassParserType & FileParserType}
  */
  create() {
    const classParser = Oloo.assignSlow(FileParser.create(), ClassParser);
    return classParser;
  },

  checkForThisInCreate() {

  },

  parseType(options, properties) {
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
        options.type = this.functionParser.parseFunctionReturn(properties.groups.function);
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
    let classObj;
    if((classObj = classKeywordRegex.exec(content)) !== null) {
      this.updatePosition(content, classObj, 'class');
      return true;
    }

    return false;
  },

  /**
   * Parse an class into properties for a ts file.
   * @param {string} classObj
   * @returns {string} parsed classObj.
   */
  parseClass(classObj) {
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

    while((properties = propertiesRegex.exec(classObj)) !== null) {
      let keywords = '';
      const options = {
        type: undefined,
        isFunction: false,
        params: {}
      };

      if(properties.groups.invalid) {
        this.updatePosition(classObj, properties, 'name', lastBeginLine);
        KeywordOrderCheck.execute.bind(this)(properties[0]);
      }

      const isAsync = !!properties.groups.async && properties.groups.async.includes('async');
      const isStatic = !!properties.groups.static && properties.groups.static.includes('static');

      if(properties.groups.name === ConstructorMethodName) {
        this.updatePosition(classObj, properties, 'function', lastBeginLine);
        property += this.parseCreate(properties.groups.function);
      }

      property += `\n\t`;
      property += this.parseComment(properties.groups.comment, options, isAsync);

      let functionParamaters = '';
      if(properties.groups.params) {
        // Already updated.
        if(properties.groups.name !== ConstructorMethodName) {
          this.updatePosition(classObj, properties, 'function', lastBeginLine);
        }

        functionParamaters = this.functionParser.parseFunctionParams(properties.groups.params, options.params);
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
  parse(content, typeFile) {
    if(!this.checkForClassKeyword(content)) {
      return { typeFile, content };
    }

    const classObjRegex = /(?<comment>\/\*\*.*?\*\/\s*?|)(?<var>class) (?<name>\w+?) extends (?<extends>[\w\.]+) {(?<classObj>.*?)^}/gms;
    let classObj;
    while((classObj = classObjRegex.exec(content)) !== null) {
      this.variables = {};
      this.staticVariables = [];
      this.updatePosition(content, classObj, 'classObj');

      this.isReactComponent = classObj.groups.extends.includes('React.Component');

      this.parseProps(classObj.groups.name, content);

      const docs = this.parseClassComment(classObj.groups.comment);

      this.className = classObj.groups.name;
      const parsedClass = this.parseClass(classObj.groups.classObj);

      typeFile += this.propsInterface || '';
      typeFile += this.stateInterface || '';

      typeFile += `\n`;
      typeFile += classObj.groups.comment;

      const extendsStr = this.printExtends(docs.extends, content);
      const template = `${docs.template.length > 0 ? `<${docs.template.join(',')}>` : ''}`
      typeFile += `declare interface ${classObj.groups.name}Type${template} ${extendsStr} {`;

      typeFile += parsedClass;
      typeFile += `}\n`;
    }

    content = content.replace(classObjRegex, '');
    return { typeFile, content };
  }
};

module.exports = ClassParser;