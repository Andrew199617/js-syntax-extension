const vscode = require('vscode');
const path = require('path');
const FileIO = require('./FileIO');

const VscodeError = require('../Errors/VscodeError');
const ErrorTypes = require('../Errors/ErrorTypes');

// Workspace directory for generated typings and logs.
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
    create(filename)
    {
        const logger = Object.assign({}, Logger);

        /** @description the log array that contains everything to write. */
        logger.log = [];

        /** @description the name of the logger file. */
        logger._fileName = filename;

        /** @description whether we have already logged heading for file we are currently parsing. */
        logger._loggedHeading = false;

        /** @type {DocumentType} */
        logger.document = null;
        logger.compilationContext = null;
        logger.writeCompleted = Promise.resolve();

        return logger;
    },

    /**
     * @description Whenever we open a new docuemnt we need to specify in logger.
     * @param {DocumentType} document
     */
    openedNewDocument(document)
    {
        this._loggedHeading = false;
        this.document = document;
    },

    logHeader()
    {
        if(!this._loggedHeading && this.document)
        {
            this.log.push(`\n${this.document.fileName}: \n`);
            this._loggedHeading = true;
        }
    },

    logInfo(info)
    {
        this.logHeader();
        this.log.push(`INFO: ${info}`);
    },

    logWarning(warning)
    {
        this.logHeader();
        this.log.push(`WARNING: ${warning}`);
        this.reportDiagnostic(warning, ErrorTypes.WARNING);
    },

    logError(error)
    {
        this.logHeader();
        this.log.push(`ERROR: ${error}`);
        this.reportDiagnostic(error, ErrorTypes.ERROR);
    },

    /** @description Publish parser log issues to Problems without displaying notifications. */
    reportDiagnostic(message, severity)
    {
        if(this.compilationContext)
        {
            VscodeError.create(message, 0, 0, 0, 0, severity).notifyUser(this);
        }
    },

    /** @description Convert the log to a string to be written to a file. */
    _toString()
    {
        let str = 'Stop logging by changing setting "lgd.options.createDebugLog"\nIf you have any problems or requests please create an issue on Github.\n';

        for(let i = 0; i < this.log.length; ++i)
        {
            str += `${this.log[i]}\n`;
        }

        return str;
    },

    /** @description Serialize completed runs' debug logs without delaying parallel parsing. */
    async write()
    {
        if(!lgd.configuration.createDebugLog)
        {
            return;
        }

        const logFile = this._toString();
        const filePath = path.join(this._logFolder(), `${this._fileName}.log`);
        const previousWrite = this.writeCompleted;
        let completeWrite;
        this.writeCompleted = new Promise(resolve =>
        {
            completeWrite = resolve;
        });

        try
        {
            await previousWrite;
            await FileIO.writeFileContents(filePath, logFile);
        }
        finally
        {
            completeWrite();
        }
    },

    /** @description where we save the logger. */
    _logFolder()
    {
        return path.join(vscode.workspace.rootPath, DEFAULT_DIR);
    }

};

module.exports = Logger;
