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
     * @type {vscode.Options}
     */
    configuration.options = vscode.workspace.getConfiguration('lgd', null).get('options');

    if(typeof configuration.options.maintainHierarchy === 'undefined') {
      configuration.options.maintainHierarchy = true;
    }

    if(typeof configuration.options.createDebugLog === 'undefined') {
      configuration.options.createDebugLog = true;
    }

    configuration.options.tabSize = vscode.workspace.getConfiguration('editor', null).get('tabSize');

    return configuration;
  }
};

module.exports = Configuration;