const vscode = require('vscode');

/**
* @description The options the user can provide for this extension.
* @type {OptionsType}
*/
const Options = {
  generateTypings: null,
  generateTypingsOnChange: null,
  maintainHierarchy: null,
  createDebugLog: null,
  tabSize: null,
  extractPropsAndState: null
};

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
     * @description the options for our extension.
     * @type {OptionsType}
     */
    configuration.options = vscode.workspace.getConfiguration('lgd', null).get('options');

    if(typeof configuration.options.maintainHierarchy === 'undefined') {
      configuration.options.maintainHierarchy = true;
    }

    if(typeof configuration.options.createDebugLog === 'undefined') {
      configuration.options.createDebugLog = true;
    }

    if(typeof configuration.options.extractPropsAndState === 'undefined') {
      configuration.options.extractPropsAndState = true;
    }

    configuration.options.tabSize = vscode.workspace.getConfiguration('editor', null).get('tabSize');

    return configuration;
  }
};

module.exports = Configuration;