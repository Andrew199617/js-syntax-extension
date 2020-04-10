/**
* @description
* @type {lgdType}
*/
const lgd = {
  /** @type {ConfigurationType} */
  configuration: null,

  /** @type {CodeActionsType} */
  codeActions: null,

  /** @type {DefinitionProviderType} */
  definitionProvider: null,

  /** @type {vscode.DiagnosticCollection} */
  lgdDiagnosticCollection: null,

  /** @type {LoggerType} */
  logger: null
};

module.exports = lgd;