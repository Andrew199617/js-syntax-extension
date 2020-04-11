const BaseCompletionItem = require('./BaseCompletionItem');
const { Oloo } = require('@learngamedevelopment/oloo');
const FunctionParser = require('../Parsers/FunctionParser');
const vscode = require('vscode');

/**
* @description Document Javascript code.
* @type {DocumentCodeType}
* @extends {BaseCompletionItemType}
*/
const DocumentCode = {
  /**
  * @description Initialize an instance of DocumentCode.
  * @returns {DocumentCodeType}
  */
  create() {
    const base = BaseCompletionItem.create('/* JsDoc @description */', 'Create Documentation.');
    const documentCode = Oloo.assign(base, DocumentCode);

    /** @type {vscode.OutputChannel} */
    documentCode._outputChannel = vscode.OutputChannel;

    /** @type {FunctionParserType} */
    documentCode._functionParser = FunctionParser.create();

    documentCode.line = 0;

    documentCode.documentation = '/** \n * @description \n ... \n */ \n';

    return documentCode;
  },

  get insertText() {
    return this.insertDocumentation();
  },

  getCompletionItem(document, position) {
    this.document = document;
    this.line = position.line;
    this.sortText = "\0";

    const line = document.lineAt(position.line).text;
    const prefix = line.slice(0, position.character).match(/\/\**\s*$/);
    const suffix = line.slice(position.character).match(/^\s*\**\//);
    const start = position.translate(0, prefix ? -prefix[0].length : 0);

    this.range = new vscode.Range(
        start,
        position.translate(0, suffix ? suffix[0].length : 0));
    return this;
  },

  insertDocumentation() {
    const snippetString = new vscode.SnippetString();

    const textArray = this.document.getText().split('\n');
    const text = textArray.slice(this.line + 1, textArray.length).join('\n');

    snippetString.appendText('/**\n');
    snippetString.appendText('* @description');
    snippetString.appendText('\n*/');
    return snippetString;
  }
};

module.exports = DocumentCode;