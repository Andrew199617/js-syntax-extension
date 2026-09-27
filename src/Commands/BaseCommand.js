const vscode = require('vscode');

/**
 * @description Helps Create an Object that can generate a Command for vscode.
 * @type {BaseCommandType}
 */
const BaseCommand = {
    /**
     * @description Initialize an instance of BaseCommand.
     * @param {string} commandName The name of the command.
     * @param {string} title The title of the command.
     * @returns {BaseCommandType}
     */
    create(commandName, title)
    {
        const baseCommand = Object.create(BaseCommand);

        /** @type {vscode.Command} */
        baseCommand.command = {
            title: title,
            command: commandName
        };

        return baseCommand;
    },

    /**
     * @description Returns the identifier used to register this command.
     * @type {string}
     */
    get commandName()
    {
        return this.command.command;
    },

    /**
     * @description Creates the vscode command.
     * @returns {vscode.Disposable}
     */
    createCommand()
    {
        return vscode.commands.registerCommand(this.commandName, this.executeCommand);
    },

    /**
     * @description Requires derived commands to implement their execution behavior.
     * @virtual
     */
    executeCommand()
    {
        throw new Error('Did not implement!');
    }
};

module.exports = BaseCommand;
