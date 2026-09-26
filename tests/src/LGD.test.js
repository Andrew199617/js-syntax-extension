const fs = require('fs');
const vscode = require('vscode');
const GenerateTypings = require('../../src/GenerateTypings');
const FileIO = require('../../src/Logging/FileIO');
const StatusBarMessage = require('../../src/Logging/StatusBarMessage');
const extension = require('../../src/LGD');

let previousLgd;

function deferred()
{
    let resolve;
    const promise = new Promise(resolvePromise =>
    {
        resolve = resolvePromise;
    });

    return { promise: promise, resolve: resolve };
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

function getDiagnostics(filename)
{
    const updates = lgd.lgdDiagnosticCollection.set.mock.calls.filter(([uri]) => uri.fsPath === filename);
    return updates[updates.length - 1][1];
}

function getOutput()
{
    return lgd.outputChannel.appendLine.mock.calls.map(([line]) => line).join('\n');
}

async function saveFiles(filenames)
{
    const save = vscode.workspace.onDidSaveTextDocument.mock.calls[0][0];
    const schedule = jest.spyOn(global, 'setTimeout').mockReturnValue(0);
    for(const filename of filenames)
    {
        save({
            fileName: filename,
            uri: { fsPath: filename, toString: () => filename },
            getText: () => 'const Example = {\n  value: 1\n};'
        });
    }

    const [flushSaves] = schedule.mock.calls[schedule.mock.calls.length - 1];
    schedule.mockRestore();
    await flushSaves();
}

jest.unmock('../../src/Errors/VscodeError');
jest.mock('fs', () => ({ promises: { readFile: jest.fn() } }));
jest.mock('../../src/Logging/FileIO', () => ({ writeFileContents: jest.fn() }));

jest.mock('vscode', () => ({
    commands: {
        registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
        executeCommand: jest.fn()
    },
    languages: {
        createDiagnosticCollection: jest.fn(() => ({ set: jest.fn(), dispose: jest.fn() })),
        registerCodeActionsProvider: jest.fn(() => ({ dispose: jest.fn() }))
    },
    workspace: {
        rootPath: 'workspace',
        findFiles: jest.fn(),
        onDidSaveTextDocument: jest.fn(),
        onDidChangeTextDocument: jest.fn(),
        onDidCloseTextDocument: jest.fn(),
        onDidChangeConfiguration: jest.fn(),
        onDidRenameFiles: jest.fn()
    },
    window: {
        createOutputChannel: jest.fn(() => ({ appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn() })),
        setStatusBarMessage: jest.fn(() => ({ dispose: jest.fn() })),
        createStatusBarItem: jest.fn(() => ({ show: jest.fn(), hide: jest.fn() })),
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn()
    },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    StatusBarAlignment: { Left: 1 },
    Range: jest.fn((line, character) => ({ start: { line: line, character: character } })),
    Diagnostic: jest.fn((range, message, severity) => ({ range: range, message: message, severity: severity })),
    CodeActionKind: { QuickFix: 'quickfix' }
}));

jest.mock('../../src/Core/Configuration', () => ({
    create: jest.fn(() => ({ autoComplete: { enabled: false }, tabSize: 2, createDebugLog: true, generateTypings: true }))
}));

jest.mock('../../src/CodeActions/CodeActions', () => ({ create: jest.fn(() => ({ registerCommands: jest.fn() })) }));
jest.mock('../../src/CompletionItems/CompletionItemProvider', () => ({}));
jest.mock('../../src/Refactor/RefactorProvider', () => ({ create: jest.fn() }));
jest.mock('../../src/Refactor/InvertIf', () => ({ create: jest.fn(() => ({ register: jest.fn() })) }));

beforeEach(() =>
{
    previousLgd = globalThis.lgd;
    fs.promises.readFile.mockReset();
    FileIO.writeFileContents.mockReset();
    FileIO.writeFileContents.mockResolvedValue();
    extension.activate({ subscriptions: [] });
    vscode.workspace.findFiles.mockResolvedValue([ { fsPath: 'first.js' }, { fsPath: 'second.js' } ]);
});

afterEach(() =>
{
    StatusBarMessage.hideError();
    jest.restoreAllMocks();
    extension.deactivate();
    globalThis.lgd = previousLgd;
});

test('starts reads and compilations concurrently, then writes one debug log and one status', async () =>
{
    const firstRead = deferred();
    const secondRead = deferred();
    const firstCompilation = deferred();
    const secondCompilation = deferred();
    const compile = jest.spyOn(GenerateTypings, 'compile');
    compile.mockReturnValueOnce(firstCompilation.promise).mockReturnValueOnce(secondCompilation.promise);
    fs.promises.readFile.mockReturnValueOnce(firstRead.promise).mockReturnValueOnce(secondRead.promise);

    const completion = compileAll();
    await nextTurn();
    expect(fs.promises.readFile.mock.calls).toEqual([ [ 'first.js', 'utf8' ], [ 'second.js', 'utf8' ] ]);
    firstRead.resolve('first source');
    secondRead.resolve('second source');
    await nextTurn();
    expect(compile.mock.calls).toEqual([ [ 'first.js', 'first source' ], [ 'second.js', 'second source' ] ]);
    expect(FileIO.writeFileContents).not.toHaveBeenCalled();
    firstCompilation.resolve(true);
    await nextTurn();
    expect(getOutput()).toContain('Compiled: first.js');
    expect(FileIO.writeFileContents).not.toHaveBeenCalled();
    expect(vscode.window.createStatusBarItem).not.toHaveBeenCalled();
    secondCompilation.resolve(true);
    await completion;
    expect(FileIO.writeFileContents).toHaveBeenCalledTimes(1);
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.setStatusBarMessage.mock.results[0].value.dispose).toHaveBeenCalledTimes(1);
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(getOutput()).toContain('2 compiled, 0 skipped, 0 failed; 0 errors, 0 warnings');
});

