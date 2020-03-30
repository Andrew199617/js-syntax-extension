const VscodeError = require('../Errors/VscodeError');
const ErrorTypes = require('../Errors/ErrorTypes');

const KeywordOrderCheck = require('../Checks/KeywordOrderCheck');

/**
* @description Parse a string enum.
* @type {EnumParserType}
*/
const EnumParser = {
  /**
  * @description Initialize an instace of EnumParser.
  * @param {FileParserType} fileParser
  * @returns {EnumParserType}
  */
  create(fileParser) {
    const enumParser = Object.create(EnumParser);

    /** @type {FileParserType} */
    enumParser.fileParser = fileParser;

    /**
     * @description The name of the class we parsed.
     * @type {string}
     */
    enumParser.className = null;

    /**
     * @description the static variables that the class contains.
     * @type {string[]}
     */
    enumParser.staticVariables = null;

    /** @type {number} */
    enumParser.defaultTabSize = lgd.configuration.options.tabSize;

    /** @type {number} */
    enumParser.tabSize = 0;

    return enumParser;
  },

  updatePosition() {
    this.fileParser.updatePosition.bind(this)(...arguments);
  },

  /**
   * @description Check an object literal comment to see if its an enum.
   * @param {string} comment
   */
  isEnum(comment) {
    return (/@enum/).test(comment);
  },

  writeInterfaceVar(name, keywords) {
    let property = '';

    let type = `${this.className}Enum.${name}`;
    property += `${keywords}${name}: ${type};`;
    property += `\n`;

    return property;
  },

  writeEnumVar(name, _keywords, value) {
    let property = '';

    property += `${name} = ${value},`;
    property += `\n`;

    return property;
  },

  parseEnum(object, writeOut) {
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
    const keywordsRegex = `${invalidKeyword}(?<keyword>async\\s*|)(?<getter>get\\s*|)(?<setter>get\\s*|)`;

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
      let keywords = 'static ';

      if(properties.groups.invalid) {
        this.updatePosition(object, properties, 'name', lastBeginLine);
        KeywordOrderCheck.execute.bind(this)(properties[0]);
      }

      const isAsync = properties.groups.keyword && properties.groups.keyword.includes('async');
      const isGetter = !!properties.groups.getter && properties.groups.getter.includes('get');
      const isSetter = !!properties.groups.setter && properties.groups.setter.includes('set');

      if(isSetter || isGetter || isAsync) {
        this.updatePosition(object, properties, 'name', lastBeginLine);
        VscodeError.create(`LGD: No Getters, Setters or Async in Enum.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .notifyUser(this.fileParser);
        continue;
      }

      if(properties.groups.function || properties.groups.params) {
        this.updatePosition(object, properties, 'name', lastBeginLine);
        VscodeError.create(`LGD: No functions in Enum, use helper class.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .notifyUser(this.fileParser);
        continue;
      }

      if(this.staticVariables.includes(properties.groups.name)) {
        VscodeError.create(`LGD: Already defined ${properties.groups.name}.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .notifyUser(this.fileParser);
        continue;
      }

      this.staticVariables.push(properties.groups.name);

      const tabSize = this.tabSize > this.defaultTabSize ? this.tabSize - this.defaultTabSize : this.tabSize;
      property += `\n${new Array(tabSize / this.defaultTabSize).fill('\t').join('')}`;
      property += properties.groups.comment;

      if(properties.groups.comment.length > 0) {
        const tabSize = this.tabSize > this.defaultTabSize ? this.tabSize - this.defaultTabSize : this.tabSize;
        property += `${new Array(tabSize / this.defaultTabSize).fill('\t').join('')}`;
      }

      property += writeOut(properties.groups.name, keywords, properties.groups.value);
    }

    this.tabSize -= this.defaultTabSize;
    return property;
  },

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
   * @description
   * @param {string} str
   */
  parse(content, object) {
    let parsedEnum = '';
    this.updatePosition(content, object, 'object');

    this.className = object.groups.name;

    if(this.className.includes('Enum')) {
      VscodeError
        .create(`LGD: ${this.className} should not have Enum in Name.`,
          this.beginLine,
          object.groups.var.length + 1,
          this.beginLine,
          this.className.length,
          ErrorTypes.ERROR)
        .notifyUser(this.fileParser);
    }

    this.staticVariables = [];
    parsedEnum += `\n`;
    parsedEnum += object.groups.comment.replace(/^\*\s*?@enum\s*$\s/ms, '');
    parsedEnum += `declare interface ${object.groups.name}Type {`;
    parsedEnum += this.parseEnum(object.groups.object, this.writeInterfaceVar.bind(this));
    parsedEnum += `}\n\n`;

    this.staticVariables = [];
    parsedEnum += object.groups.comment.replace(/@type {.*?}/ms, `@type {${object.groups.name}Enum}`);
    parsedEnum += `declare enum ${object.groups.name}Enum {`;
    parsedEnum += this.parseEnum(object.groups.object, this.writeEnumVar.bind(this));
    parsedEnum = parsedEnum.slice(0, -2);
    parsedEnum += `\n}\n`;

    return parsedEnum;
  }
};

module.exports = EnumParser;