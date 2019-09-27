const vscode = require('vscode');
const FileIO = require('./FileIO');

const VscodeError = require('../Errors/VscodeError');
const ErrorTypes = require('../Errors/ErrorTypes');

const DEFAULT_DIR = 'typings';

/**
* @description Log to a file on disc.
* @type {LoggerType}
*/
const Logger = {
  /**
  * @description Initialize an instace of Logger.
  * @returns {LoggerType}
  */
  create(filename) {
    const logger = Object.assign({}, Logger);

    /**
     * @description the log array that contains everything to write.
     */
    logger.log = [];

    /**
     * @description the name of the logger file.
     */
    logger._fileName = filename;

    /**
     * @description whether we have already logged heading for file we are currently parsing.
     */
    logger._loggedHeading = false;

    /** @type {DocumentType} */
    logger.document = null;

    return logger;
  },

  /**
   * @description Whenever we open a new docuemnt we need to specify in logger.
   * @param {DocumentType} document
   */
  opendedNewDocument(document) {
    this._loggedHeading = false;
    this.document = document;
  },

  logHeader() {
    if(!this._loggedHeading) {
      this.log.push(`\n${this.document.fileName}: \n`);
      this._loggedHeading = true;
    }
  },

  logInfo(info) {
    this.logHeader();
    this.log.push(`INFO: ${info}`);
  },

  logWarning(warning) {
    this.logHeader();
    this.log.push(`WARNING: ${warning}`);
  },

  logError(error) {
    this.logHeader();
    this.log.push(`ERROR: ${error}`);
  },

  /**
   * @description Convert the log to a string to be written to a file.
   */
  _toString() {
    let str = 'Stop logging by changing setting "lgd.options.createDebugLog"\nIf you have any problems or requests please create an issue on Github.\n';

    for(let i = 0; i < this.log.length; ++i) {
      str += `${this.log[i]}\n`;
    }

    return str;
  },

  /**
   * @description write the file to disk.
   */
  async write() {
    if(!lgd.configuration.options.createDebugLog) {
      return;
    }

    const logFile = this._toString();
    const filePath = `${this._logFolder()}\\${this._fileName}.log`;
    await FileIO.writeFileContents(filePath, logFile);
  },

  /**
   * @description notify user if log has any value to check.
   */
  notifyUser() {
    if(!lgd.configuration.options.createDebugLog) {
      return;
    }

    if(this.log.length > 0) {
      VscodeError.create('LGD: Check log!', 0, 0, 0, 0, ErrorTypes.HINT).notifyUser(null);
    }
  },

  /**
   * @description where we save the logger.
   */
  _logFolder() {
    return `${vscode.workspace.rootPath}\\${DEFAULT_DIR}`;
  }

};

module.exports = Logger;