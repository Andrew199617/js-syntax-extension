const  vscode = require('vscode');

/**
 * @description get the configuration for vscode.
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
      console.warn('No array of array implemented yet.');
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
   * @param {*} value the value of the property.
   * @returns {any} the type.
   */
  parseValue(value) {
    if(typeof value === 'undefined') {
      return null;
    }

    if(value === 'true' || value === 'false') {
      return 'boolean';
    }
    if(value.includes("'") || value.includes('"')) {
      return 'string';
    }
    else if(!isNaN(parseInt(value))) {
      return 'number';
    }
    else if(value === 'null' || value === 'undefined') {
      return 'any';
    }
    else if(value.includes('{') && value.includes('}')) {
      return 'object';
    }
    else if(value.includes('[') && value.includes(']')) {
      return 'any[]';
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
    return newType;
  },

  getClassInCreate(insideFunction) {
    const classNameRegex = /(const|let|var) (?<name>\w+?)\s*=\s*Object\.(create|assign)\s*?\(/ms;
    let className = classNameRegex.exec(insideFunction);
    return className && className.groups.name;
  },

  /**
   * @description parse the create funciton for variables.
   * These varaibles are treated like normal variables 
   * variables on the object literal are treated like static.
   * @returns {string}
   */
  parseCreate(tabSize, insideFunction) {
    const className = this.getClassInCreate(insideFunction);

    if(!className) {
      throw new Error('Could not parse class name in create.');
    }

    const comment = '(?<comment>\\/\\*\\*.*?\\*\\/.*?|)';
    const tabRegex = `^(?<tabs>\\s{${tabSize}})`;
    const varaibleName = `${className}\\.(?<name>\\w+?)\\s*?=\\s*?`;
    const valueRegex = `((\\[(?<array>.*?)^\\s{${tabSize}}\\]|(?<value>.*?)))(;|$)`;
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

      const type = this.parseValue(variable.groups.value) 
        || this.parseArray(variable.groups.array)
        || options.type;

      // Must be a es6 function.
      if(typeof type === 'undefined') {
        throw new Error(`Could not parse ${variable.groups.name} in create function. No functions declarations in create()`);
      }

      if(this.variables.includes(variable.groups.name)) {
        throw new Error(`Already defined ${variable.groups.name} as static variable.`);
      }

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
    // Block \s*?\(\s*?\)\s*?{.*?}
    // If Statement if\s*\(((?!\s*\{).*?)\)\s*\{.*?\}$
    // if statement on same line ^(?<tabs>\s*)if\s*\(((?!\s*{).*?)\)\s*{.*?(?P=tabs)}$
    const Allman = false;
    const stroustrup = true;
    if(Allman) {
      console.warn('Allman not implemented');
    }
    const tabSize = lgd.configuration.options.tabSize;

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
        const tabLevel = 2;
        property += this.parseCreate(tabSize * tabLevel, properties.groups.function);
      }

      property += `\n\t`;
      property += this.parseComment(properties.groups.comment, options, isAsync);
      let functionParamaters = '';
      if(properties.groups.params) {
        functionParamaters = this.parseFunction(properties.groups.params, options.params);
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

      // Use comment type if not parsed type.
      if(type === 'any' || !type) {
        type = options.type;
      }

      this.variables.push(properties.groups.name);
      property += `${keywords}${properties.groups.name}${functionParamaters}: ${type};`;
      property += `\n`;
    } 

    return property;
  },

  /**
   * @description Parse a js file into a ts file.
   * @param {string} content contains js file.
   * @returns {string} the the type file to write to disk.
   */
  parse(content) {
    this.variables = [];
    const objectLiterals = /(?<comment>\/\*\*.*?\*\/.*?|)(const|let|var) (?<name>\w+?) = {(?<object>.*?)^}/gms;
    let object;
    let typeFile = '';
    while((object = objectLiterals.exec(content)) !== null) {
      typeFile += `\n`;
      typeFile += object.groups.comment;
      typeFile += `declare interface ${object.groups.name}Type {`;
      typeFile += this.parseClass(object.groups.object);
      typeFile += `}\n`;
    } 
    
    return typeFile;
  }
}

module.exports = FileParser;