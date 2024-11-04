const vscode = require('vscode');
const { Oloo } = require('@mavega/oloo');
const StatusBarMessage = require('../Logging/StatusBarMessage');
const StatusBarMessageTypes = require('../Logging/StatusBarMessageTypes');

/**
 * @description Invert an if statement for early termination.
 * @type {InvertIfType}
 */
const InvertIf = {
  /**
   * @description Initialize an instance of InvertIf.
   * @returns {InvertIfType}
   */
  create() {
    const invertIf = Object.create(InvertIf);
    return invertIf;
  },

  /**
   * @description Sets up a fix by inverting an if statement in the currently active text editor.
   * @returns {boolean} - Returns true if an if statement was found and inverted, otherwise false.
   */
  executeCommand() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return false;
    }

    const document = editor.document;
    const selection = editor.selection;
    const lineText = document.lineAt(selection.start.line).text;

    // Find the if statement on the current line
    const ifRegex = /if\s*\(((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*)\)\s*{/;
    const match = ifRegex.exec(lineText);

    if (match) {
      const condition = match[1].trim();
      let body = '';
      let openBraces = 1;
      let line = selection.start.line + 1;

      // Collect the body of the if statement
      while (openBraces > 0 && line < document.lineCount) {
        const currentLineText = document.lineAt(line).text;

        // Count the braces to find the end of the if statement
        for (const char of currentLineText) {
          if (char === '{') openBraces++;
          if (char === '}') openBraces--;
        }

        if (openBraces > 0) {
          body += currentLineText + '\n';
        } else {
          body += currentLineText.substring(0, currentLineText.indexOf('}')) + '\n';
        }

        line++;
      }

      // Invert the condition
      let invertedCondition = `!(${condition})`;

      // if condition is already inverted remove the !() from condition
      if (condition.startsWith('!')) {
        // remove the characters '!' and '('
        invertedCondition = condition.substring(2);
        // remove the last character which is ')'
        invertedCondition = invertedCondition.trim().substring(0, invertedCondition.length - 1);
      }

      // Create the new if statement
      let newIfStatement = `if (${invertedCondition}) {\n  return;\n}`;
      // modify newIfStatement to keep old indentation
      const indent = lineText.substring(0, lineText.indexOf('if'));
      const lines = newIfStatement.split('\n');
      const indentedLines = lines.map((line) => indent + line);
      newIfStatement = indentedLines.join('\n');
      const backTabbedBody = body.split('\n').map((line) => {
        if(line.startsWith('  ')) {
          return line.substring(2);
        }
      }).join('\n');
      newIfStatement += "\n" + backTabbedBody;

      const startPosition = new vscode.Position(selection.start.line, 0);
      const endPosition = new vscode.Position(line, 0);
      editor.edit(editBuilder => {
        editBuilder.replace(new vscode.Range(startPosition, endPosition), newIfStatement);
      });
      this.isPreferred = true;

      return true;
    }

    return false;
  },

  register(context) {
    const command = vscode.commands.registerCommand('lgd.invertIf', async (document, range) => {
      const success = await this.executeCommand();

      if (!success) {
        StatusBarMessage.show('No valid if statement found to invert.', StatusBarMessageTypes.WARNING);
      }
    });

    context.subscriptions.push(command);
  }
};

module.exports = InvertIf;