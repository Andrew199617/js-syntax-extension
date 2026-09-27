const GenerateTypings = require('../../src/GenerateTypings');
const FileParser = require('../../src/Parsers/FileParser');
const Logger = require('../../src/Logging/Logger');
const FileIO = require('../../src/Logging/FileIO');
const VscodeError = require('../../src/Errors/VscodeError');
const StatusBarMessage = require('../../src/Logging/StatusBarMessage');
const vscode = require('vscode');

let previousLgd;
let diagnostics;

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

function createCompilation(name)
{
    const source = `/** @template {number} Item */
const ${name} = {
  ${name}Value: 1,
  ${name}Value: 2
};`;
    const document = {
        fileName: `${name}.js`,
        uri: { fsPath: `${name}.js` },

        /** @description Returns the source text for this test document. */
        getText: () => source
    };
    const compilation = GenerateTypings.create(document, lgd.lgdDiagnosticCollection);
    return compilation;
}

jest.unmock('../../src/Errors/VscodeError');
jest.mock('../../src/Logging/FileIO', () => ({ writeFileContents: jest.fn() }));
jest.mock('vscode', () => ({
    workspace: { rootPath: 'workspace' },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    StatusBarAlignment: { Left: 1 },
    Range: jest.fn((line, character) => ({ start: { line: line, character: character } })),
    Diagnostic: jest.fn((range, message, severity) => ({ range: range, message: message, severity: severity })),
    window: {
        setStatusBarMessage: jest.fn(() => ({ dispose: jest.fn() })),
        createStatusBarItem: jest.fn(() => ({ show: jest.fn(), hide: jest.fn() })),
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn()
    },
    commands: { executeCommand: jest.fn() }
}));

beforeEach(() =>
{
    previousLgd = globalThis.lgd;
    diagnostics = new Map();
    globalThis.lgd = {
        configuration: { tabSize: 2, createDebugLog: true },
        logger: Logger.create('parser'),
        outputChannel: { appendLine: jest.fn(), show: jest.fn() },
        lgdDiagnosticCollection: {
            /** @description Stores diagnostics by the test document path. */
            set: (uri, entries) => diagnostics.set(uri.fsPath, entries),

            /** @description Reads diagnostics for the test document path. */
            get: uri => diagnostics.get(uri.fsPath)
        }
    };
    FileIO.writeFileContents.mockReset();
    FileIO.writeFileContents.mockResolvedValue();
});

afterEach(() =>
{
    StatusBarMessage.hideError();
    jest.restoreAllMocks();
    globalThis.lgd = previousLgd;
});

test.each([
    'class Exported extends Parent {\n  value = 1;\n}',
    'function Exported(props) {\n  return null;\n}'
])('constant inference retains source before removing %s', async exportedDeclaration =>
{
    const source = `const COUNT = 1;
${exportedDeclaration}
export { Exported };
const Example = {
  count: COUNT,
  settings: {
    count: COUNT
  }
};`;
    const document = {
        fileName: 'Example.js',
        uri: { fsPath: 'Example.js' },

        /** @description Returns the source used to verify constant inference. */
        getText: () => source
    };
    const compilation = GenerateTypings.create(document, lgd.lgdDiagnosticCollection);
    const result = await compilation.execute();
    expect(result.compiled).toBe(true);
    expect(result.diagnostics).toEqual([]);
    const declaration = FileIO.writeFileContents.mock.calls[0][1];
    expect(declaration.match(/count: number;/g)).toHaveLength(2);
    expect(declaration).not.toContain('count: any;');
});