test('a failed read is put in Problems while another file finishes, followed by one popup', async () =>
{
    const compilation = deferred();
    const compile = jest.spyOn(GenerateTypings, 'compile').mockReturnValue(compilation.promise);
    fs.promises.readFile.mockRejectedValueOnce(new Error('Cannot read first.js')).mockResolvedValueOnce('second source');
    const completion = compileAll();
    await nextTurn();
    expect(compile).toHaveBeenCalledTimes(1);
    expect(getDiagnostics('first.js')[0]).toMatchObject({ message: 'Cannot read first.js', severity: vscode.DiagnosticSeverity.Error });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    compilation.resolve(true);
    await completion;
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(getOutput()).toContain('1 compiled, 0 skipped, 1 failed; 1 errors, 0 warnings');
});

test('multiple parser errors and warnings keep their files in Problems and show one summary popup', async () =>
{
    fs.promises.readFile.mockImplementation(filename => Promise.resolve(`/** @template {number} Item */
const Example = {
  ${filename.startsWith('first') ? 'firstValue' : 'secondValue'}: 1,
  ${filename.startsWith('first') ? 'firstValue' : 'secondValue'}: 2
};`));

    vscode.window.showErrorMessage.mockResolvedValueOnce('Show Output');
    await compileAll();
    expect(getDiagnostics('first.js')).toHaveLength(2);
    expect(getDiagnostics('second.js')).toHaveLength(2);
    expect(getDiagnostics('first.js')[1].message).toContain('firstValue');
    expect(getDiagnostics('second.js')[1].message).toContain('secondValue');
    expect(getOutput()).toContain('0 compiled, 0 skipped, 2 failed; 2 errors, 2 warnings');
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(lgd.outputChannel.show).toHaveBeenCalledWith(true);
    expect(FileIO.writeFileContents).toHaveBeenCalledTimes(1);
    expect(FileIO.writeFileContents.mock.calls[0][1]).toContain('first.js');
    expect(FileIO.writeFileContents.mock.calls[0][1]).toContain('second.js');
});

test('successful compilation retains warnings in Problems even with debug logging disabled', async () =>
{
    lgd.configuration.createDebugLog = false;
    fs.promises.readFile.mockResolvedValue('/** @template {number} Item */\nconst Example = {\n  value: 1\n};');
    await compileAll();
    expect(getDiagnostics('first.js')[0]).toMatchObject({ message: "Don't add type for Template", severity: vscode.DiagnosticSeverity.Warning });
    expect(getDiagnostics('second.js')).toHaveLength(1);
    expect(getOutput()).toContain('2 compiled, 0 skipped, 0 failed; 0 errors, 2 warnings');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(FileIO.writeFileContents).toHaveBeenCalledTimes(2);
    expect(FileIO.writeFileContents.mock.calls.every(([filename]) => filename.endsWith('.d.ts'))).toBe(true);
    fs.promises.readFile.mockResolvedValue('const Example = {\n  value: 1\n};');
    await compileAll();
    expect(getDiagnostics('first.js')).toEqual([]);
    expect(getDiagnostics('second.js')).toEqual([]);
});

test('a declaration write failure is assigned to the source file and included in the summary', async () =>
{
    fs.promises.readFile.mockResolvedValue('const Example = {\n  value: 1\n};');
    FileIO.writeFileContents.mockRejectedValueOnce(new Error('Cannot write declaration'));
    await compileAll();
    expect(getDiagnostics('first.js')[0]).toMatchObject({ message: 'Cannot write declaration', severity: vscode.DiagnosticSeverity.Error });
    expect(getOutput()).toContain('1 compiled, 0 skipped, 1 failed; 1 errors, 0 warnings');
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
});

test('workspace discovery errors finish the progress indicator and show one error', async () =>
{
    vscode.workspace.findFiles.mockRejectedValueOnce(new Error('Cannot search workspace'));
    await compileAll();
    expect(getOutput()).toContain('Cannot search workspace');
    expect(vscode.window.setStatusBarMessage.mock.results[0].value.dispose).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
});

test('an empty workspace completes without reading files or showing a popup', async () =>
{
    vscode.workspace.findFiles.mockResolvedValue([]);
    await compileAll();
    expect(fs.promises.readFile).not.toHaveBeenCalled();
    expect(getOutput()).toContain('0 compiled, 0 skipped, 0 failed; 0 errors, 0 warnings');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
});

test('saving one file retains the short per-file status messages', async () =>
{
    await saveFiles(['single.js']);
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith('$(zap) Compiling .js --> .d.ts');
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(1);
    expect(vscode.window.createStatusBarItem.mock.results[0].value.text).toMatch(/^\$\(check\) LGD compiled in \d+ms$/);
});

test('Save All groups neighboring saves into one report while compiling both documents', async () =>
{
    await saveFiles([ 'first.js', 'second.js' ]);
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith('$(sync~spin) LGD: Save all');
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(1);
    expect(getOutput()).toContain('2 compiled, 0 skipped, 0 failed; 0 errors, 0 warnings');
    expect(getDiagnostics('first.js')).toEqual([]);
    expect(getDiagnostics('second.js')).toEqual([]);
    const debugWrites = FileIO.writeFileContents.mock.calls.filter(([filename]) => filename.endsWith('.log'));
    expect(debugWrites).toHaveLength(1);
});
