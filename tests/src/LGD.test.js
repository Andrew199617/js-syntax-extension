const fs = require('fs');
const path = require('path');
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

async function saveFiles(filenames, source = 'const Example = {\n  value: 1\n};')
{
    const save = vscode.workspace.onDidSaveTextDocument.mock.calls[0][0];
    const change = vscode.workspace.onDidChangeTextDocument.mock.calls[0][0];
    const schedule = jest.spyOn(global, 'setTimeout').mockReturnValue(0);
    for(const filename of filenames)
    {
        const document = {
            fileName: filename,
            uri: { fsPath: filename, toString: () => filename },
            getText: () => source
        };
        await change({ document: document, contentChanges: [] });
        save(document);
    }

    const [flushSaves] = schedule.mock.calls[schedule.mock.calls.length - 1];
    schedule.mockRestore();
    await flushSaves();
}

jest.unmock('../../src/Errors/VscodeError');
jest.mock('fs', () => ({ exists: jest.fn(), promises: { readFile: jest.fn() } }));
jest.mock('path', () => ({ ...jest.requireActual('path') }));
jest.mock('../../src/Logging/FileIO', () => ({ writeFileContents: jest.fn(), rename: jest.fn() }));

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
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn()
    },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    StatusBarAlignment: { Left: 1 },
    Range: jest.fn((line, character) => ({ start: { line: line, character: character } })),
    Diagnostic: jest.fn((range, message, severity) => ({ range: range, message: message, severity: severity })),
    CodeActionKind: { QuickFix: 'quickfix' }
}));

jest.mock('../../src/Core/Configuration', () => ({
    create: jest.fn(() => ({ autoComplete: { enabled: false }, tabSize: 2, createDebugLog: true, generateTypings: true, generateTypingsOnChange: true }))
}));

jest.mock('../../src/CodeActions/CodeActions', () => ({ create: jest.fn(() => ({ registerCommands: jest.fn() })) }));
jest.mock('../../src/CompletionItems/CompletionItemProvider', () => ({}));
jest.mock('../../src/Refactor/RefactorProvider', () => ({ create: jest.fn() }));
jest.mock('../../src/Refactor/InvertIf', () => ({ create: jest.fn(() => ({ register: jest.fn() })) }));