test('concurrent compilations keep original constant sources separate', async () =>
{
    const first = createCompilation('First');
    const second = createCompilation('Second');
    first.document.getText = () => 'const COUNT = 1;\nconst Example = {\n  settings: {\n    count: COUNT\n  }\n};';
    second.document.getText = () => 'const COUNT = "text";\nconst Example = {\n  settings: {\n    count: COUNT\n  }\n};';
    const results = await Promise.all([ first.execute(), second.execute() ]);
    expect(results.every(result => result.compiled)).toBe(true);
    const firstWrite = FileIO.writeFileContents.mock.calls.find(([filename]) => filename.endsWith('First.d.ts'));
    const secondWrite = FileIO.writeFileContents.mock.calls.find(([filename]) => filename.endsWith('Second.d.ts'));
    expect(firstWrite[1]).toContain('count: number;');
    expect(secondWrite[1]).toContain('count: string;');
});

test('parallel compilations keep diagnostics and logs with their documents without per-file UI', async () =>
{
    const firstGate = deferred();
    const secondGate = deferred();
    const originalParse = FileParser.parse;

    /** @this {FileParserType} */
    async function parseAfterGate(typeFile, source)
    {
        const gate = source.includes('First') ? firstGate : secondGate;
        await gate.promise;
        return await originalParse.call(this, typeFile, source);
    }

    const parse = jest.spyOn(FileParser, 'parse').mockImplementation(parseAfterGate);

    const first = createCompilation('First').execute();
    const second = createCompilation('Second').execute();
    await nextTurn();
    expect(parse).toHaveBeenCalledTimes(2);
    firstGate.resolve();
    const firstResult = await first;
    expect(diagnostics.get('First.js')).toHaveLength(2);
    expect(diagnostics.has('Second.js')).toBe(false);
    secondGate.resolve();
    const secondResult = await second;
    expect(diagnostics.get('First.js')[1].message).toContain('FirstValue');
    expect(diagnostics.get('Second.js')[1].message).toContain('SecondValue');
    expect(diagnostics.get('First.js')).not.toBe(diagnostics.get('Second.js'));
    expect(VscodeError.currentDocument).toBeNull();
    expect(firstResult.logger.log.join('\n')).toContain('First.js');
    expect(firstResult.logger.log.join('\n')).not.toContain('Second.js');
    expect(secondResult.logger.log.join('\n')).toContain('Second.js');
    expect(FileIO.writeFileContents).not.toHaveBeenCalled();
    expect(vscode.window.createStatusBarItem).not.toHaveBeenCalled();
    expect(vscode.window.setStatusBarMessage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
});

test('single-file compilation keeps issues in Problems and the status bar without popups', async () =>
{
    await createCompilation('Single').executeGenerateTypings();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(1);
    const status = vscode.window.createStatusBarItem.mock.results[0].value;
    expect(status.text).toContain('$(error)');
    expect(status.command).toBe('workbench.action.showErrorsWarnings');
    expect(status.show).toHaveBeenCalledTimes(1);
    expect(diagnostics.get('Single.js')).toHaveLength(2);
    expect(FileIO.writeFileContents).toHaveBeenCalledTimes(1);
});

test('shared log writes finish in order without losing another document', async () =>
{
    const firstWrite = deferred();
    FileIO.writeFileContents.mockReturnValueOnce(firstWrite.promise);
    lgd.logger.log.push('First.js');
    const first = lgd.logger.write();
    await nextTurn();
    lgd.logger.log.push('Second.js');
    const second = lgd.logger.write();
    await nextTurn();
    expect(FileIO.writeFileContents).toHaveBeenCalledTimes(1);
    firstWrite.resolve();
    await Promise.all([ first, second ]);
    expect(FileIO.writeFileContents).toHaveBeenCalledTimes(2);
    const savedLog = FileIO.writeFileContents.mock.calls[1][1];
    expect(savedLog).toContain('First.js');
    expect(savedLog).toContain('Second.js');
});

test('a failed shared log write does not prevent the next write', async () =>
{
    FileIO.writeFileContents.mockRejectedValueOnce(new Error('Cannot write log'));
    const first = lgd.logger.write();
    const second = lgd.logger.write();
    await expect(first).rejects.toThrow('Cannot write log');
    await expect(second).resolves.toBeUndefined();
    expect(FileIO.writeFileContents).toHaveBeenCalledTimes(2);
});
