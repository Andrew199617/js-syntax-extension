const vscode = require('vscode');

/**
 * @description get the configuration for vscode.\
 * @type {ConfigurationType}
 */
const Configuration = {
  /**
   * @description
   * @returns {ConfigurationType}
   */
  create() {
    const configuration = Object.assign({}, Configuration);

    /**
     * @description the options for our extenstion.
     * @type {VSCODE.Options}
     */
    configuration.options = vscode.workspace.getConfiguration("lgd", null).get("options");

    configuration.options.tabSize = vscode.workspace.getConfiguration("editor", null).get("tabSize");
    
    return configuration; 
  }
}

module.exports = Configuration;