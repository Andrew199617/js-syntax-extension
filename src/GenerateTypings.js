
const StatusBarMessage = require("./StatusBarMessage");
const JsCompiler = require('./JsCompiler');
const StatusBarMessageTypes = require('./StatusBarMessageTypes');
const vscode = require('vscode');

const ErrorTypes = require('./Errors/ErrorTypes');

/**
 * 
 */
const GenerateTypings = {
  /**
   * @description The document that was saved.
   */
  document: null,

  /**
   * @description diagnostics
   * @type {vscode.DiagnosticCollection}
   */
  lgdDiagnosticCollection: null,

  create(document, lgdDiagnosticCollection) {
    const generateTypings = Object.assign({}, GenerateTypings);
    generateTypings.document = document;
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
      else if (error.line !== undefined && error.column !== undefined)
      {
          // less errors, try to highlight the affected range
          const lineIndex = error.line - 1;
          const affectedLine = this.document.lineAt(lineIndex);
          range = new vscode.Range(lineIndex, error.column, lineIndex, affectedLine.range.end.character);
      }

      compilingMessage.dispose();
      const diagnosis = new vscode.Diagnostic(range, message, this.getDiagnosticSeverity(severity));
      this.lgdDiagnosticCollection.set(this.document.uri, [diagnosis]);

      StatusBarMessage.show(this.getStatusBarMessage(severity), this.getMessageType(severity));
    }
  },
  
  getDiagnosticSeverity(severity) {
    switch(severity) {
      case ErrorTypes.HINT:
        return vscode.DiagnosticSeverity.Information;

      case ErrorTypes.WARNING:
        return vscode.DiagnosticSeverity.Warning;

      case ErrorTypes.ERROR:
        return vscode.DiagnosticSeverity.Error;
    }
  },
  
  getMessageType(severity) {
    switch(severity) {
      case ErrorTypes.HINT:
        return StatusBarMessageTypes.HINT;

      case ErrorTypes.WARNING:
        return StatusBarMessageTypes.WARNING;

      case ErrorTypes.ERROR:
        return StatusBarMessageTypes.ERROR;
    }
  },

  getStatusBarMessage(severity) {
    switch(severity) {
      case ErrorTypes.HINT:
        return "$(alert) Hint can be found in Problems window ctrl+shift+M";

      case ErrorTypes.WARNING:
        return "$(alert) Warning occured compiling JS to TS (more detail in Problems window ctrl+shift+M)";

      case ErrorTypes.ERROR:
        return "$(alert) Error compiling JS to TS (more detail in Problems window ctrl+shift+M)";
    }
  }
}

module.exports = GenerateTypings;