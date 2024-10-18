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
  extractPropsAndState: null,
  autoComplete: {
    enabled: null
  }
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
    const configuration = Object.create(Configuration);

    /**
     * @description the options for our extension.
     * @type {OptionsType}
     */
    configuration.options = vscode.workspace.getConfiguration('lgd', null).get('options') || {};

    if(typeof configuration.options.maintainHierarchy === 'undefined') {
      configuration.options.maintainHierarchy = true;
    }

    if(typeof configuration.options.createDebugLog === 'undefined') {
      configuration.options.createDebugLog = true;
    }

    if(typeof configuration.options.extractPropsAndState === 'undefined') {
      configuration.options.extractPropsAndState = true;
    }

    if(typeof configuration.options.autoComplete === 'undefined') {
      configuration.options.autoComplete = {
        enabled: true
      };
    }

    configuration.options.tabSize = vscode.workspace.getConfiguration('editor', null).get('tabSize');

    return configuration;
  },

  get tabSize() {
    return this.options.tabSize || vscode.workspace.getConfiguration('editor', null).get('tabSize');
  },

  get autoComplete() {
    return this.options.autoComplete || {
      enabled: true
    };
  },

  get maintainHierarchy() {
    return this.options.maintainHierarchy || true;
  },

  get createDebugLog() {
    return this.options.createDebugLog || true;
  },

  get extractPropsAndState() {
    return this.options.extractPropsAndState || true;
  },

  get generateTypings() {
    return this.options.generateTypings || true;
  },

  get generateTypingsOnChange() {
    return this.options.generateTypingsOnChange || true;
  }
};

module.exports = Configuration;