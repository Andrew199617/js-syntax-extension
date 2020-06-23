const StatusBarMessage = require('./Logging/StatusBarMessage');
const StatusBarMessageTypes = require('./Logging/StatusBarMessageTypes');

const path = require('path');
const FileParser = require('./Parsers/FileParser');
const ClassParser = require('./Parsers/ClassParser');
const FileIO = require('./Logging/FileIO');

const vscode = require('vscode');

const ErrorTypes = require('./Errors/ErrorTypes');
const VscodeError = require('./Errors/VscodeError');

const SeverityConverter = require('./Core/ServerityConverter');

const DEFAULT_EXT = '.d.ts';
const DEFAULT_DIR = 'typings';

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
  create(document, lgdDiagnosticCollection) {
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

    return generateTypings;
  },

  async execute() {
    const compilingMessage = StatusBarMessage.show('$(zap) Compiling .js --> .d.ts', StatusBarMessageTypes.INDEFINITE);
    const startTime = Date.now();

    try {
      // Reset diagnostics every time with parse a file.
      VscodeError.diagnostics = [];
      VscodeError.currentDocument = this.document;
      lgd.logger.openedNewDocument(this.document);

      const compiled = await this.compile(this.document.fileName, this.document.getText());

      if(compiled) {
        const elapsedTime = Date.now() - startTime;
        compilingMessage.dispose();
        this.lgdDiagnosticCollection.set(this.document.uri, []);

        StatusBarMessage.show(
          `$(check) LGD compiled in ${elapsedTime}ms`,
          StatusBarMessageTypes.SUCCESS
        );
      }
      else {
        compilingMessage.dispose();

        StatusBarMessage.show(
          SeverityConverter.getStatusBarMessage(ErrorTypes.ERROR),
          StatusBarMessageTypes.ERROR
        );

      }
    }
    catch(error) {
      const startLine = error.startLine || 0;
      const startCharacter = error.startCharacter || 0;
      const endLine = error.endLine || 0;
      const endCharacter = error.endCharacter || 0;

      let message = error.message;
      let range = new vscode.Range(startLine, startCharacter, endLine, endCharacter);
      const severity = error.severity;

      if(error.code) {
        // fs errors
        const fileSystemError = error;
        switch(fileSystemError.code) {
          case 'EACCES':
          case 'ENOENT':
          {
            message = `Cannot open file '${fileSystemError.path}'`;
            const firstLine = this.document.lineAt(0);
            range = new vscode.Range(0, 0, 0, firstLine.range.end.character);
          }
        }
      }

      compilingMessage.dispose();
      const diagnosis = new vscode.Diagnostic(range, message, SeverityConverter.getDiagnosticSeverity(severity));
      this.lgdDiagnosticCollection.set(this.document.uri, [diagnosis]);

      StatusBarMessage.show(
        SeverityConverter.getStatusBarMessage(severity),
        SeverityConverter.getMessageType(severity)
      );
    }
  },

  /**
   * @description Parse Class, Objects, Enums from a JsFile into a TSFile.
   * @param {string} content the content of the file.
   * @returns {string | null} The generate type file.
   */
  async parseFile(content) {
    const fileParser = FileParser.create();
    const classParser = ClassParser.create();

    let typeFile = '';
    try {
      const parseResult = classParser.parse(content, typeFile);
      typeFile = fileParser.parse(parseResult.typeFile, parseResult.content);
    }
    finally {
      await lgd.logger.write();
    }

    if(fileParser.errorOccurred || classParser.errorOccurred || !typeFile) {
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
  async compile(jsFile, content) {
    const typeFile = await this.parseFile(content);
    if(!typeFile) {
      return false;
    }

    const parsedPath = path.parse(jsFile);

    let dirInRoot = '';
    if(lgd.configuration.options.maintainHierarchy) {
      dirInRoot = parsedPath.dir.replace(vscode.workspace.rootPath, '');
    }

    const baseFilename = parsedPath.name;
    const typeFilePath = `${vscode.workspace.rootPath}\\${DEFAULT_DIR}${dirInRoot}\\${baseFilename}${DEFAULT_EXT}`;

    await FileIO.writeFileContents(typeFilePath, typeFile);

    return true;
  }
};

module.exports = GenerateTypings;