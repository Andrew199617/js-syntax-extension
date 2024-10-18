jest.mock('../src/Errors/VscodeError.js', () => {
  return jest.fn();
})

jest.mock('vscode');