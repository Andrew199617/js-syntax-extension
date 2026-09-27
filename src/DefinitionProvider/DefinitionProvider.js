
/**
 * @description
 * @type {DefinitionProviderType}
 * @extends {vscode.DefinitionProvider}
 */
const DefinitionProvider = {
    /**
     * @description Initialize an instance of DefinitionProvider.
     * @returns {DefinitionProviderType}
     */
    create()
    {
        const definitionProvider = Object.create(DefinitionProvider);
        return definitionProvider;
    },

    /**
     * Provide the definition of the symbol at the given position and document.
     * @return {[]} A definition or a thenable that resolves to such. The lack of a result can be
     * signaled by returning `undefined` or `null`.
     */
    provideDefinition()
    {

    },

    /** @description Provides the registration hook for definition-provider commands. */
    registerCommands()
    {

    }
};


module.exports = DefinitionProvider;
