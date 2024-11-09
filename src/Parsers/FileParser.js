/* eslint-disable max-lines-per-function */
const VscodeError = require('../Errors/VscodeError');

const ErrorTypes = require('../Errors/ErrorTypes');
const Types = require('./Types');

const EnumParser = require('./EnumParser');
const FunctionParser = require('./FunctionParser');

const checkForThisInConstructor = require('../Checks/CheckForThisInConstructor');
const KeywordOrderCheck = require('../Checks/KeywordOrderCheck');
const FindFile = require('../FileSystem/FindFile');

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
    const fileParser = Object.create(FileParser);

    /**
     * @description the variables that the class contains.
     * @type {{ [variableName: string]: boolean}}
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
     * @description The character that is the beginning of the current parse. "This line is being parsed" <- T in "This" is the beginCharacter.
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

    /** @description Compilation was not a success don't reset problems. */
    fileParser.errorOccurred = false;

    /** @type {number} */
    fileParser.defaultTabSize = lgd.configuration.tabSize;

    /** @type {number} */
    fileParser.tabSize = 0;

    /**
     * @description Interface for parsed props.
     * @type {string}
     */
    fileParser.propsInterface = null;

    /**
     * @description Interface for parsed state.
     * @type {string}
     */
    fileParser.stateInterface = null;

    /**
     * @description Whether the current object we are parsing is a React Object.
     */
    fileParser.isReactComponent = false;

    /**
     * @description The content of the file.
     */
    fileParser.content = null;

    return fileParser;
  },

  /**
  * @description Create an error / Problem for the user to fix.
  * Will prevent page from being compiled.
  * @param {string} message
  * @param {CodeActionsType} codeAction Provide a fix for the error.
  */
  createError(message, codeAction = null) {
    const vscodeError = VscodeError.create(message, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR);

    if(codeAction) {
      vscodeError.provideCodeAction(codeAction)
    }

    vscodeError.notifyUser(this);
  },

  /**
   * @description Parses any property values.
   * @param {string} valuesStr the value of the property.
   * @returns {any} the type.
   */
  async parseArray(valuesStr) {
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
      const type = await this.parseValue(values[i]);
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
  async parseValue(value) {
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
      return `{${await tempParser.parseObject(value)}${tabs}}`;
    }

    if(value.includes('.bind(this)')) {
      return Types.FUNCTION;
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

    const operationRegex = new RegExp(`(${ops})`, 'm');
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
        lgd.logger.logError(`Error occurred parsing value using "any" instead. err: ${err}`);
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
    const jsdocRegex = /@(?<jsdoc>(template|extends))(?!$)(\s*{(?<type>.*?)}|\s*(?<name>[\w, ]*))/gms;

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

  /**
   * @description Parse a comment.
   * @param {string} comment The comment to parse.
   * @param {Object} options
   * @returns {string} The parsed comment.
   */
  async parseComment(comment, options) {
    const jsdocRegex = /@(?<jsdoc>(type|returns|param))(?!$)(\s*{(?<type>.*?)}(?![^\n]*}))\s*(?<name>\w*)(?<description>.*?)(?=(@|\*\/))/gms;

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

        doc.groups.type = await this.getTypeWithTemplates(doc.groups.type);

        if(!doc.groups.type) {
          doc.groups.type = 'any';
        }

        numReturns++;
        options.type = doc.groups.type;
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
   * @description given a type add templates if any. ex: MyClassType -> MyClassType<T>
   * @param {string} type ex: MyClassType
   * @returns {string} the type with templates if any.
   */
  async getTypeWithTemplates(type) {
    // Append templates to my own classType.
    if(this.className === type || `${this.className}Type` === type) {
      type = this.parseTypeWithTemplates(this.content);
      return type;
    }

    // const typeRegex = /.*?Type/ms;
    // if(type && typeRegex.test(type)) {
    //   const document = await FindFile.generateDocumentFromType(type);
    //   if(document) {
    //     const tempParser = FileParser.create();
    //     type = tempParser.parseTypeWithTemplates(document.getText());
    //   }
    //   else {
    //     lgd.logger.logWarning(`Could not find file for ${type}.`);
    //   }
    // }

    return type;
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

    if((!className || !className.groups.name) && !this.isReactComponent) {
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
    checkForThisInConstructor.bind(this)(insideFunction);
  },

  /**
   * @description Add variable to local variables of class.
   * Do checks before adding.
   * @param {string} variableName
   * @param {boolean} strict whether another variable of same name can exist.
   */
  addVariable(variableName, strict = false) {
    if(this.staticVariables.includes(variableName)) {
      VscodeError.create(`LGD: Already defined ${variableName} as static variable or function.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
        .notifyUser(this);
    }
    else if(typeof this.variables[variableName] !== 'undefined') {
      if(strict) {
        VscodeError.create(`LGD: Defined ${variableName} as property already.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .notifyUser(this);
      }

      return false;
    }

    this.variables[variableName] = true;
    return true;
  },

  /**
   * @description print the text for extends.
   * @param {string[]} extendsDoc The array of extends found in jsx comment.
   * @param {string} content the context for finding where errors occurred in the file.
   * @returns {string}
   */
  printExtends(extendsDoc, content) {
    if(this.isReactComponent) {
      // TODO check that React.Component is used.
      const defaultReactExtends = `React.Component<${this.className}Props, ${this.className}State>`;
      if(extendsDoc.includes(defaultReactExtends)) {
        this.updatePositionToString(content, defaultReactExtends);
        this.createError(
          `Using ${defaultReactExtends} without templates is unnecessary.`,
          lgd.codeActions.removeDefaultReactExtends);
      }
      else {
        extendsDoc.push(defaultReactExtends);
      }
    }

    return extendsDoc.length > 0
      ? `extends ${extendsDoc.join(', ')} `
      : '';
  },

  /**
  * @description Parse the props of a file.
  */
  async parseProps(objectName, content) {
    if(!lgd.configuration.extractPropsAndState) {
      return;
    }

    const commentRegex = `(?<comment>(\\/\\*\\*.*?\\*\\/(?=\\s*${objectName})|))`;
    const objectLiterals = `^${objectName}.propTypes\\s*=\\s*{(?<object>.*?)^}`;

    const regex = new RegExp([commentRegex, objectLiterals].join(''), 'gms');

    let object;
    let propsExisted = false;
    while((object = regex.exec(content)) !== null) {
      if(propsExisted) {
        VscodeError.create(`LGD: ${objectName} already has propTypes defined;`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.HINT)
          .notifyUser(this);
        break;
      }

      const propsType = await this.parseObject(object.groups.object, { preferComments: true, ignoreDuplicate: true });
      this.propsInterface = `\n${object.groups.comment}declare interface ${objectName}Props {${propsType}};\n`;
      propsExisted = true;
    }
  },

  /**
   * @description parse the create function for variables.
   * These variables are treated like normal variables
   * variables on the object literal are treated like static.
   * @param {string} insideFunction
   * @returns {string}
   */
  async parseCreate(insideFunction) {
    this.tabSize += this.defaultTabSize;
    let className = this.getClassInCreate(insideFunction);

    if(!className) {
      if(!this.isReactComponent) {
        return;
      }

      // TODO check for use of both this and className.
      // Don't be greedy.
      className = 'this';
    }

    if(!this.isReactComponent) {
      this.checkForThisInCreate(insideFunction);
    }

    const tab = `\\s{${this.tabSize}}`;
    const previousTab = `\\s{${this.tabSize - this.defaultTabSize}}`;

    const varName = '(?<name>\\w+?)';
    const varDeliminator = '\\s*?=\\s*';
    // $(?!.) = Match until end of insideFunction.
    const varEnd = `(;|$)(?=\\s*(^${previousTab}}|^${tab}(\\/|\\w)|$(?!.)))`;
    const arrayRegex = `\\[(?<array>.*?)${varEnd}`;

    const commentRegex = '(?<comment>(\\/\\*\\*.*?\\*\\/.*?|))';
    const tabRegex = `^(?<tabs>${tab})`;
    const firstAccess = `(\\.|\\[')`;
    const objectAccessorEnd = `(\\[|\\['|\\.)`;
    const infiniteDots = `\\w[\\w+\\.]+`;
    const infiniteSquares = `\\w+\\[[\\w\\]'\`\\$\\{\\}\\[]+`;
    // access is example.value or example['value'] or example['value']['value'] or example.value['value']
    const objectAccessor = `${firstAccess}(?<objectAccessors>(${infiniteSquares}${objectAccessorEnd}|${infiniteDots}${objectAccessorEnd}|))`;
    // regex that will get every ['var'] from this string "example['var']['var']"
    const varAccessor = `\\['(?<access>.*?)'\\]`;
    const variableName = `${className}${objectAccessor}${varName}(\\]|'\\]|)${varDeliminator}`;
    const valueRegex = `(${arrayRegex}|(?<value>.*?)${varEnd})`;

    const variablesRegex = new RegExp(
      [
        commentRegex,
        tabRegex,
        variableName,
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

      const settingValueUsingVariable = variable.groups.objectAccessors.endsWith('[');
      if(settingValueUsingVariable) {
        lgd.logger.logWarning(`Ignoring because you are using a variable to set object. See -> ${variable.groups.objectAccessors}${variable.groups.name}].`);
        continue;
      }

      if(variable.groups.value.includes(`this.${variable.groups.name}.bind(this)`)) {
        console.log(`ignoring this.${variable.groups.name}.bind(this);`);
        continue;
      }

      const comment = await this.parseComment(variable.groups.comment, options, false);

      if(options.type) {
        options.type = this.fixType(options.type);
      }

      const type = options.type
        || await this.parseValue(variable.groups.value)
        || await this.parseArray(variable.groups.array);


      // Must be a es6 function.
      if(typeof type === 'undefined') {
        VscodeError.create(`LGD: Could not parse ${variable.groups.name} in create function. No functions declarations in create()`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .notifyUser(this);
        continue;
      }

      this.addVariable(variable.groups.name);

      let definedOnState = /state(\.|\[)/.test(variable.groups.objectAccessors);
      if(definedOnState) {
        if(!this.stateInterface) {
          this.stateInterface = `\ndeclare interface ${this.className}State {`;
        }

        this.stateInterface += `\n\t${comment}${variable.groups.name}: ${type};\n`;
        continue;
      }

      if(variable.groups.name === 'state' && lgd.configuration.extractPropsAndState) {
        const stateType = type.replace(new RegExp(`^\\t`, 'gm'), '');
        this.stateInterface = `\n${comment}declare interface ${this.className}State ${stateType};\n`;
        continue;
      }

      variables += `\n\t`;
      variables += comment;
      variables += `${variable.groups.name}: ${type};`;
      variables += `\n`;
    }

    if(this.stateInterface?.endsWith('};\n') === false) {
      this.stateInterface += '};\n';
    }

    this.tabSize -= this.defaultTabSize;
    return variables || '';
  },

  /**
   * Parse an object literal into properties for a ts file.
   * @param {string} object
   * @param {{ preferComments: boolean, ignoreDuplicate: boolean }} parsingOptions
   * @returns {string} parsed object.
   */
  async parseObject(object, parsingOptions = { preferComments: false, ignoreDuplicate: false }) {
    this.tabSize += this.defaultTabSize;
    const lastBeginLine = this.beginLine;

    const tab = `\\s{${this.tabSize}}`;
    const previousTab = `\\s{${this.tabSize - this.defaultTabSize}}`;

    const varName = '\\w+?';
    const varDeliminator = '\\s*?:\\s*';
    const varEndLookAhead = `(?=\\s*(^${tab}\\/|^${previousTab}}|^${tab}${varName}|$(?!.)))`;
    const valueEnd = `(,|$)${varEndLookAhead}`;
    const functionEnd = `(},|}|$)${varEndLookAhead}`;

    const invalidKeyword = '(?<invalid>(async\\s+(get|set)\\s+|))';
    const keywordsRegex = `${invalidKeyword}(?<keyword>async\\s+|)(?<getter>get\\s+|)(?<setter>set\\s+|)`;

    const comment = '(?<comment>\\/\\*\\*.*?\\*\\/.*?|)';
    const tabRegex = `^(?<tabs>${tab})`;
    const varaibleNameRegex = `(?<name>${varName})`;
    const functionRegex = `(?<params>\\(.*?\\))\\s*?{(?<function>.*?)${functionEnd}`;
    const arrayRegex = `\\[(?<array>.*?)${valueEnd}`;
    const valueRegex = `${varDeliminator}(${arrayRegex}|(?<value>.*?)${valueEnd})`;

    const propertiesRegex = new RegExp(
      [
        comment,
        tabRegex,
        keywordsRegex,
        varaibleNameRegex,
        `(${functionRegex}|${valueRegex})`
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

      const isAsync = typeof properties.groups.keyword === 'string' && properties.groups.keyword.includes('async');
      const isGetter = typeof properties.groups.getter === 'string' && properties.groups.getter.includes('get');
      const isSetter = typeof properties.groups.setter === 'string' && properties.groups.setter.includes('set');

      if(isSetter || isGetter) {
        // TODO Getter and Setter as Static if no this in function.
        const varExisted = !this.addVariable(properties.groups.name, false);
        if(varExisted && isSetter) {
          property = property.replace(`readonly ${properties.groups.name}`, properties.groups.name);
          continue;
        }
        else if(varExisted) {
          continue;
        }
      }

      if(properties.groups.name === ConstructorMethodName) {
        this.updatePosition(object, properties, 'function', lastBeginLine);
        property += await this.parseCreate(properties.groups.function);
      }

      const tabSize = this.tabSize > this.defaultTabSize ? this.tabSize - this.defaultTabSize : this.tabSize;
      property += `\n${new Array(tabSize / this.defaultTabSize).fill('\t').join('')}`;
      property += await this.parseComment(properties.groups.comment, options, isAsync);
      let functionParameters = '';
      if(properties.groups.params) {
        // Already updated.
        if(properties.groups.name !== ConstructorMethodName) {
          this.updatePosition(object, properties, 'function', lastBeginLine);
        }

        if(isGetter) {
          keywords = 'readonly ';
        }
        else if(!isSetter) {
          functionParameters = await this.functionParser.parseFunctionParams(properties.groups.params, options.params);
        }

        // Check for errors in Function.
        this.functionParser.checkFunction(properties.groups.function, this);
      }
      else {
        keywords = 'static ';
      }

      if(!options.type) {
        options.type = 'any';

        // Setter has no return.
        if(properties.groups.function && !isSetter) {
          options.type = await this.functionParser.parseFunctionReturn(properties.groups.function);
        }

        if(isGetter && options.type === 'void') {
          // Getter needs to have a return.
          options.type = 'null';
        }
      }
      else {
        options.type = this.fixType(options.type);
      }

      options.type = isAsync && !options.type.includes('Promise') ? `Promise<${options.type}>` : options.type;

      let type = null;

      if(parsingOptions.preferComments) {
        type = options.type
          || await this.parseValue(properties.groups.value)
          || await this.parseArray(properties.groups.array);
      }
      else {
        type = await this.parseValue(properties.groups.value)
          || await this.parseArray(properties.groups.array)
          || options.type;
      }

      if(this.staticVariables.includes(properties.groups.name)) {
        VscodeError.create(`LGD: Already defined ${properties.groups.name} as static variable or function.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .notifyUser(this);
      }

      // Use comment type if not parsed type.
      if(type === 'any' || !type) {
        type = options.type;
      }

      if(!properties.groups.function && !parsingOptions.ignoreDuplicate) {
        this.staticVariables.push(properties.groups.name);
      }

      property += `${keywords}${properties.groups.name}${functionParameters}: ${type};`;
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
  * @description Get the class type with template args. Given Tester with template arg Props return TesterType<Props>.
  * @param {string} content the content of the file.
  * @returns {string} the class type.
  */
  parseTypeWithTemplates(content) {
    const objectLiterals = /(?<comment>\/\*\*.*?\*\/.*?|)(export |)(?<var>const|let|var) (?<name>\w+?) = (?<react>(createReactClass\(|)){(?<object>.*?)^}/gms;
    let object;
    while((object = objectLiterals.exec(content)) !== null) {
      const docs = this.parseClassComment(object.groups.comment);

      if(docs.template.length === 0) {
        return `${object.groups.name}Type`;
      }

      return `${object.groups.name}Type<${docs.template.join(',')}>`;
    }
  },

  /**
   * @description Parse a js file into a ts file.
   * @param {string} typeFile the type file to append.
   * @param {string} content contains js file.
   * @returns {string} the the type file to write to disk.
   */
  async parse(typeFile, content) {
    this.content = content;
    const objectLiterals = /(?<comment>\/\*\*.*?\*\/.*?|)(export |)(?<var>const|let|var) (?<name>\w+?) = (?<react>(createReactClass\(|)){(?<object>.*?)^}/gms;

    let object;
    while((object = objectLiterals.exec(content)) !== null) {
      this.variables = {};
      this.staticVariables = [];
      this.updatePosition(content, object, 'object');

      this.className = object.groups.name;

      const isReactRegex = new RegExp(`createReact(Component|Pure)\\(${this.className}`, '');
      this.isReactComponent = isReactRegex.test(content);

      if(this.enumParser.isEnum(object.groups.comment)) {
        typeFile += this.enumParser.parse(content, object);
        continue;
      }

      await this.parseProps(this.className, content);

      if(object.groups.react !== '') {
        this.updatePositionToString(content, 'createReactClass');
        VscodeError.create(`LGD: Move createReactClass to the export statement -> export default createReactClass(${this.className});`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
          .provideCodeAction(lgd.codeActions.moveCreateReactClass)
          .notifyUser(this);
      }

      const docs = this.parseClassComment(object.groups.comment);
      const parsedClass = await this.parseObject(object.groups.object);

      typeFile += this.propsInterface || '';
      typeFile += this.stateInterface || '';

      typeFile += `\n`;
      typeFile += object.groups.comment;
      typeFile += `declare interface ${object.groups.name}Type${docs.template.length > 0
        ? `<${docs.template.join(',')}>`
        : ''} ${this.printExtends(docs.extends, content)}{`;
      typeFile += parsedClass;
      typeFile += `}\n`;
    }

    return typeFile;
  }
};

module.exports = FileParser;