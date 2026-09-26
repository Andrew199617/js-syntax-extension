const fs = require('fs');
const vscode = require('vscode');
const GenerateTypings = require('../../src/GenerateTypings');
const extension = require('../../src/LGD');

function deferred()
{
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) =>
    {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise: promise, resolve: resolve, reject: reject };
}

function nextTurn()
{
    return new Promise(resolve => setImmediate(resolve));
}

function compileAll()
{
    const registration = vscode.commands.registerCommand.mock.calls.find(([name]) => name === 'lgd.generateTypingsForAll');
    return registration[1]();
}

jest.mock('fs', () => ({ promises: { readFile: jest.fn() } }));

jest.mock('vscode', () => ({
    commands: {
        registerCommand: jest.fn(() => ({ dispose: jest.fn() }))
    },
    languages: {
        createDiagnosticCollection: jest.fn(() => ({ dispose: jest.fn() })),
        registerCodeActionsProvider: jest.fn(() => ({ dispose: jest.fn() }))
    },
    workspace: {
        findFiles: jest.fn(),
        onDidSaveTextDocument: jest.fn(),
        onDidChangeTextDocument: jest.fn(),
        onDidCloseTextDocument: jest.fn(),
        onDidChangeConfiguration: jest.fn(),
        onDidRenameFiles: jest.fn()
    },
    CodeActionKind: { QuickFix: 'quickfix' }
}));

jest.mock('../../src/GenerateTypings', () => ({ create: jest.fn() }));
jest.mock('../../src/Core/Configuration', () => ({ create: jest.fn(() => ({ autoComplete: { enabled: false } })) }));
jest.mock('../../src/Logging/Logger', () => ({ create: jest.fn(() => ({ log: [], notifyUser: jest.fn() })) }));
jest.mock('../../src/CodeActions/CodeActions', () => ({ create: jest.fn(() => ({ registerCommands: jest.fn() })) }));
jest.mock('../../src/CompletionItems/CompletionItemProvider', () => ({}));
jest.mock('../../src/Refactor/RefactorProvider', () => ({ create: jest.fn() }));
jest.mock('../../src/Refactor/InvertIf', () => ({ create: jest.fn(() => ({ register: jest.fn() })) }));

beforeEach(() =>
{
    fs.promises.readFile.mockReset();
    GenerateTypings.create.mockReset();
    extension.activate({ subscriptions: [] });
    vscode.workspace.findFiles.mockResolvedValue([ { fsPath: 'first.js' }, { fsPath: 'second.js' } ]);
});

afterEach(() =>
{
    extension.deactivate();
});

test('starts file reads and compilations concurrently and waits for both', async () =>
{
    const firstRead = deferred();
    const secondRead = deferred();
    const firstCompilation = deferred();
    const secondCompilation = deferred();
    const firstExecute = jest.fn(() => firstCompilation.promise);
    const secondExecute = jest.fn(() => secondCompilation.promise);
    fs.promises.readFile.mockReturnValueOnce(firstRead.promise).mockReturnValueOnce(secondRead.promise);
    GenerateTypings.create.mockReturnValueOnce({ execute: firstExecute }).mockReturnValueOnce({ execute: secondExecute });

    const completion = compileAll();
    await nextTurn();
    expect(fs.promises.readFile.mock.calls).toEqual([ [ 'first.js', 'utf8' ], [ 'second.js', 'utf8' ] ]);

    firstRead.resolve('first source');
    secondRead.resolve('second source');
    await nextTurn();
    expect(firstExecute).toHaveBeenCalledTimes(1);
    expect(secondExecute).toHaveBeenCalledTimes(1);
    expect(lgd.logger.notifyUser).not.toHaveBeenCalled();
    expect(GenerateTypings.create.mock.calls[0][0].getText()).toBe('first source');
    expect(GenerateTypings.create.mock.calls[1][0].getText()).toBe('second source');

    firstCompilation.resolve();
    await nextTurn();
    expect(lgd.logger.notifyUser).not.toHaveBeenCalled();
    secondCompilation.resolve();
    await completion;
    expect(lgd.logger.notifyUser).toHaveBeenCalledTimes(1);
});

test('a failed read does not prevent another file from completing', async () =>
{
    const failure = new Error('Cannot read first.js');
    const compilation = deferred();
    const execute = jest.fn(() => compilation.promise);
    fs.promises.readFile.mockRejectedValueOnce(failure).mockResolvedValueOnce('second source');
    GenerateTypings.create.mockReturnValue({ execute: execute });

    const completion = compileAll();
    const rejection = expect(completion).rejects.toBe(failure);
    await nextTurn();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(lgd.logger.notifyUser).not.toHaveBeenCalled();
    compilation.resolve();
    await rejection;
    expect(lgd.logger.notifyUser).toHaveBeenCalledTimes(1);
});

test('an empty workspace completes without reading or compiling files', async () =>
{
    vscode.workspace.findFiles.mockResolvedValue([]);
    await compileAll();
    expect(fs.promises.readFile).not.toHaveBeenCalled();
    expect(GenerateTypings.create).not.toHaveBeenCalled();
    expect(lgd.logger.notifyUser).toHaveBeenCalledTimes(1);
});
