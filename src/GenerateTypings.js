
const StatusBarMessage = require("./StatusBarMessage");
const JsCompiler = require('./JsCompiler');
const StatusBarMessageTypes = require('./StatusBarMessageTypes');
const  vscode = require('vscode');

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
        let message = error.message;
        let range = new vscode.Range(0, 0, 0, 0);

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
        const diagnosis = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
        this.lgdDiagnosticCollection.set(this.document.uri, [diagnosis]);

        StatusBarMessage.show("$(alert) Error compiling less (more detail in Errors and Warnings)", StatusBarMessageTypes.ERROR);
    }
  }
}

module.exports = GenerateTypings;