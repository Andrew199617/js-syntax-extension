const vscode = require('vscode');
const DEFAULT_DIR = "typings";
const FileIO = require('./FileIO');

/**
* @description
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
     * @description
     */
    logger._fileName = filename;

    return logger;
  },

  /**
   * @description Convert the log to a string to be written to a file.
   */
  toString() {
    let str = '';

    for(let i = 0; i < this.log.length; ++i) {
      str += this.log[i] + '\n';
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

    const logFile = this.toString();
    const filePath = `${this.logFolder()}\\${this._fileName}.log`;
    await FileIO.writeFileContents(filePath, logFile);
  },

  /**
   * @description where we save the logger.
   */
  logFolder() {
    return `${vscode.workspace.rootPath}\\${DEFAULT_DIR}`;
  }

};

module.exports = Logger;