const vscode = require('vscode');
const StatusBarMessage = require('../Logging/StatusBarMessage');
const StatusBarMessageTypes = require('../Logging/StatusBarMessageTypes');
const ParseFunctionParams = require('../Parsers/TypeChecking/ParseFunctionParams');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

/**
 * @description Extract a function from selected code.
 * @type {ExtractFunctionType}
 */
const ExtractFunction = {
  /**
   * @description Initialize an instance of ExtractFunction.
   * @returns {ExtractFunctionType}
   */
  create() {
    const extractFunction = Object.create(ExtractFunction);
    extractFunction.needsFunctionString = true;
    return extractFunction;
  },

  /**
   * @description Sets up a fix by extracting a function from the selected code in the currently active text editor.
   * @returns {boolean} - Returns true if code was found and extracted, otherwise false.
   */
  executeCommand() {
    const editor = vscode.window.activeTextEditor;
    if(!editor) {
      return false;
    }

    const document = editor.document;
    const selection = editor.selection;
    const selectedText = document.getText(selection);

    if(!selectedText) {
      return false;
    }

    const insertPosition = this.findInsertPosition(document, selection);
    if(!insertPosition) {
      return false;
    }

    const isInsideClass = this.checkIfInsideClass(document, selection);
    this.needsFunctionString = this.needsFunctionString && !isInsideClass;

    let indent = lgd.configuration.tabSize;
    const functionName = 'extractedFunction';

    // Create the new function
    indent = ' '.repeat(lgd.configuration.tabSize);
    const selectedTextArray = selectedText.split('\n');
    selectedTextArray[0] = indent + indent + selectedTextArray[0].trim();
    const functionString = this.needsFunctionString ? 'function ' : '';
    const functionEnding = this.needsFunctionString || isInsideClass ? '' : ',';

    const importedVars = this.getImportedVariables(document);
    const functionParams = this.parseFunctionParams(selectedText, importedVars);

    const newFunction = `\n${indent}${functionString}${functionName}(${functionParams}) {\n${selectedTextArray.join('\n')}\n${indent}}${functionEnding}\n`;

    editor.edit(editBuilder => {
      editBuilder.insert(insertPosition, newFunction);
      editBuilder.replace(selection, `${functionName}(${functionParams});`);
    });

    this.isPreferred = true;
    return true;
  },

  checkIfInsideClass(document, selection) {
    let line = selection.start.line;
    while(line > 0) {
      const lineText = document.lineAt(line).text;
      if(lineText.includes('class')) {
        return true;
      }

      line--;
    }

    return false;
  },

  /**
   * @description Extracts imported variable names from the entire document.
   * @param {vscode.TextDocument} document
   * @returns {string[]} - An array of imported variable names.
   */
  getImportedVariables(document) {
    const code = document.getText();
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: [ 'jsx', 'typescript' ]
    });

    const importedVars = [];

    traverse(ast, {
      ImportDeclaration(path) {
        path.node.specifiers.forEach(specifier => {
          if(specifier.type === 'ImportSpecifier' || specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier') {
            importedVars.push(specifier.local.name);
          }
        });
      }
    });

    return importedVars;
  },

  /**
  * @description Parses all the variables in the selected text to be used as function parameters
  * for a new function.
  * If there are no variables, it returns an empty string.
  * Checks the rest of the document to see if there are any variables not defined in the selected text.
  * If there are variables that are used but not defined in the selected text, it returns those variables.
  * @param {string} selectedText
  * @param {string[]} additionalDeclaredVars
  */
  parseFunctionParams(selectedText, additionalDeclaredVars = []) {
    const undefinedVars = ParseFunctionParams.getUndefinedVariables(selectedText, additionalDeclaredVars);
    return undefinedVars.join(', ');
  },

  /**
   * @description Finds the appropriate position to insert the new function.
   * @param {vscode.TextDocument} document
   * @param {vscode.Selection} selection
   * @returns {vscode.Position}
   */
  findInsertPosition(document, selection) {
    let line = selection.start.line;
    while(line > 0) {
      const insertPosition = this._findInsertPosition(line, document);
      if(insertPosition) {
        return insertPosition;
      }

      line--;
    }

    line = selection.end.line;
    while(line < document.lineCount) {
      const insertPosition = this._findInsertPosition(line, document);
      if(insertPosition) {
        return insertPosition;
      }

      line++;
    }

    return null;
  },

  _findInsertPosition(line, document) {
    const lineText = document.lineAt(line).text;
    if(lineText.trim().endsWith('}') || lineText.trim().endsWith('};')) {
      return new vscode.Position(line + 1, 0);
    }
    else if(lineText.trim().endsWith('},')) {
      this.needsFunctionString = false;
      return new vscode.Position(line + 1, 0);
    }

    return null;
  },

  /**
   * @description Provides code actions for the given document and range.
   * @param {vscode.TextDocument} document
   * @param {vscode.Range} range
   * @returns {vscode.CodeAction}
   */
  shouldProvideRefactor(document, range) {
    if(range.isEmpty) {
      return false;
    }

    // range has multiple lines
    if(range.start.line === range.end.line) {
      return false;
    }

    return true;
  },

  createCodeAction(document, range) {
    const extractFunctionAction = new vscode.CodeAction(
      'Extract Function',
      vscode.CodeActionKind.Refactor
    );
    extractFunctionAction.command = {
      command: 'lgd.extractFunction',
      title: 'Extract Function',
      arguments: [ document, range ]
    };
    return extractFunctionAction;
  },

  register(context) {
    const command = vscode.commands.registerCommand('lgd.extractFunction', async () => {
      const success = await this.executeCommand();

      if(!success) {
        StatusBarMessage.show('No valid code found to extract.', StatusBarMessageTypes.WARNING);
      }
    });

    context.subscriptions.push(command);
  }
};

module.exports = ExtractFunction;