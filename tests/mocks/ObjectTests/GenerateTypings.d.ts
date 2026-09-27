
/**
 * @description Generate .d.ts files for a .js file.
 * @type {GenerateTypingsType}
 */
declare interface GenerateTypingsType {
	/**
     * @description The document that was saved.
     * @type {vscode.TextDocument}
     */
	document: vscode.TextDocument;

	/**
     * @description diagnostics
     * @type {vscode.DiagnosticCollection}
     */
	lgdDiagnosticCollection: vscode.DiagnosticCollection;

	compilationContext: {
		static document: DocumentType;

		static source: any;

		static diagnostics: any[];

		static diagnosticCollection: vscode.DiagnosticCollection;

		static logger: LoggerType;

		static errorOccurred: boolean;

		static compiled: boolean;
	};

	/**
   * @description Initialize an Instance of GenerateTypings
   * @param {DocumentType} document
   * @param {vscode.DiagnosticCollection} lgdDiagnosticCollection
   * @returns {GenerateTypingsType}
   */
	create(document: DocumentType, lgdDiagnosticCollection: vscode.DiagnosticCollection): GenerateTypingsType;

	executeGenerateTypings(): Promise<void>;

	execute(): Promise<any>;

	/** @description Record parser or filesystem failures against this source document. */
	recordError(error: any): void;

	/**
   * @description Parse Class, Objects, Enums from a JsFile into a TSFile.
   * @param {string} content the content of the file.
   * @returns {string | null} The generate type file.
   */
	parseFile(content: string): Promise<string | null>;

	/**
   * @description Compile a jsFile into a typeFile.
   * @param {string} jsFile the js file path.
   * @param {string} content the contents of the js file.
   * @returns {boolean} did error occur parsing file.
   */
	compile(jsFile: string, content: string): Promise<boolean>;
}
