const StatusBarMessage = require('./Logging/StatusBarMessage');
const JsCompiler = require('./JsCompiler');
const StatusBarMessageTypes = require('./Logging/StatusBarMessageTypes');
const vscode = require('vscode');

const ErrorTypes = require('./Errors/ErrorTypes');
const VscodeError = require('./Errors/VscodeError');

const SeverityConverter = require('./Core/ServerityConverter');

/**
 * @type {GenerateTypingsType}
 */
const GenerateTypings = {
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

      const compiled = await JsCompiler.compile(this.document.fileName, this.document.getText());

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
  }
};

module.exports = GenerateTypings;