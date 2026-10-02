const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const GenerateTypings = require('../../src/GenerateTypings');
const FileIO = require('../../src/Logging/FileIO');
const StatusBarMessage = require('../../src/Logging/StatusBarMessage');
const extension = require('../../src/LGD');
const LgdCompiler = require('../../src/Compilers/LgdCompiler');

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

function compileCurrent()
{
    const registration = vscode.commands.registerCommand.mock.calls.find(([name]) => name === 'lgd.generateTypings');
    return registration[1]();
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
            uri: {
                fsPath: filename,

                /** @description Returns the test document path as its URI string. */
                toString: () => filename
            },

            /** @description Returns the source for the simulated changed document. */
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
jest.mock('fs', () => ({ exists: jest.fn(), promises: { readFile: jest.fn(), stat: jest.fn() } }));
jest.mock('path', () => ({ ...jest.requireActual('path') }));
jest.mock('../../src/Logging/FileIO', () => ({ writeFileContents: jest.fn(), rename: jest.fn() }));

jest.mock('vscode', () => ({
    commands: {
        registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
        executeCommand: jest.fn()
    },
    languages: {
        createDiagnosticCollection: jest.fn(() => ({ set: jest.fn(), delete: jest.fn(), dispose: jest.fn() })),
        registerCodeActionsProvider: jest.fn(() => ({ dispose: jest.fn() })),
        registerHoverProvider: jest.fn(() => ({ dispose: jest.fn() })),
        registerCompletionItemProvider: jest.fn(() => ({ dispose: jest.fn() })),
        registerDefinitionProvider: jest.fn(() => ({ dispose: jest.fn() })),
        registerReferenceProvider: jest.fn(() => ({ dispose: jest.fn() })),
        registerDocumentSemanticTokensProvider: jest.fn(() => ({ dispose: jest.fn() }))
    },
    SemanticTokensLegend: jest.fn(),
    SemanticTokensBuilder: jest.fn(),
    workspace: {
        rootPath: 'workspace',
        textDocuments: [],
        findFiles: jest.fn(),
        createFileSystemWatcher: jest.fn(() => ({
            onDidChange: jest.fn(), onDidCreate: jest.fn(), onDidDelete: jest.fn(), dispose: jest.fn()
        })),
        onDidOpenTextDocument: jest.fn(),
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
    fs.promises.stat.mockReset();
    fs.promises.stat.mockResolvedValue({ mtimeMs: 1, ctimeMs: 1, size: 1 });
    FileIO.rename.mockReset();
    FileIO.writeFileContents.mockReset();
    FileIO.writeFileContents.mockResolvedValue();
    extension.activate({ subscriptions: [] });
    vscode.workspace.findFiles.mockImplementation(pattern => Promise.resolve(pattern.includes('.lgd') ? [] : [ { fsPath: 'first.js' }, { fsPath: 'second.js' } ]));
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

        /** @description Returns duplicate properties to test error reporting on document changes. */
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

            /** @description Returns the source used to verify generated output paths. */
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

            /** @description Returns the source used to verify generated declarations and logs. */
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
});

test.each([
    'registerHoverProvider',
    'registerDefinitionProvider',
    'registerReferenceProvider',
    'registerCompletionItemProvider',
    'registerDocumentSemanticTokensProvider'
])('registers %s for file-backed LGD documents', registration =>
{
    expect(vscode.languages[registration].mock.calls[0][0]).toEqual({ scheme: 'file', language: 'lgd' });
});

describe('LGD imported-file invalidation', () =>
{
    test.each([ 'onDidChange', 'onDidCreate', 'onDidDelete' ])('routes %s only for known dependencies or open documents', event =>
    {
        const registrations = vscode.workspace.createFileSystemWatcher.mock.results;
        const watcher = registrations[registrations.length - 1].value;
        const invalidate = jest.spyOn(lgd.languageService, 'invalidateFile').mockResolvedValue();
        const dependency = { fsPath: path.join('workspace', 'Base.lgd') };
        const opened = { fsPath: path.join('workspace', 'Open.lgd') };
        const unrelated = { fsPath: path.join('workspace', 'Unrelated.lgd') };
        lgd.languageService.dependents.set(dependency.fsPath, new Set(['Consumer.lgd']));
        lgd.languageService.openStatesByPath.set(opened.fsPath, {});
        const callback = watcher[event].mock.calls[0][0];
        callback(unrelated);
        callback(dependency);
        callback(opened);

        expect(invalidate.mock.calls).toEqual([ [dependency.fsPath], [opened.fsPath] ]);
        expect(vscode.workspace.createFileSystemWatcher).toHaveBeenLastCalledWith('**/*.lgd');
    });
});

describe('manual LGD compilation', () =>
{
    test.each([ 'Number = ;', 'Number total = "many";', 'void log() {}', 'Number read() { return 1; }' ])('does not announce success when compilation fails for %s', async source =>
    {
        vscode.window.activeTextEditor = {
            document: { fileName: path.join('workspace', 'broken.lgd'), getText: () => source }
        };

        await compileCurrent();

        expect(FileIO.writeFileContents).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.window.createStatusBarItem.mock.results[0].value.text).toContain('.js output not updated');
    });

    test('uses the saved source snapshot while reading sibling exports', async () =>
    {
        const siblingRead = deferred();
        fs.promises.readFile.mockReturnValueOnce(siblingRead.promise);
        let source = "Number value = require('./Counter.js');";
        vscode.window.activeTextEditor = {
            document: { fileName: path.join('workspace', 'consumer.lgd'), getText: () => source }
        };

        const compilation = compileCurrent();
        source = 'String value = "edited";';
        siblingRead.resolve('Number Counter = 1;\nmodule.exports = Counter;');
        await compilation;

        expect(FileIO.writeFileContents).toHaveBeenCalledWith(
            path.join('workspace', 'consumer.js'),
            "/** @type {number} */\nlet value = require('./Counter.js');"
        );
    });

    test('announces success only after the output write finishes', async () =>
    {
        const outputWrite = deferred();
        FileIO.writeFileContents.mockReturnValueOnce(outputWrite.promise);
        vscode.window.activeTextEditor = {
            document: { fileName: path.join('workspace', 'working.lgd'), getText: () => 'Number count = 1;' }
        };

        const compilation = compileCurrent();
        await nextTurn();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        outputWrite.resolve();
        await compilation;

        expect(FileIO.writeFileContents).toHaveBeenCalledWith(
            path.join('workspace', 'working.js'),
            '/** @type {number} */\nlet count = 1;'
        );
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('LGD: Compiled .lgd file into .js file.');
    });
});

describe('LGD compile-all results', () =>
{
    beforeEach(() =>
    {
        lgd.configuration.createDebugLog = false;
        vscode.workspace.findFiles.mockImplementation(pattern => Promise.resolve(pattern.includes('.lgd')
            ? [{ fsPath: path.join('workspace', 'consumer.lgd') }]
            : []));
    });

    test('preserves output when a sibling LGD export has an incompatible type', async () =>
    {
        fs.promises.readFile.mockImplementation(filename => Promise.resolve(filename.endsWith('consumer.lgd')
            ? "String value = require('./Counter.js');"
            : 'Number Counter = 1;\nmodule.exports = Counter;'));

        await compileAll();

        expect(FileIO.writeFileContents).not.toHaveBeenCalled();
        expect(getOutput()).toContain('0 compiled, 0 skipped, 1 failed; 1 errors, 0 warnings');
        expect(getOutput()).toContain('Cannot assign Counter to String.');
    });

    test('writes warning-only results and counts their warnings separately', async () =>
    {
        fs.promises.readFile.mockResolvedValue('Number value = 1;');
        jest.spyOn(LgdCompiler, 'compileToJs').mockReturnValue({
            code: 'let value = 1;',
            errors: [{ severity: 'warning', message: 'A compiler warning.', line: 1, offset: 0 }]
        });

        await compileAll();

        expect(FileIO.writeFileContents).toHaveBeenCalledWith(path.join('workspace', 'consumer.js'), 'let value = 1;');
        expect(getOutput()).toContain('1 compiled, 0 skipped, 0 failed; 0 errors, 1 warnings');
    });
});

describe('LGD compile on save', () =>
{
    function saveLgdDocument(fileName, source)
    {
        const registrations = vscode.workspace.onDidSaveTextDocument.mock.calls;
        const saveLgd = registrations[registrations.length - 1][0];
        saveLgd({
            languageId: 'lgd',
            fileName: fileName,
            getText: () => source
        });
    }

    test.each([ 'Number = ;', 'void log() {}' ])('saving LGD with errors leaves the previous .js output untouched: %s', async source =>
    {
        vscode.window.createStatusBarItem.mockClear();

        saveLgdDocument(path.join('workspace', 'broken.lgd'), source);
        await nextTurn();
        await nextTurn();

        expect(FileIO.writeFileContents).not.toHaveBeenCalled();
        expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(1);
        expect(vscode.window.createStatusBarItem.mock.results[0].value.text).toContain('1 error(s)');
    });

    test('saving LGD with a type error leaves the previous .js output untouched', async () =>
    {
        vscode.window.createStatusBarItem.mockClear();

        saveLgdDocument(path.join('workspace', 'typed.lgd'), 'Number total = "many";');
        await nextTurn();
        await nextTurn();

        expect(FileIO.writeFileContents).not.toHaveBeenCalled();
        expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(1);
        expect(vscode.window.createStatusBarItem.mock.results[0].value.text).toContain('1 error(s)');
    });

    test.each([
        [ 'String', false ],
        [ 'Number', true ]
    ])('checks sibling exports when saving a %s import', async (typeName, shouldWrite) =>
    {
        fs.promises.readFile.mockResolvedValue('Number Counter = 1;\nmodule.exports = Counter;');

        saveLgdDocument(path.join('workspace', 'consumer.lgd'), `${typeName} value = require('./Counter.js');`);
        await nextTurn();
        await nextTurn();

        expect(fs.promises.readFile).toHaveBeenCalledWith(path.resolve('workspace', 'Counter.lgd'), 'utf8');
        expect(FileIO.writeFileContents).toHaveBeenCalledTimes(shouldWrite ? 1 : 0);
        if(shouldWrite)
        {
            expect(FileIO.writeFileContents).toHaveBeenCalledWith(
                path.join('workspace', 'consumer.js'),
                "/** @type {number} */\nlet value = require('./Counter.js');"
            );
        }
        else
        {
            expect(vscode.window.createStatusBarItem.mock.results[0].value.text).toContain('.js output not updated');
        }
    });

    test('saving a mix of errors and warnings blocks output and counts only errors', async () =>
    {
        jest.spyOn(LgdCompiler, 'compileToJs').mockReturnValue({
            code: 'invalid output',
            errors: [
                { severity: 'warning', message: 'A compiler warning.', line: 1, offset: 0 },
                { message: 'A compiler error.', line: 1, offset: 0 }
            ]
        });

        saveLgdDocument(path.join('workspace', 'broken.lgd'), 'Number value = "many";');
        await nextTurn();
        await nextTurn();

        expect(FileIO.writeFileContents).not.toHaveBeenCalled();
        expect(vscode.window.createStatusBarItem.mock.results[0].value.text).toContain('1 error(s)');
    });

    test('saving warning-only LGD still updates the output', async () =>
    {
        jest.spyOn(LgdCompiler, 'compileToJs').mockReturnValue({
            code: 'let value = 1;',
            errors: [{ severity: 'warning', message: 'A compiler warning.', line: 1, offset: 0 }]
        });

        saveLgdDocument(path.join('workspace', 'working.lgd'), 'Number value = 1;');
        await nextTurn();
        await nextTurn();

        expect(FileIO.writeFileContents).toHaveBeenCalledWith(path.join('workspace', 'working.js'), 'let value = 1;');
    });

    test('saving real redundant return documentation warnings still updates JavaScript', async () =>
    {
        const source = 'Object Working = { /** @returns {number} The count. */ Number count() { return 1; } };';
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([expect.objectContaining({ severity: 'warning' })]);

        saveLgdDocument(path.join('workspace', 'working.lgd'), source);
        await nextTurn();
        await nextTurn();

        expect(FileIO.writeFileContents).toHaveBeenCalledWith(path.join('workspace', 'working.js'), result.code);
        expect(result.code).toContain('The count.');
    });

    test('saving valid LGD writes the compiled .js next to the source', async () =>
    {
        vscode.window.createStatusBarItem.mockClear();

        saveLgdDocument(path.join('workspace', 'working.lgd'), 'Number x = 1;');
        await nextTurn();
        await nextTurn();

        expect(FileIO.writeFileContents).toHaveBeenCalledTimes(1);
        expect(FileIO.writeFileContents).toHaveBeenCalledWith(
            path.join('workspace', 'working.js'),
            '/** @type {number} */\nlet x = 1;'
        );
        expect(vscode.window.createStatusBarItem).not.toHaveBeenCalled();
    });
});
