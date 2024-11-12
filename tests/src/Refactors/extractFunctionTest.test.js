const ExtractFunction = require('../../../src/Refactor/ExtractFunction');
const vscode = require('vscode');

lgd = {};
lgd.configuration = {
  createDebugLog: false,
  tabSize: 2,
  extractPropsAndState: true
};

jest.mock('vscode', () => ({
  window: {
    activeTextEditor: {
      document: {
        getText: jest.fn(),
        lineAt: jest.fn(),
        lineCount: 10
      },
      selection: {
        start: { line: 0 },
        end: { line: 0 }
      }
    }
  },
  Position: jest.fn(),
  commands: {
    registerCommand: jest.fn()
  },
  CodeAction: jest.fn(),
  CodeActionKind: {
    Refactor: 'refactor'
  }
}));

describe('ExtractFunction', () => {
  let extractFunction;

  beforeEach(() => {
    extractFunction = ExtractFunction.create();
    vscode.window.activeTextEditor.document.getText.mockClear();
    vscode.window.activeTextEditor.document.lineAt.mockClear();
  });

  test('should return false if no text is selected', () => {
    vscode.window.activeTextEditor.document.getText.mockReturnValue('');
    const result = extractFunction.executeCommand();
    expect(result).toBe(false);
  });

  test('should return false if no insert position is found', () => {
    vscode.window.activeTextEditor.document.getText.mockReturnValue('some code');
    extractFunction.findInsertPosition = jest.fn().mockReturnValue(null);
    const result = extractFunction.executeCommand();
    expect(result).toBe(false);
  });

  test('should extract function with correct parameters', () => {
    const selectedText = 'const a = 1;\nconst b = 2;\nconsole.log(a + b);';
    vscode.window.activeTextEditor.document.getText.mockReturnValue(selectedText);
    extractFunction.findInsertPosition = jest.fn().mockReturnValue(new vscode.Position(0, 0));
    extractFunction.checkIfInsideClass = jest.fn().mockReturnValue(false);

    const editBuilder = {
      insert: jest.fn(),
      replace: jest.fn()
    };
    vscode.window.activeTextEditor.edit = jest.fn(callback => callback(editBuilder));

    const result = extractFunction.executeCommand();

    expect(result).toBe(true);
    expect(editBuilder.insert).toHaveBeenCalled();
    expect(editBuilder.replace).toHaveBeenCalledWith(vscode.window.activeTextEditor.selection, 'extractedFunction();');
    expect(editBuilder.insert.mock.calls[0][1]).toContain('function extractedFunction()');
  });

  test('should register command', () => {
    const context = { subscriptions: [] };
    extractFunction.register(context);
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('lgd.extractFunction', expect.any(Function));
    expect(context.subscriptions.length).toBe(1);
  });

  test('should not include imported variables as function parameters', () => {
    const fullCode = `
      import { readFile } from 'fs';
      import defaultExport from 'module';
      import * as utils from './utils';

      const a = 1;
      const b = 2;
      console.log(a + b);
      readFile('./path', (err, data) => {
        utils.process(data);
      });
      console.log(defaultExport);
    `;
    const selectedText = `
      const b = 2;
      console.log(a + b);
      readFile('./path', (err, data) => {
        utils.process(data);
      });
      console.log(defaultExport);
    `;

    // Mock getText to return selectedText when called with the selection
    vscode.window.activeTextEditor.document.getText
      .mockImplementation(selection => (selection ? selectedText : fullCode));

    // Mock lineAt to return lines from fullCode
    const lines = fullCode.split('\n');
    vscode.window.activeTextEditor.document.lineAt.mockImplementation(line => ({ text: lines[line] }));

    // Mock findInsertPosition to return a new Position
    extractFunction.findInsertPosition = jest.fn().mockReturnValue(new vscode.Position(6, 0));

    // Mock checkIfInsideClass to return false
    extractFunction.checkIfInsideClass = jest.fn().mockReturnValue(false);

    // Capture the inserted function string
    const editBuilder = {
      insert: jest.fn(),
      replace: jest.fn()
    };
    vscode.window.activeTextEditor.edit = jest.fn(callback => callback(editBuilder));

    const result = extractFunction.executeCommand();

    expect(result).toBe(true);
    expect(editBuilder.insert).toHaveBeenCalled();
    expect(editBuilder.replace).toHaveBeenCalledWith(vscode.window.activeTextEditor.selection, 'extractedFunction(a);');

    const insertedFunction = editBuilder.insert.mock.calls[0][1];

    // Ensure that imported variables are not included as parameters
    expect(insertedFunction).toContain('function extractedFunction(a)');
  });

  test('should not include imported variables as function parameters', () => {
    const fullCode = `
      import { readFile } from 'fs';
      import defaultExport from 'module';
      import * as utils from './utils';

      const a = 1;
      const b = 2;
      console.log(a + b);
      readFile('./path', (err, data) => {
        utils.process(data);
      });
      console.log(defaultExport);
    `;
    const selectedText = `
      const a = 1;
      const b = 2;
      console.log(a + b);
      readFile('./path', (err, data) => {
        utils.process(data);
      });
      console.log(defaultExport);
    `;

    // Mock getText to return selectedText when called with the selection
    vscode.window.activeTextEditor.document.getText
      .mockImplementation(selection => (selection ? selectedText : fullCode));

    // Mock lineAt to return lines from fullCode
    const lines = fullCode.split('\n');
    vscode.window.activeTextEditor.document.lineAt.mockImplementation(line => ({ text: lines[line] }));

    // Mock findInsertPosition to return a new Position
    extractFunction.findInsertPosition = jest.fn().mockReturnValue(new vscode.Position(6, 0));

    // Mock checkIfInsideClass to return false
    extractFunction.checkIfInsideClass = jest.fn().mockReturnValue(false);

    // Capture the inserted function string
    const editBuilder = {
      insert: jest.fn(),
      replace: jest.fn()
    };
    vscode.window.activeTextEditor.edit = jest.fn(callback => callback(editBuilder));

    const result = extractFunction.executeCommand();

    expect(result).toBe(true);
    expect(editBuilder.insert).toHaveBeenCalled();
    expect(editBuilder.replace).toHaveBeenCalledWith(vscode.window.activeTextEditor.selection, 'extractedFunction();');

    const insertedFunction = editBuilder.insert.mock.calls[0][1];

    // Ensure that imported variables are not included as parameters
    expect(insertedFunction).toContain('function extractedFunction()');
  });
});