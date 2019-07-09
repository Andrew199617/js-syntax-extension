const  vscode = require('vscode');

/**
 * @description get the configuration for vscode.
 */
const Configuration = {
  /**
   * @description the options for our extenstion.
   * @type {lgd.Options}
   */
  options: null,

  create() {
    const configuration = Object.assign({}, Configuration);
    configuration.options = vscode.workspace.getConfiguration("lgd").get("options");
    configuration.options.tabSize = vscode.workspace.getConfiguration("editor").get("tabSize");
    return configuration; 
  }
}

module.exports = Configuration;