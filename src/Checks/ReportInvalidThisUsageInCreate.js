const VscodeError = require('../Errors/VscodeError');
const ErrorTypes = require('../Errors/ErrorTypes');

/**
 * @description Report invalid use of this in an object-literal create method.
 * @this {FileParserType}
 * @param {string} insideFunction The body of the create method.
 */
function reportInvalidThisUsageInCreate(insideFunction)
{
    const thisKeywordRegex = new RegExp(`(?<this>^\\s{${this.tabSize}}this\\.\\w+)`, 'gm');
    let test;

    const oldBeginLine = this.beginLine;
    const oldEndLine = this.endLine;

    while((test = thisKeywordRegex.exec(insideFunction)) !== null)
    {
        this.updatePosition(insideFunction, test, 'this', oldBeginLine);
        VscodeError.create(
            `LGD: Don't use 'this' in create method. This has unintended consequenses. Use ${this.className}. instead of this.`,
            this.beginLine,
            this.beginCharacter,
            this.endLine,
            this.endCharacter,
            ErrorTypes.ERROR
        ).notifyUser(this);
    }

    this.beginLine = oldBeginLine;
    this.endLine = oldEndLine;
}

module.exports = reportInvalidThisUsageInCreate;
