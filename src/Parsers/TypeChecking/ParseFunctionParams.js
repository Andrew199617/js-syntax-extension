const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const globals = require('globals');

// Select the environments you want to include
const environmentGlobals = {
  ...globals.browser,
  ...globals.node,
  ...globals.builtin,
  ...globals.worker,
  ...globals.jest
};

// Convert the globals to a Set for efficient lookup
const globalsSet = new Set(Object.keys(environmentGlobals));

/**
 * @description
 * @type {ParseFunctionParamsType}
 */
const ParseFunctionParams = {
  /**
   * @description Initialize an instance of ParseFunctionParams.
   * @returns {ParseFunctionParamsType}
   */
  create() {
    const parseFunctionParams = Object.create(ParseFunctionParams);
    return parseFunctionParams;
  },

  /**
   * Extract undefined variables in a function.
   * @param {string} code - The source code to analyze.
   * @param {string[]} [additionalDeclaredVars=[]] - Additional variables that are considered as declared.
   * @returns {string[]} - An array of undefined variable names.
   */
  getUndefinedVariables(code, additionalDeclaredVars = []) {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: [ 'jsx', 'typescript' ]
    });

    const undefinedVars = new Set();
    const declaredVars = new Set(additionalDeclaredVars);

    // Traverse the AST
    traverse(ast, {
      Identifier(path) {
        // Skip if the identifier is part of a declaration
        if(
          path.parent.type === 'VariableDeclarator'
          || path.parent.type === 'FunctionDeclaration'
          || path.parent.type === 'FunctionExpression'
          || path.parent.type === 'ClassDeclaration'
          || path.parent.type === 'ImportSpecifier'
          || path.parent.type === 'ImportDefaultSpecifier'
          || path.parent.type === 'ImportNamespaceSpecifier'
        ) {
          return;
        }

        // Skip if the identifier is a property of a member expression
        if(
          path.parent.type === 'MemberExpression'
          && path.key === 'property'
          && !path.parent.computed
        ) {
          return;
        }

        const name = path.node.name;

        if(globalsSet.has(name) || declaredVars.has(name)) {
          return;
        }

        // Check if the identifier is bound in the current scope or declaredVars
        if(!path.scope.hasBinding(name, false)) {
          undefinedVars.add(name);
        }
      }
    });

    return Array.from(undefinedVars);
  }
};

module.exports = ParseFunctionParams;