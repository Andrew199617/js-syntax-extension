/**
* @description
* @type {VscodeErrorType}
*/
const VscodeError = {
    /**
    * @description Initialize an instace of VscodeError.
    * @param {string} message The message to tell the user.
    * @param {number} startLine Where the error began.
    * @param {number} startCharacter The Character it began at.
    * @param {number} endLine The Line error ended at.
    * @param {number} endCharacter The Character the error ended at.
    * @param {ErrorTypesType} severity HINT, WARNING, ERROR.
    * @returns {VscodeErrorType}
    */
    create(message, startLine, startCharacter, endLine, endCharacter, severity) {
        const vscodeError = Object.assign({}, VscodeError);
        vscodeError.name = 'VscodeError';
        vscodeError.message = message;

        vscodeError.startLine = startLine;
        vscodeError.startCharacter = startCharacter;
        vscodeError.endLine = endLine;
        vscodeError.endCharacter = endCharacter;

        vscodeError.severity = severity;

        Error.call(vscodeError);
        Error.captureStackTrace(vscodeError, {message});

        return vscodeError;
    }
};

module.exports = VscodeError;