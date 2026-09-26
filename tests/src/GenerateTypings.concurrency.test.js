const GenerateTypings = require('../../src/GenerateTypings');
const FileParser = require('../../src/Parsers/FileParser');
const Logger = require('../../src/Logging/Logger');
const FileIO = require('../../src/Logging/FileIO');
const VscodeError = require('../../src/Errors/VscodeError');
const StatusBarMessage = require('../../src/Logging/StatusBarMessage');
const vscode = require('vscode');

let previousLgd;
let diagnostics;
let compilations;

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
        getText: () => source
    };
    const compilation = GenerateTypings.create(document, lgd.lgdDiagnosticCollection);
    compilations.push(compilation);
    return compilation;
}

jest.unmock('../../src/Errors/VscodeError');
jest.mock('../../src/Logging/FileIO', () => ({ writeFileContents: jest.fn() }));
jest.mock('vscode', () => ({
    workspace: { rootPath: 'workspace' },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    StatusBarAlignment: { Left: 1 },
    Range: jest.fn((...coordinates) => ({ coordinates: coordinates })),
    Diagnostic: jest.fn((range, message, severity) => ({ range: range, message: message, severity: severity })),
    window: {
        setStatusBarMessage: jest.fn(() => ({ dispose: jest.fn() })),
        createStatusBarItem: jest.fn(() => ({ show: jest.fn(), hide: jest.fn() }))
    }
}));

beforeEach(() =>
{
    previousLgd = globalThis.lgd;
    diagnostics = new Map();
    compilations = [];
    globalThis.lgd = {
        configuration: { tabSize: 2, createDebugLog: true },
        logger: Logger.create('parser'),
        lgdDiagnosticCollection: {
            set: (uri, entries) => diagnostics.set(uri.fsPath, entries),
            get: uri => diagnostics.get(uri.fsPath)
        }
    };
    FileIO.writeFileContents.mockReset();
    FileIO.writeFileContents.mockResolvedValue();
});

afterEach(() =>
{
    for(const compilation of compilations)
    {
        compilation.compilationContext.statusBar.hideError();
    }

    StatusBarMessage.hideError();
    jest.restoreAllMocks();
    globalThis.lgd = previousLgd;
});

test('parallel compilations keep diagnostics, log headings and status messages with their documents', async () =>
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
    await first;
    expect(diagnostics.get('First.js')).toHaveLength(1);
    expect(diagnostics.has('Second.js')).toBe(false);
    secondGate.resolve();
    await second;
    expect(diagnostics.get('First.js')[0].message).toContain('FirstValue');
    expect(diagnostics.get('Second.js')[0].message).toContain('SecondValue');
    expect(diagnostics.get('First.js')).not.toBe(diagnostics.get('Second.js'));
    expect(VscodeError.currentDocument).toBeNull();
    expect(lgd.logger.log.filter(entry => entry.includes('First.js'))).toHaveLength(1);
    expect(lgd.logger.log.filter(entry => entry.includes('Second.js'))).toHaveLength(1);
    const displayedStatuses = vscode.window.createStatusBarItem.mock.results.map(result => result.value);
    expect(displayedStatuses[1].hide).not.toHaveBeenCalled();
    lgd.logger.notifyUser();
    expect(diagnostics.get('First.js').map(entry => entry.message)).toContain('LGD: Check log!');
    expect(diagnostics.get('Second.js').map(entry => entry.message)).toContain('LGD: Check log!');
    const savedLog = FileIO.writeFileContents.mock.calls.pop()[1];
    expect(savedLog).toContain('First.js');
    expect(savedLog).toContain('Second.js');
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
