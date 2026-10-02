const vscode = require('vscode');

/**
 * @description Reads compiler output settings for the source's workspace folder.
 * @param {Object} document the LGD source document.
 * @returns {Object} current LGD options, with compiler defaults applied by its resolver.
 */
function readOutputOptions(document)
{
    return vscode.workspace.getConfiguration('lgd', document.uri).get('options') || {};
}

module.exports = { readOutputOptions: readOutputOptions };
