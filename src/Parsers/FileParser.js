const ParserPosition = require('./ParserPosition');
const ValueParser = require('./ValueParser');
const CreateValueScope = require('./CreateValueScope');
const VscodeError = require('../Errors/VscodeError');

const ErrorTypes = require('../Errors/ErrorTypes');
const Types = require('./Types');

const EnumParser = require('./EnumParser');
const FunctionParser = require('./FunctionParser');
const hasDirectInstanceReturn = require('./HasDirectInstanceReturn');

const reportInvalidThisUsageInCreate = require('../Checks/ReportInvalidThisUsageInCreate');
const KeywordOrderCheck = require('../Checks/KeywordOrderCheck');

// Method that initializes instances in this parser.
const ConstructorMethodName = 'create';

/**
 * @description Parse a JS file and convert it to a TS file.
 * @type {FileParserType}
 */
const FileParser = {
    /** @returns {FileParserType}*/
    create(compilationContext = null)
    {
        const fileParser = Object.create(FileParser);
        fileParser.compilationContext = compilationContext;
        fileParser.logger = compilationContext?.logger || lgd.logger;

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

        /** @description The current begin line being parsed. */
        fileParser.beginLine = 0;

        /** @description The character that is the beginning of the current parse. "This line is being parsed" <- T in "This" is the beginCharacter. */
        fileParser.beginCharacter = 0;

        /** @description The current end line being parsed. */
        fileParser.endLine = 0;

        /** @description The character that ends the parse. "This line is being parsed" <- d is the endCharacter. */
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

        /** @description Whether the current object we are parsing is a React Object. */
        fileParser.isReactComponent = false;

        /** @description The content of the file. */
        fileParser.content = null;

        return fileParser;
    },

    /**
     * @description Create an error / Problem for the user to fix.
     * Will prevent page from being compiled.
     * @param {string} message
     * @param {CodeActionsType} codeAction Provide a fix for the error.
     */
    createError(message, codeAction = null)
    {
        const vscodeError = VscodeError.create(message, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR);

        if(codeAction)
        {
            vscodeError.provideCodeAction(codeAction);
        }

        vscodeError.notifyUser(this);
    },

    async parseArray(valuesStr, valueScope = this.valueScope)
    {
        return await ValueParser.parseArray.call(this, valuesStr, valueScope);
    },

    async parseValue(value, valueScope = this.valueScope)
    {
        return await ValueParser.parseValue.call(this, value, FileParser.create.bind(FileParser), valueScope);
    },

    /**
     * @description Parse the comment of the class to get Template and extends.
     * @param {string} comment The class comment.
     * @returns { { extends: string[], template: string[] } }
     */
    parseClassComment(comment)
    {
        const jsdocRegex = /@(?<jsdoc>(?:template|extends))(?!$)(?:\s*{(?<type>.*?)}|\s*(?<name>[\w, ]*))/gms;

        const docs = { extends: [], template: [] };
        let doc = null;
        while((doc = jsdocRegex.exec(comment)) !== null)
        {
            const jsdoc = doc.groups.jsdoc;
            if(jsdoc === 'template')
            {
                if(typeof doc.groups.type !== 'undefined')
                {
                    this.logger.logWarning("Don't add type for Template");
                }

                docs.template.push(doc.groups.name);
            }
            else if(jsdoc === 'extends')
            {
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
    async parseComment(comment, options)
    {
        const jsdocRegex = /@(?<jsdoc>(?:type|returns|param))(?!$)(?:\s*{(?<type>.*?)}(?![^\n]*}))\s*(?<name>\w*)(?<description>.*?)(?=(?:@|\*\/))/gms;

        let doc;
        let numReturns = 0;
        const maxReturns = 1;
        let numTypes = 0;
        const maxTypes = 1;
        const params = {
            length: 0
        };

        while((doc = jsdocRegex.exec(comment)) !== null)
        {
            const jsdoc = doc.groups.jsdoc;
            if(jsdoc === 'type')
            {
                if(numTypes === maxTypes)
                {
                    continue;
                }

                if(typeof doc.groups.type === 'undefined')
                {
                    this.logger.logWarning('Empty Type tag.');
                }

                numTypes++;
                options.type = doc.groups.type;
            }
            else if(jsdoc === 'returns')
            {
                if(numReturns === maxReturns)
                {
                    continue;
                }

                doc.groups.type = await this.getTypeWithTemplates(doc.groups.type);

                if(!doc.groups.type)
                {
                    doc.groups.type = 'any';
                }

                numReturns++;
                options.type = doc.groups.type;
            }
            else if(jsdoc === 'param')
            {
                if(typeof doc.groups.name === 'undefined')
                {
                    this.logger.logWarning('Empty param tag.');
                    continue;
                }
                else if(typeof doc.groups.type === 'undefined')
                {
                    params[doc.groups.name] = 'any';
                    params.length++;
                    this.logger.logWarning(`Param type for ${doc.groups.name} not given, using any.`);
                    continue;
                }

                doc.groups.type = this.fixType(doc.groups.type);
                params[doc.groups.name] = doc.groups.type;
                params.length++;
            }
        }

        options.params = params;

        if(comment.length > 0)
        {
            const tabSize = this.tabSize > this.defaultTabSize ? this.tabSize - this.defaultTabSize : this.tabSize;
            comment += `${new Array(tabSize / this.defaultTabSize).fill('\t').join('')}`;
        }

        return comment;
    },

    /**
     * @description given a type add templates if any. ex: MyClassType -> MyClassType<T>
     * @param {string} type ex: MyClassType
     * @returns {Promise<string | undefined>} the type with templates if any.
     */
    async getTypeWithTemplates(type)
    {
    // Append templates to my own classType.
        if(this.className === type || `${this.className}Type` === type)
        {
            type = await this.parseTypeWithTemplates(this.content);
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
        //     this.logger.logWarning(`Could not find file for ${type}.`);
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
    fixType(type)
    {
        let newType = type;
        newType = newType.replace(/bool(?!ean)/g, Types.BOOLEAN);
        newType = newType.replace(/\*/g, Types.ANY);
        newType = newType.replace(/function/g, Types.FUNCTION);
        newType = newType.replace(/undefined/g, Types.ANY);
        return newType;
    },

    /**
     * @description Returns the instance variable name, or null for a directly returned instance.
     * @param {string} insideFunction
     * @returns {string | null}
     */
    getClassInCreate(insideFunction)
    {
        const classNameRegex = /(?<varType>const|let|var) (?<name>\w+?)\s*=\s*(?<object>Object|Oloo)\.(?<creationWay>create|assign|assignSlow|createSlow)\s*?\(/;
        const className = classNameRegex.exec(insideFunction);

        if(!className && !this.isReactComponent && !hasDirectInstanceReturn(insideFunction))
        {
            VscodeError.create('LGD: Could not find class instance in create method. Are you creating the instance properly.', this.beginLine, 0, this.endLine, 0, ErrorTypes.ERROR)
                .notifyUser(this);
        }

        return className && className.groups.name;
    },

    /**
     * @description Report invalid use of this in the create method.
     * @param {string} insideFunction The body of the create method.
     */
    reportInvalidThisUsageInCreate(insideFunction)
    {
        reportInvalidThisUsageInCreate.bind(this)(insideFunction);
    },

    /**
     * @description Add variable to local variables of class.
     * Do checks before adding.
     * @param {string} variableName
     * @param {boolean} strict whether another variable of same name can exist.
     */
    addVariable(variableName, strict = false)
    {
        if(this.staticVariables.includes(variableName))
        {
            VscodeError.create(`LGD: Already defined ${variableName} as static variable or function.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
                .notifyUser(this);
        }
        else if(typeof this.variables[variableName] !== 'undefined')
        {
            if(strict)
            {
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
    printExtends(extendsDoc, content)
    {
        if(this.isReactComponent)
        {
            // React component inheritance is inferred from the surrounding declaration.
            const defaultReactExtends = `React.Component<${this.className}Props, ${this.className}State>`;
            if(extendsDoc.includes(defaultReactExtends))
            {
                this.updatePositionToString(content, defaultReactExtends);
                this.createError(
                    `Using ${defaultReactExtends} without templates is unnecessary.`,
                    lgd.codeActions.removeDefaultReactExtends
                );
            }
            else
            {
                extendsDoc.push(defaultReactExtends);
            }
        }

        return extendsDoc.length > 0
            ? `extends ${extendsDoc.join(', ')} `
            : '';
    },

    /** @description Parse the props of a file. */
    async parseProps(objectName, content)
    {
        if(!lgd.configuration.extractPropsAndState)
        {
            return;
        }

        const commentRegex = `(?<comment>(\\/\\*\\*.*?\\*\\/(?=\\s*${objectName})|))`;
        const objectLiterals = `^${objectName}.propTypes\\s*=\\s*{(?<object>.*?)^}`;

        const regex = new RegExp([ commentRegex, objectLiterals ].join(''), 'gms');

        let object;
        let propsExisted = false;
        while((object = regex.exec(content)) !== null)
        {
            if(propsExisted)
            {
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
    async parseCreate(insideFunction, parameters = '()', parameterTypes = {})
    {
        this.tabSize += this.defaultTabSize;
        let className = this.getClassInCreate(insideFunction);

        if(!this.isReactComponent)
        {
            this.reportInvalidThisUsageInCreate(insideFunction);
        }

        if(!className)
        {
            if(!this.isReactComponent)
            {
                this.tabSize -= this.defaultTabSize;
                return '';
            }

            // React components can initialize properties directly on this.
            className = 'this';
        }

        const tab = `\\s{${this.tabSize}}`;
        const previousTab = `\\s{${this.tabSize - this.defaultTabSize}}`;

        const varName = '(?<name>\\w+?)';
        const varDeliminator = '\\s*?=\\s*';

        // $(?!.) = Match until end of insideFunction.
        const varEnd = `(;|$)(?=\\s*(^${tab}}|^${previousTab}}|^${tab}(\\/|\\w)|$(?!.)))`;
        const arrayRegex = `\\[(?<array>.*?)\\]\\s*${varEnd}`;

        const commentRegex = '(?<comment>(?:\\/\\*\\*(?:(?!\\*\\/).)*\\*\\/\\s*|))';
        const tabRegex = `^(?<tabs>[ \t]{${this.tabSize},})`;
        const firstAccess = `(\\.|\\[')`;
        const objectAccessorEnd = `(\\[|\\['|\\.)`;
        const infiniteDots = `\\w[\\w+\\.]+`;
        const infiniteSquares = `\\w+\\[[\\w\\]'\`\\$\\{\\}\\[]+`;

        // access is example.value or example['value'] or example['value']['value'] or example.value['value']
        const objectAccessor = `${firstAccess}(?<objectAccessors>(${infiniteSquares}${objectAccessorEnd}|${infiniteDots}${objectAccessorEnd}|))`;

        const variableName = `${className}${objectAccessor}${varName}(\\]|'\\]|)${varDeliminator}`;
        const valueRegex = `(${arrayRegex}|(?<value>.*?)${varEnd})`;

        const valueScopes = CreateValueScope.createAssignmentScopes(insideFunction, parameters, parameterTypes);
        const variablesRegex = new RegExp(
            [
                commentRegex,
                tabRegex,
                variableName,
                valueRegex
            ].join(''),
            'dgms'
        );

        let variable;
        const parsedVariables = new Map();
        while((variable = variablesRegex.exec(insideFunction)) !== null)
        {
            const options = {
                type: undefined
            };
            const assignmentValue = variable.groups.value;
            const valueRange = variable.indices.groups.value || variable.indices.groups.array;
            const valueScope = valueScopes.get(valueRange[0]);

            const settingValueUsingVariable = variable.groups.objectAccessors.endsWith('[');
            if(settingValueUsingVariable)
            {
                this.logger.logWarning(`Ignoring because you are using a variable to set object. See -> ${variable.groups.objectAccessors}${variable.groups.name}].`);
                continue;
            }

            if(assignmentValue?.includes(`this.${variable.groups.name}.bind(this)`))
            {
                console.log(`ignoring this.${variable.groups.name}.bind(this);`);
                continue;
            }

            const comment = await this.parseComment(variable.groups.comment, options, false);

            if(options.type)
            {
                options.type = this.fixType(options.type);
            }

            const type = options.type || await this.parseValue(assignmentValue, valueScope) || await this.parseArray(variable.groups.array, valueScope);


            // Must be a es6 function.
            if(typeof type === 'undefined')
            {
                VscodeError.create(`LGD: Could not parse ${variable.groups.name} in create function. No functions declarations in create()`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
                    .notifyUser(this);
                continue;
            }

            this.addVariable(variable.groups.name);

            const definedOnState = (/state(?:\.|\[)/).test(variable.groups.objectAccessors);
            if(definedOnState)
            {
                if(!this.stateInterface)
                {
                    this.stateInterface = `\ndeclare interface ${this.className}State {`;
                }

                this.stateInterface += `\n\t${comment}${variable.groups.name}: ${type};\n`;
                continue;
            }

            if(variable.groups.name === 'state' && lgd.configuration.extractPropsAndState)
            {
                const stateType = type.replace(new RegExp(`^\\t`, 'gm'), '');
                this.stateInterface = `\n${comment}declare interface ${this.className}State ${stateType};\n`;
                continue;
            }

            const defaultVariable = {
                comment: '',
                conditional: false,
                count: 0,
                types: []
            };
            const parsedVariable = parsedVariables.get(variable.groups.name) || defaultVariable;

            if(!parsedVariable.comment && comment)
            {
                parsedVariable.comment = comment;
            }

            parsedVariable.conditional = parsedVariable.conditional || variable.groups.tabs.length > this.tabSize;
            parsedVariable.count++;
            parsedVariable.types.push(type);
            parsedVariables.set(variable.groups.name, parsedVariable);
        }

        let variables = '';
        for(const [ name, parsedVariable ] of parsedVariables.entries())
        {
            const uniqueTypes = [];

            for(const parsedType of parsedVariable.types)
            {
                const fixedType = this.fixType(parsedType);
                if(fixedType === Types.ANY)
                {
                    continue;
                }

                if(!uniqueTypes.includes(fixedType))
                {
                    uniqueTypes.push(fixedType);
                }
            }

            if(uniqueTypes.length === 0)
            {
                uniqueTypes.push(Types.ANY);
            }

            let parsedType = uniqueTypes.join('|');

            if(parsedVariable.conditional && parsedVariable.count === 1 && !parsedType.includes('undefined'))
            {
                parsedType += '|undefined';
            }

            variables += `\n\t`;
            variables += parsedVariable.comment || '';
            variables += `${name}: ${parsedType};`;
            variables += `\n`;
        }

        if(this.stateInterface?.endsWith('};\n') === false)
        {
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
    async parseObject(object, parsingOptions = { preferComments: false, ignoreDuplicate: false })
    {
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
        const arrayRegex = `\\[(?<array>.*?)\\]\\s*${valueEnd}`;
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

        while((properties = propertiesRegex.exec(object)) !== null)
        {
            let keywords = '';
            const options = {
                type: undefined,
                isFunction: false,
                params: {}
            };

            if(properties.groups.invalid)
            {
                this.updatePosition(object, properties, 'name', lastBeginLine);
                KeywordOrderCheck.execute.bind(this)(properties[0]);
            }

            const isAsync = typeof properties.groups.keyword === 'string' && properties.groups.keyword.includes('async');
            const isGetter = typeof properties.groups.getter === 'string' && properties.groups.getter.includes('get');
            const isSetter = typeof properties.groups.setter === 'string' && properties.groups.setter.includes('set');

            if(isSetter || isGetter)
            {
                // Accessors currently remain instance members even when their bodies do not use this.
                const varExisted = !this.addVariable(properties.groups.name, false);
                if(varExisted && isSetter)
                {
                    property = property.replace(`readonly ${properties.groups.name}`, properties.groups.name);
                    continue;
                }
                else if(varExisted)
                {
                    continue;
                }
            }

            const parsedComment = await this.parseComment(properties.groups.comment, options, isAsync);
            if(properties.groups.name === ConstructorMethodName)
            {
                this.updatePosition(object, properties, 'function', lastBeginLine);
                property += await this.parseCreate(properties.groups.function, properties.groups.params, options.params);
            }

            const tabSize = this.tabSize > this.defaultTabSize ? this.tabSize - this.defaultTabSize : this.tabSize;

            // eslint-disable-next-line newline-per-chained-call
            property += `\n${new Array(tabSize / this.defaultTabSize).fill('\t').join('')}`;
            property += parsedComment;
            let functionParameters = '';
            if(properties.groups.params)
            {
                // Already updated.
                if(properties.groups.name !== ConstructorMethodName)
                {
                    this.updatePosition(object, properties, 'function', lastBeginLine);
                }

                if(isGetter)
                {
                    keywords = 'readonly ';
                }
                else if(!isSetter)
                {
                    functionParameters = await this.functionParser.parseFunctionParams(properties.groups.params, options.params);
                }

                // Check for errors in Function.
                this.functionParser.checkFunction(properties.groups.function, this);
            }
            else
            {
                keywords = 'static ';
            }

            if(!options.type)
            {
                options.type = 'any';

                // Setter has no return.
                if(properties.groups.function && !isSetter)
                {
                    options.type = await this.functionParser.parseFunctionReturn(properties.groups.function);
                }

                if(isGetter && options.type === 'void')
                {
                    // Getter needs to have a return.
                    options.type = 'null';
                }
            }
            else
            {
                options.type = this.fixType(options.type);
            }

            options.type = isAsync && !options.type.includes('Promise') ? `Promise<${options.type}>` : options.type;

            let type = null;

            if(parsingOptions.preferComments)
            {
                type = options.type || await this.parseValue(properties.groups.value) || await this.parseArray(properties.groups.array);
            }
            else
            {
                type = await this.parseValue(properties.groups.value) || await this.parseArray(properties.groups.array) || options.type;
            }

            if(this.staticVariables.includes(properties.groups.name))
            {
                VscodeError.create(`LGD: Already defined ${properties.groups.name} as static variable or function.`, this.beginLine, this.beginCharacter, this.endLine, this.endCharacter, ErrorTypes.ERROR)
                    .notifyUser(this);
            }

            // Use comment type if not parsed type.
            if(type === 'any' || !type)
            {
                type = options.type;
            }

            if(!properties.groups.function && !parsingOptions.ignoreDuplicate)
            {
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
    updatePositionToString(content, string, lastBegin = 0)
    {
        ParserPosition.updatePositionToString.call(this, content, string, lastBegin);
    },

    /**
     * @description Update our position in the document to be able to log to the user where an error occurs.
     * @param {string} str the string that was parsed. The string we are exec on.
     * @param {RegExpExecArray} regExpExecArray the object that was produced from exec.
     * @param {string} group the group that we are updating to.
     * @param {number} lastBegin The last begin line we were parsing.
     */
    updatePosition(str, regExpExecArray, group, lastBegin = 0)
    {
        ParserPosition.updatePosition.call(this, str, regExpExecArray, group, lastBegin);
    },

    /**
     * @description Get the class type with template args. Given Tester with template arg Props return TesterType<Props>.
     * @param {string} content the content of the file.
     * @returns {string} the class type.
     */
    parseTypeWithTemplates(content)
    {
        const objectLiterals = /(?<comment>\/\*\*.*?\*\/.*?|)(?:export |)(?<var>const|let|var) (?<name>\w+?) = (?<react>(?:createReactClass\(|)){(?<object>.*?)^}/gms;
        let object;
        while((object = objectLiterals.exec(content)) !== null)
        {
            const docs = this.parseClassComment(object.groups.comment);

            if(docs.template.length === 0)
            {
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
    async parse(typeFile, content)
    {
        this.content = content;
        const objectLiterals = /(?<comment>\/\*\*.*?\*\/.*?|)(?:export |)(?<var>const|let|var) (?<name>\w+?) = (?<react>(?:createReactClass\(|)){(?<object>.*?)^}/gms;

        let object;
        while((object = objectLiterals.exec(content)) !== null)
        {
            this.variables = {};
            this.staticVariables = [];
            this.updatePosition(content, object, 'object');

            this.className = object.groups.name;

            const isReactRegex = new RegExp(`createReact(Component|Pure)\\(${this.className}`, '');
            this.isReactComponent = isReactRegex.test(content);

            if(this.enumParser.isEnum(object.groups.comment))
            {
                typeFile += this.enumParser.parse(content, object);
                continue;
            }

            await this.parseProps(this.className, content);

            if(object.groups.react !== '')
            {
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
