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

    configuration.tabSize = configuration.getTabSize();

    return configuration;
  },

  /**
 * @description Get the tab size of the currently opened file in VS Code.
 * @returns {number} The tab size.
 */
  getTabSize() {
    // Use the tabSize from options if available
    if(this.options.tabSize) {
      return this.options.tabSize;
    }

    // Get the active text editor
    const editor = vscode.window.activeTextEditor;

    if(editor) {
      // Retrieve tabSize from the active editor's options
      const editorTabSize = editor.options.tabSize;
      if(editorTabSize) {
        return editorTabSize;
      }

      // Alternatively, get language-specific tabSize settings
      const languageTabSize = vscode.workspace.getConfiguration('editor', editor.document.uri).get('tabSize');
      if(languageTabSize) {
        return languageTabSize;
      }
    }

    // Fallback to the general editor tabSize configuration
    return vscode.workspace.getConfiguration('editor').get('tabSize') || 2; // Default to 2 if not set
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