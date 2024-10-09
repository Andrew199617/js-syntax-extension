const QuickFixAction = require('./QuickFixAction');
const vscode = require('vscode');
const { Oloo } = require('@mavega/oloo');

/**
* @description
* @type {MoveCreateReactClassType & QuickFixActionType}
*/
const MoveCreateReactClass = {
  /**
  * @description Initialize an instance of MoveCreateReactClass.
  * @returns {MoveCreateReactClassType & QuickFixActionType}
  */
  create(title) {
    const moveCreateReactClass = Oloo.assign(QuickFixAction.create(title), MoveCreateReactClass);
    return moveCreateReactClass;
  },

  setupFix() {
    const text = this.document.getText();
    const exportReg = /^(?<exportType>(export default)|module.exports =) (?<class>\w+)/gm;
    const closeTag = /^}\)(;|)$/gm;
    const exportResults = exportReg.exec(text);
    const closeResults = closeTag.exec(text);
    if(exportResults === null || closeResults === null) {
      return false;
    }
    const closePosition = this.document.positionAt(closeResults.index);
		this.edit.replace(
      this.document.uri,
      new vscode.Range(new vscode.Position(closePosition.line, 1), new vscode.Position(closePosition.line, 2)),
      '');

    const position = this.document.positionAt(exportResults.index);
		this.edit.replace(
      this.document.uri,
      new vscode.Range(new vscode.Position(position.line, 0), new vscode.Position(position.line, Number.MAX_VALUE)),
      `${exportResults.groups.exportType} createReactClass(${exportResults.groups.class});`);

    this.edit.replace(this.document.uri, new vscode.Range(this.range.start, this.range.end.translate(0, 1)), '');
    this.isPreferred = true;

    return true;
  },

  executeCommand() {
    Oloo.base(this, this.executeCommand);
  }
};

module.exports = MoveCreateReactClass;