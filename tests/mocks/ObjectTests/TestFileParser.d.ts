
/**
 * @description Parse a JS file and convert it to a TS file.
 * @type {TestFileParserType}
 */
declare interface TestFileParserType {
	/**
     * @description the variables that the class contains.
     * @type {{ [variableName: string]: boolean}}
     */
	variables: { [variableName: string]: boolean};

	/**
     * @description the static variables that the class contains.
     * @type {string[]}
     */
	staticVariables: string[];

	/**
     * @description The name of the class we parsed.
     * @type {string}
     */
	className: string;

	/**
     * @description The current begin line being parsed.
     */
	beginLine: number;

	/**
     * @description The character that is the beginning of the current parse. "This line is being parsed" <- T in "This" is the beginCharacter.
     */
	beginCharacter: number;

	/**
     * @description The current end line being parsed.
     */
	endLine: number;

	/**
     * @description The character that ends the parse. "This line is being parsed" <- d is the endCharacter.
     */
	endCharacter: number;

	/** @type {EnumParserType} */
	enumParser: EnumParserType;

	/** @type {FunctionParserType} */
	functionParser: FunctionParserType;

	/** @description Compilation was not a success don't reset problems. */
	errorOccurred: boolean;

	/** @type {number} */
	defaultTabSize: number;

	/** @type {number} */
	tabSize: number;

	/**
     * @description Interface for parsed props.
     * @type {string}
     */
	propsInterface: string;

	/**
     * @description Interface for parsed state.
     * @type {string}
     */
	stateInterface: string;

	/**
     * @description Whether the current object we are parsing is a React Object.
     */
	isReactComponent: boolean;

	/**
     * @description The content of the file.
     */
	content: any;

	/**
   * @returns {TestFileParserType}
   */
	create(): TestFileParserType;

	/**
  * @description Create an error / Problem for the user to fix.
  * Will prevent page from being compiled.
  * @param {string} message
  * @param {CodeActionsType} codeAction Provide a fix for the error.
  */
	createError(message: string, codeAction: CodeActionsType): void;

	/**
   * @description Parses any property values.
   * @param {string} valuesStr the value of the property.
   * @returns {any} the type.
   */
	parseArray(valuesStr: string): Promise<any>;

	/**
   * @description Parses any property values.
   * @param {string} value the value of the property.
   * @returns {string | null} the type.
   */
	parseValue(value: string): Promise<string | null>;

	/**
   * @description Parse the comment of the class to get Template and extends.
   * @param {string} comment The class comment.
   * @returns { { extends: string[], template: string[] } }
   */
	parseClassComment(comment: string):  { extends: string[], template: string[] } ;

	/**
   * @description Parse a comment.
   * @param {string} comment The comment to parse.
   * @param {Object} options
   * @returns {string} The parsed comment.
   */
	parseComment(comment: string, options: Object): Promise<string>;

	/**
   * @description given a type add templates if any. ex: MyClassType -> MyClassType<T>
   * @param {string} type ex: MyClassType
   * @returns {string} the type with templates if any.
   */
	getTypeWithTemplates(type: string): Promise<string>;

	/**
   * @description Change any obvious types to typescript types.
   * bool -> boolean
   * @param {string} type
   * @returns {string}
   */
	fixType(type: string): string;

	/**
   * @description returns the class name.
   * @param {string} insideFunction
   * @returns {string}
   */
	getClassInCreate(insideFunction: string): string;

	/**
   * @description notify the user if they use Create incorrectly.
   * @param {string} insideFunction the inside of the create() funciton.
   */
	checkForThisInCreate(insideFunction: string): void;

	/**
   * @description Add variable to local variables of class.
   * Do checks before adding.
   * @param {string} variableName
   * @param {boolean} strict whether another variable of same name can exist.
   */
	addVariable(variableName: string, strict: boolean): boolean;

	/**
   * @description print the text for extends.
   * @param {string[]} extendsDoc The array of extends found in jsx comment.
   * @param {string} content the context for finding where errors occurred in the file.
   * @returns {string}
   */
	printExtends(extendsDoc: string[], content: string): string;

	/**
  * @description Parse the props of a file.
  */
	parseProps(objectName: any, content: any): Promise<null>;

	/**
   * @description parse the create function for variables.
   * These variables are treated like normal variables
   * variables on the object literal are treated like static.
   * @param {string} insideFunction
   * @returns {string}
   */
	parseCreate(insideFunction: string): Promise<string>;

	/**
   * Parse an object literal into properties for a ts file.
   * @param {string} object
   * @param {{ preferComments: boolean, ignoreDuplicate: boolean }} parsingOptions
   * @returns {string} parsed object.
   */
	parseObject(object: string, parsingOptions: { preferComments: boolean, ignoreDuplicate: boolean }): Promise<string>;

	/**
   * Update Position to a specific string.
   * @param {string} str the string that was parsed. The string we are exec on.
   * @param {string} string the string to update to.
   * @param {number} lastBegin The last begin line we were parsing.
   */
	updatePositionToString(content: any, string: string, lastBegin: number): null;

	/**
   * @description Update our position in the document to be able to log to the user where an error occurs.
   * @param {string} str the string that was parsed. The string we are exec on.
   * @param {RegExpExecArray} regExpExecArray the object that was produced from exec.
   * @param {string} group the group that we are updating to.
   * @param {number} lastBegin The last begin line we were parsing.
   */
	updatePosition(str: string, regExpExecArray: RegExpExecArray, group: string, lastBegin: number): null;

	/**
  * @description Get the class type with template args. Given Tester with template arg Props return TesterType<Props>.
  * @param {string} content the content of the file.
  * @returns {string} the class type.
  */
	parseTypeWithTemplates(content: string): string;

	/**
   * @description Parse a js file into a ts file.
   * @param {string} typeFile the type file to append.
   * @param {string} content contains js file.
   * @returns {string} the the type file to write to disk.
   */
	parse(typeFile: string, content: string): Promise<string>;
}
