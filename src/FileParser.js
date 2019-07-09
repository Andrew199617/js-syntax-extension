const  vscode = require('vscode');

/**
 * @description get the configuration for vscode.
 */
const FileParser = {

  create() {
    const fileParser = Object.assign({}, FileParser);
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
      return 'any[]';
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

    return null;
  },

  parseComment(comment, options, isAsync) {
    let description = /@description(?!$)\s*(?<description>.*?(\s|\*)(?=@|\*\/)|.*?$)/gms;
    let jsdocRegex = /@(?<jsdoc>(type|returns|param))(?!$)(\s*{(?<type>.*?)}|)\s*(?<name>\w*)(?<description>.*?( |\*)(?=@|\*\/)|.*?$)/gms;
    let typesRegex = /.*?(?<type>\s*{.*?}+)/g;

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

  parseType(type) {
    let newType = type
    newType = newType.replace(/bool(?!ean)/g, 'boolean');
    newType = newType.replace(/\*/g, 'any');
    return newType;
  },

  /**
   * Parse an object literal into properties for a ts file.
   * @param {string} object 
   * @returns {string} parsed object.
   */
  parseObject(object) {
    // Block \s*?\(\s*?\)\s*?{.*?}
    // If Statement if\s*\(((?!\s*\{).*?)\)\s*\{.*?\}$
    // if statement on same line ^(?<tabs>\s*)if\s*\(((?!\s*{).*?)\)\s*{.*?(?P=tabs)}$
    const Allman = false;
    const stroustrup = true;
    if(Allman) {
      console.warn('Allman not implemented');
    }
    const tabSize = lgd.configuration.options.tabSize;

    const comment = '(?<comment>\\/\\*\\*.*?\\*\\/.*?|)';
    const tabRegex = '^(?<tabs>\\s*)';
    const functionKeywords = '(?<keyword>async\\s*|)';
    const varaibleName = '(?<name>\\w+?)';
    const functionRegex = `((?<params>\\(.*?\\))\\s*?{(?<function>.*?)^\\s{${tabSize}}(}|},)$`;
    const valueRegex = `|\\s*:\\s*(\\[(?<array>.*?)^\\s{${tabSize}}\\]|(?<value>.*?)))(,|$)`;
    const propertiesRegex = new RegExp([
      comment, tabRegex, 
      functionKeywords, varaibleName, 
      functionRegex, valueRegex
    ].join(''),'gms');

    let properties;
    let property = '';

    while((properties = propertiesRegex.exec(object)) !== null) {
      const options = {
        type: undefined,
        isFunction: false,
        params: {}
      };
      const isAsync = properties.groups.keyword && properties.groups.keyword.includes('async');
      property += `\n\t`;
      property += this.parseComment(properties.groups.comment, options, isAsync);
      let functionParamaters = '';
      if(properties.groups.params) {
        functionParamaters = this.parseFunction(properties.groups.params, options.params);
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

      const type = this.parseValue(properties.groups.value) 
        || this.parseArray(properties.groups.array)
        || options.type;
      property += `${properties.groups.name}${functionParamaters}: ${type};`;
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
    const objectLiterals = /(?<comment>\/\*\*.*?\*\/.*?|)(const|let|var) (?<name>\w+?) = {(?<object>.*?)^}/gms;
    let object;
    let typeFile = '';
    while((object = objectLiterals.exec(content)) !== null) {
      typeFile += `\n`;
      typeFile += object.groups.comment;
      typeFile += `declare interface ${object.groups.name} {`;
      typeFile += this.parseObject(object.groups.object);
      typeFile += `}\n`;
    } 

    return typeFile;
  }
}

module.exports = FileParser;