beforeEach(() =>
{
    previousLgd = globalThis.lgd;
    vscode.workspace.rootPath = 'workspace';
    vscode.window.activeTextEditor = undefined;
    fs.exists.mockReset();
    fs.promises.readFile.mockReset();
    FileIO.rename.mockReset();
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

test('a failed read is put in Problems while another file finishes without a popup', async () =>
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
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(getOutput()).toContain('1 compiled, 0 skipped, 1 failed; 1 errors, 0 warnings');
});

test('multiple parser errors and warnings stay in Problems and the status bar without popups', async () =>
{
    fs.promises.readFile.mockImplementation(filename => Promise.resolve(`/** @template {number} Item */
const Example = {
  ${filename.startsWith('first') ? 'firstValue' : 'secondValue'}: 1,
  ${filename.startsWith('first') ? 'firstValue' : 'secondValue'}: 2
};`));

    await compileAll();
    expect(getDiagnostics('first.js')).toHaveLength(2);
    expect(getDiagnostics('second.js')).toHaveLength(2);
    expect(getDiagnostics('first.js')[1].message).toContain('firstValue');
    expect(getDiagnostics('second.js')[1].message).toContain('secondValue');
    expect(getOutput()).toContain('0 compiled, 0 skipped, 2 failed; 2 errors, 2 warnings');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(lgd.outputChannel.show).not.toHaveBeenCalled();
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(1);
    const status = vscode.window.createStatusBarItem.mock.results[0].value;
    expect(status.text).toContain('0 compiled, 0 skipped, 2 failed; 2 errors, 2 warnings');
    expect(status.command).toBe('workbench.action.showErrorsWarnings');
    expect(status.show).toHaveBeenCalledTimes(1);
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
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
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
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
});

test('workspace discovery errors finish the progress indicator and appear in the status bar', async () =>
{
    vscode.workspace.findFiles.mockRejectedValueOnce(new Error('Cannot search workspace'));
    await compileAll();
    expect(getOutput()).toContain('Cannot search workspace');
    expect(vscode.window.setStatusBarMessage.mock.results[0].value.dispose).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.createStatusBarItem.mock.results[0].value.text).toContain('1 errors, 0 warnings');
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

test('Save All with dirty-state changes produces one status-bar warning summary without popups', async () =>
{
    const source = '/** @template {number} Item */\nconst Example = {\n  value: 1\n};';
    const filenames = [ 'first.js', 'second.js' ];
    await saveFiles(filenames, source);
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(1);
    expect(vscode.window.createStatusBarItem.mock.results[0].value.text).toContain('0 errors, 2 warnings');
    expect(getOutput()).toContain('2 compiled, 0 skipped, 0 failed; 0 errors, 2 warnings');
    expect(getDiagnostics('first.js')).toHaveLength(1);
    expect(getDiagnostics('second.js')).toHaveLength(1);
    expect(FileIO.writeFileContents).toHaveBeenCalledTimes(filenames.length + 1);
});

test('actual content changes report parser errors without popups', async () =>
{
    const change = vscode.workspace.onDidChangeTextDocument.mock.calls[0][0];
    const document = {
        fileName: 'single.js',
        uri: { fsPath: 'single.js' },
        getText: () => 'const Example = {\n  value: 1,\n  value: 2\n};'
    };
    await change({ document: document, contentChanges: [{ text: '1' }] });
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledTimes(1);
    expect(getOutput()).toContain('0 compiled, 0 skipped, 1 failed; 1 errors, 0 warnings');
    expect(getDiagnostics('single.js')[0].message).toContain('value');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(vscode.window.createStatusBarItem.mock.results[0].value.text).toContain('$(error)');
    expect(FileIO.writeFileContents).toHaveBeenCalledTimes(1);
});

test.each([ undefined, { document: { fileName: 'notes.txt' } } ])('compile command quietly skips an unavailable JavaScript editor: %p', async activeEditor =>
{
    vscode.window.activeTextEditor = activeEditor;
    const createCompilation = jest.spyOn(GenerateTypings, 'create');
    const registration = vscode.commands.registerCommand.mock.calls.find(([name]) => name === 'lgd.generateTypings');
    await registration[1]();
    expect(createCompilation).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
});

describe.each([ 'posix', 'win32' ])('output paths using %s', platform =>
{
    beforeEach(() =>
    {
        const platformPath = path[platform];
        jest.spyOn(path, 'parse').mockImplementation(platformPath.parse);
        jest.spyOn(path, 'relative').mockImplementation(platformPath.relative);
        jest.spyOn(path, 'join').mockImplementation(platformPath.join);
        vscode.workspace.rootPath = platform === 'win32' ? 'C:\\workspace\\project' : '/workspace/project';
    });

    test.each([
        [ true, 'typings/src/nested/Example.d.ts' ],
        [ false, 'typings/Example.d.ts' ]
    ])('generates nested declarations with maintainHierarchy=%s', async (maintainHierarchy, expectedFile) =>
    {
        lgd.configuration.maintainHierarchy = maintainHierarchy;
        const filename = path[platform].normalize(`${vscode.workspace.rootPath}/src/nested/Example.js`);
        const document = {
            fileName: filename,
            uri: { fsPath: filename },
            getText: () => 'const Example = {\n  value: 1\n};'
        };
        const result = await GenerateTypings.create(document, lgd.lgdDiagnosticCollection).execute();
        expect(result.compiled).toBe(true);
        expect(FileIO.writeFileContents).toHaveBeenCalledTimes(1);
        expect(FileIO.writeFileContents).toHaveBeenCalledWith(
            path[platform].normalize(`${vscode.workspace.rootPath}/${expectedFile}`),
            expect.stringContaining('static value: number;')
        );
    });

    test('writes root-level declarations and debug logs inside the typings directory', async () =>
    {
        lgd.configuration.maintainHierarchy = true;
        const filename = path[platform].normalize(`${vscode.workspace.rootPath}/Example.js`);
        const document = {
            fileName: filename,
            uri: { fsPath: filename },
            getText: () => 'const Example = {\n  value: 1\n};'
        };
        await GenerateTypings.create(document, lgd.lgdDiagnosticCollection).executeGenerateTypings();
        expect(FileIO.writeFileContents).toHaveBeenCalledTimes(2);
        expect(FileIO.writeFileContents.mock.calls.map(([file]) => file)).toEqual([
            path[platform].normalize(`${vscode.workspace.rootPath}/typings/Example.d.ts`),
            path[platform].normalize(`${vscode.workspace.rootPath}/typings/LGD.FileParser.log`)
        ]);
    });

    test('renames declarations in both flattened and maintained layouts', () =>
    {
        fs.exists.mockImplementation((filename, callback) => callback(filename.endsWith('Old.d.ts')));
        const rename = vscode.workspace.onDidRenameFiles.mock.calls[0][0];
        rename({ files: [{
            oldUri: { fsPath: path[platform].normalize(`${vscode.workspace.rootPath}/src/old/Old.js`) },
            newUri: { fsPath: path[platform].normalize(`${vscode.workspace.rootPath}/src/new/New.js`) }
        }] });
        expect(FileIO.rename).toHaveBeenCalledTimes(2);
        expect(FileIO.rename).toHaveBeenCalledWith(
            path[platform].normalize(`${vscode.workspace.rootPath}/typings/Old.d.ts`),
            path[platform].normalize(`${vscode.workspace.rootPath}/typings/New.d.ts`),
            expect.any(Function)
        );

        expect(FileIO.rename).toHaveBeenCalledWith(
            path[platform].normalize(`${vscode.workspace.rootPath}/typings/src/old/Old.d.ts`),
            path[platform].normalize(`${vscode.workspace.rootPath}/typings/src/new/New.d.ts`),
            expect.any(Function)
        );
    });

    test('renames a root-level declaration only once', () =>
    {
        fs.exists.mockImplementation((filename, callback) => callback(filename.endsWith('Old.d.ts')));
        const rename = vscode.workspace.onDidRenameFiles.mock.calls[0][0];
        rename({ files: [{
            oldUri: { fsPath: path[platform].normalize(`${vscode.workspace.rootPath}/Old.js`) },
            newUri: { fsPath: path[platform].normalize(`${vscode.workspace.rootPath}/New.js`) }
        }] });
        expect(FileIO.rename).toHaveBeenCalledTimes(1);
        expect(FileIO.rename).toHaveBeenCalledWith(
            path[platform].normalize(`${vscode.workspace.rootPath}/typings/Old.d.ts`),
            path[platform].normalize(`${vscode.workspace.rootPath}/typings/New.d.ts`),
            expect.any(Function)
        );
    });

    test('moving a source file keeps the flattened declaration without reporting a false collision', () =>
    {
        fs.exists.mockImplementation((filename, callback) => callback(!filename.includes(`${path[platform].sep}new${path[platform].sep}`)));
        const rename = vscode.workspace.onDidRenameFiles.mock.calls[0][0];
        rename({ files: [{
            oldUri: { fsPath: path[platform].normalize(`${vscode.workspace.rootPath}/src/old/Example.js`) },
            newUri: { fsPath: path[platform].normalize(`${vscode.workspace.rootPath}/src/new/Example.js`) }
        }] });
        expect(FileIO.rename).toHaveBeenCalledTimes(1);
        expect(FileIO.rename).toHaveBeenCalledWith(
            path[platform].normalize(`${vscode.workspace.rootPath}/typings/src/old/Example.d.ts`),
            path[platform].normalize(`${vscode.workspace.rootPath}/typings/src/new/Example.d.ts`),
            expect.any(Function)
        );
        expect(lgd.outputChannel.appendLine).not.toHaveBeenCalled();
    });

    test.each([
        [ true, '', 'src' ],
        [ false, '', 'src' ],
        [ true, 'src', '' ],
        [ false, 'src', '' ]
    ])('uses maintainHierarchy=%s for overlapping paths when moving from "%s" to "%s"', (maintainHierarchy, oldDirectory, newDirectory) =>
    {
        lgd.configuration.maintainHierarchy = maintainHierarchy;
        fs.exists.mockImplementation((filename, callback) => callback(filename.endsWith('Old.d.ts')));
        const rename = vscode.workspace.onDidRenameFiles.mock.calls[0][0];
        rename({ files: [{
            oldUri: { fsPath: path.join(vscode.workspace.rootPath, oldDirectory, 'Old.js') },
            newUri: { fsPath: path.join(vscode.workspace.rootPath, newDirectory, 'New.js') }
        }] });
        const oldTypingsDirectory = maintainHierarchy ? oldDirectory : '';
        const newTypingsDirectory = maintainHierarchy ? newDirectory : '';
        expect(FileIO.rename).toHaveBeenCalledTimes(1);
        expect(FileIO.rename).toHaveBeenCalledWith(
            path.join(vscode.workspace.rootPath, 'typings', oldTypingsDirectory, 'Old.d.ts'),
            path.join(vscode.workspace.rootPath, 'typings', newTypingsDirectory, 'New.d.ts'),
            expect.any(Function)
        );
    });

    test('an exclusive rename collision is logged without a popup', () =>
    {
        fs.exists.mockImplementation((filename, callback) => callback(true));
        FileIO.rename.mockImplementation((oldPath, newPath, callback) => callback({ code: 'EEXIST' }));
        const rename = vscode.workspace.onDidRenameFiles.mock.calls[0][0];
        rename({ files: [{
            oldUri: { fsPath: path[platform].normalize(`${vscode.workspace.rootPath}/src/Old.js`) },
            newUri: { fsPath: path[platform].normalize(`${vscode.workspace.rootPath}/src/New.js`) }
        }] });
        expect(FileIO.rename).toHaveBeenCalledTimes(2);
        expect(getOutput()).toContain(`${path[platform].normalize(`${vscode.workspace.rootPath}/typings/New.d.ts`)} already exists.`);
        expect(getOutput()).toContain(`${path[platform].normalize(`${vscode.workspace.rootPath}/typings/src/New.d.ts`)} already exists.`);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.window.createStatusBarItem).not.toHaveBeenCalled();
        expect(lgd.outputChannel.show).not.toHaveBeenCalled();
    });
});
