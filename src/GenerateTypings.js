const CompilationReport = require('./Logging/CompilationReport');

const path = require('path');
const FileParser = require('./Parsers/FileParser');
const FunctionComponentParser = require('./Parsers/FunctionComponentParser');
const ClassParser = require('./Parsers/ClassParser');
const FileIO = require('./Logging/FileIO');
const Logger = require('./Logging/Logger');

const vscode = require('vscode');

const ErrorTypes = require('./Errors/ErrorTypes');

const SeverityConverter = require('./Core/ServerityConverter');

// Extension used for generated TypeScript declaration files.
const DEFAULT_EXT = '.d.ts';

// Workspace directory for generated typings and logs.
const DEFAULT_DIR = 'typings';

// JavaScript source extension supported by the commands.
const JS_EXT = '.js';

/**
 * @description Generate .d.ts files for a .js file.
 * @type {GenerateTypingsType}
 */
const GenerateTypings = {
    /**
     * @description Initialize an Instance of GenerateTypings
     * @param {DocumentType} document
     * @param {vscode.DiagnosticCollection} lgdDiagnosticCollection
     * @returns {GenerateTypingsType}
     */
    create(document, lgdDiagnosticCollection)
    {
        const generateTypings = Object.assign({}, GenerateTypings);

        /**
         * @description The document that was saved.
         * @type {vscode.TextDocument}
         */
        generateTypings.document = document;

        /**
         * @description diagnostics
         * @type {vscode.DiagnosticCollection}
         */
        generateTypings.lgdDiagnosticCollection = lgdDiagnosticCollection;
        const logger = Logger.create(lgd.logger._fileName);
        generateTypings.compilationContext = {
            document: document,
            source: null,
            diagnostics: [],
            diagnosticCollection: lgdDiagnosticCollection,
            logger: logger,
            errorOccurred: false,
            compiled: false
        };
        logger.compilationContext = generateTypings.compilationContext;
        logger.openedNewDocument(document);

        return generateTypings;
    },

    /** @description Compiles a JavaScript document and displays its compilation report. */
    async executeGenerateTypings()
    {
        if(this.document.fileName.endsWith(JS_EXT))
        {
            const report = CompilationReport.create('Compile file');
            await this.execute();
            report.add(this.compilationContext);
            await report.finish();
        }
    },

    /** @description Compiles the current document and records its result or error. */
    async execute()
    {
        try
        {
            const compiled = await this.compile(this.document.fileName, this.document.getText());
            this.compilationContext.compiled = compiled;
        }
        catch(error)
        {
            this.recordError(error);
        }

        this.lgdDiagnosticCollection.set(this.document.uri, this.compilationContext.diagnostics);
        return this.compilationContext;
    },

    /** @description Record parser or filesystem failures against this source document. */
    recordError(error)
    {
        const range = new vscode.Range(error.startLine || 0, error.startCharacter || 0, error.endLine || 0, error.endCharacter || 0);
        const severity = SeverityConverter.getDiagnosticSeverity(error.severity ?? ErrorTypes.ERROR);
        const diagnosis = new vscode.Diagnostic(range, error.message || String(error), severity);
        diagnosis.source = 'LGD';
        this.compilationContext.diagnostics.push(diagnosis);
        this.compilationContext.errorOccurred = true;
        this.lgdDiagnosticCollection.set(this.document.uri, this.compilationContext.diagnostics);
    },

    /**
     * @description Parse Class, Objects, Enums from a JsFile into a TSFile.
     * @param {string} content the content of the file.
     * @returns {string | null} The generate type file.
     */
    async parseFile(content)
    {
        this.compilationContext.source = content;
        const fileParser = FileParser.create(this.compilationContext);
        const classParser = ClassParser.create(this.compilationContext);
        const functionComponentParser = FunctionComponentParser.create(this.compilationContext);

        let parseResult = await classParser.parse(content, '');
        parseResult = await functionComponentParser.parse(parseResult.content, parseResult.typeFile);
        const typeFile = await fileParser.parse(parseResult.typeFile, parseResult.content);

        if(this.compilationContext.errorOccurred || fileParser.errorOccurred || classParser.errorOccurred || !typeFile)
        {
            return false;
        }

        return typeFile;
    },

    /**
     * @description Compile a jsFile into a typeFile.
     * @param {string} jsFile the js file path.
     * @param {string} content the contents of the js file.
     * @returns {boolean} did error occur parsing file.
     */
    async compile(jsFile, content)
    {
        const typeFile = await this.parseFile(content);
        if(!typeFile)
        {
            return false;
        }

        const parsedPath = path.parse(jsFile);

        let dirInRoot = '';
        if(lgd.configuration.maintainHierarchy)
        {
            dirInRoot = path.relative(vscode.workspace.rootPath, parsedPath.dir);
        }

        const baseFilename = parsedPath.name;
        const typeFilePath = path.join(vscode.workspace.rootPath, DEFAULT_DIR, dirInRoot, `${baseFilename}${DEFAULT_EXT}`);

        await FileIO.writeFileContents(typeFilePath, typeFile);

        return true;
    }
};

module.exports = GenerateTypings;
