
const StatusBarMessage = require("./Logging/StatusBarMessage");
const JsCompiler = require('./JsCompiler');
const StatusBarMessageTypes = require('./Logging/StatusBarMessageTypes');
const vscode = require('vscode');

const SeverityConverter = require('./ServerityConverter');

/**
 *
 */
const GenerateTypings = {
  create(document, lgdDiagnosticCollection) {
    const generateTypings = Object.assign({}, GenerateTypings);

    /**
     * @description The document that was saved.
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

    const compilingMessage = StatusBarMessage.show("$(zap) Compiling .js --> .d.ts", StatusBarMessageTypes.INDEFINITE);
    const startTime = Date.now();
    try
    {
      await JsCompiler.compile(this.document.fileName, this.document.getText());
      const elapsedTime = (Date.now() - startTime);
      compilingMessage.dispose();
      this.lgdDiagnosticCollection.set(this.document.uri, []);

      StatusBarMessage.show(`$(check) LGD compiled in ${elapsedTime}ms`, StatusBarMessageTypes.SUCCESS);
    }
    catch (error)
    {
      let startLine = error.startLine || 0;
      let startCharacter = error.startCharacter || 0;
      let endLine = error.endLine || 0;
      let endCharacter = error.endCharacter || 0;

      let message = error.message;
      let range = new vscode.Range(startLine, startCharacter, endLine, endCharacter);
      let severity = error.severity;

      if (error.code)
      {
          // fs errors
          const fileSystemError = error;
          switch (fileSystemError.code)
          {
              case 'EACCES':
              case 'ENOENT':
                  message = `Cannot open file '${fileSystemError.path}'`;
                  const firstLine = this.document.lineAt(0);
                  range = new vscode.Range(0, 0, 0, firstLine.range.end.character);
          }
      }

      compilingMessage.dispose();
      const diagnosis = new vscode.Diagnostic(range, message, SeverityConverter.getDiagnosticSeverity(severity));
      this.lgdDiagnosticCollection.set(this.document.uri, [diagnosis]);

      StatusBarMessage.show(SeverityConverter.getStatusBarMessage(severity), SeverityConverter.getMessageType(severity));
    }
  }
}

module.exports = GenerateTypings;