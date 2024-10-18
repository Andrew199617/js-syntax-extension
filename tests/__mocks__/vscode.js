const vscode = {
  workspace: {
    findFiles: jest.fn(),
  },

  Uri: {
    parse: jest.fn((path) => ({
      fsPath: path
    })),
  }
};

module.exports = vscode;