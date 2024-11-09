const vscode = require('vscode');
const StatusBarMessage = require('../Logging/StatusBarMessage');
const StatusBarMessageTypes = require('../Logging/StatusBarMessageTypes');

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

    let indent = lgd.configuration.tabSize;
    const functionName = 'extractedFunction';

    // Create the new function
    indent = ' '.repeat(lgd.configuration.tabSize);
    const selectedTextArray = selectedText.split('\n');
    selectedTextArray[0] = indent + indent + selectedTextArray[0].trim();
    const functionString = this.needsFunctionString ? 'function ' : '';
    const functionEnding = this.needsFunctionString ? '' : ',';
    const newFunction = `\n${indent}${functionString}${functionName}() {\n${selectedTextArray.join('\n')}\n${indent}}${functionEnding}\n`;

    editor.edit(editBuilder => {
      editBuilder.insert(insertPosition, newFunction);
      editBuilder.replace(selection, `${functionName}();`);
    });

    this.isPreferred = true;
    return true;
  },

  /**
  * @description Parses all the variables in the selected text to be used as function parameters
  * for a new function.
  * If there are no variables, it returns an empty string.
  * Checks the rest of the document to see if there are any variables not defined in the selected text.
  * If there are variables that are used but not defined in the selected text, it returns those variables.
  * @param {string[]} selectedTextArray
  */
  parseFunctionParams(selectedTextArray) {
    const variables = [];
    const variableRegex = /(?:let|const|var)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=\s*(.*);/;
    let match;
    for(let i = 0; i < selectedTextArray.length; i++) {
      match = variableRegex.exec(selectedTextArray[i]);
      if(match) {
        variables.push(match[1]);
      }
    }

    return variables.join(', ');
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
      this._findInsertPosition(line, document);
      line--;
    }

    line = selection.end.line;
    while(line < document.lineCount) {
      this._findInsertPosition(line, document);
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