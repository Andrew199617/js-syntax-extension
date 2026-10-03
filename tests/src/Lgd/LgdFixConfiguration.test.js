const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdFixConfiguration = require('../../../src/Editors/VSCode/LgdFixConfiguration');
const LgdFixGlob = require('../../../src/Lgd/Fixes/LgdFixGlob');
const createQuickFixRegistry = require('../../../src/Lgd/QuickFixes/QuickFixRegistry');
const configurationSchema = require('../../../schemas/lgd.schema.json');
const LgdFormattingSources = require('../../../src/Lgd/Formatting/LgdFormattingSources');
const LgdFormattingPolicy = require('../../../src/Lgd/Fixes/LgdFormattingPolicy');

/** @description Writes a JSON configuration in a real temporary workspace. */
async function writeConfiguration(directory, configuration, name = '.vscode/lgd.json')
{
    const configPath = path.join(directory, name);
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    const text = typeof configuration === 'string' ? configuration : JSON.stringify(configuration);
    await fs.promises.writeFile(configPath, text);
    return configPath;
}

/** @description Makes a source or configuration buffer rooted in the test workspace. */
function makeDocument(directory, name, text = '')
{
    const document = makeTextDocument(`file://${path.join(directory, name)}`, text);
    document.version = 1;
    document.languageId = name.endsWith('.lgd') ? 'lgd' : 'json';
    return document;
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

describe('LGD project fix configuration', () =>
{
    let directory;
    let reader;
    let diagnosticEntries;

    beforeEach(async () =>
    {
        directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-fix-configuration-'));
        diagnosticEntries = new Map();
        vscode.Uri = { file: sourcePath => makeTextDocument(`file://${sourcePath}`, '').uri };
        vscode.workspace.textDocuments = [];
        vscode.workspace.getWorkspaceFolder = jest.fn(() => ({ uri: vscode.Uri.file(directory) }));
        vscode.languages.createDiagnosticCollection = jest.fn(() => ({
            set: (uri, diagnostics) => diagnosticEntries.set(uri.fsPath, diagnostics),
            delete: uri => diagnosticEntries.delete(uri.fsPath),
            dispose: jest.fn()
        }));

        reader = LgdFixConfiguration.create();
    });

    afterEach(async () =>
    {
        reader.dispose();
        jest.restoreAllMocks();
        delete vscode.workspace.createFileSystemWatcher;
        delete vscode.workspace.onDidChangeTextDocument;
        delete vscode.workspace.onDidOpenTextDocument;
        delete vscode.workspace.onDidCloseTextDocument;
        delete vscode.workspace.onDidChangeWorkspaceFolders;
        await fs.promises.rm(directory, { recursive: true, force: true });
    });

    test('defaults to disabled automatic fixes with no explicit rule overrides', async () =>
    {
        const document = makeDocument(directory, 'src/Example.lgd');
        const result = await reader.resolve(document);
        expect(result).toMatchObject({ valid: true, ignored: false, autoFix: false, rules: {}, root: directory, configPath: null });
        expect(result.configSnapshots.every(snapshot => snapshot.text === null)).toBe(true);
        expect(await reader.isCurrent(document, result)).toBe(true);
    });

    test('untitled and non-workspace files use manual defaults without configuration', async () =>
    {
        await writeConfiguration(directory, { version: 1, autoFix: true });
        const unsaved = await reader.resolve(makeTextDocument('untitled:Example.lgd', ''));
        expect(unsaved).toMatchObject({ valid: true, ignored: false, autoFix: false, rules: {}, root: null, configSnapshots: [] });
        vscode.workspace.getWorkspaceFolder.mockReturnValue();
        expect(await reader.resolve(makeDocument(directory, 'Example.lgd'))).toMatchObject(unsaved);
    });

    test('uses the nearest config as an isolated project boundary', async () =>
    {
        await writeConfiguration(directory, { version: 1, autoFix: true, rules: { 'readonly-variable-declaration': { fix: 'automatic' } } });
        const nestedRoot = path.join(directory, 'packages', 'game');
        const configPath = await writeConfiguration(nestedRoot, { version: 1, rules: { 'return-type-documentation': { fix: 'off' } } });
        const result = await reader.resolve(makeDocument(nestedRoot, 'src/Example.lgd'));
        expect(result).toMatchObject({ valid: true, root: nestedRoot, configPath: configPath, autoFix: false, rules: { 'return-type-documentation': { fix: 'off' } } });
        expect(result.rules['readonly-variable-declaration']).toBeUndefined();
    });

    test('merges parent configs before local settings and ordered matching overrides', async () =>
    {
        await writeConfiguration(directory, {
            version: 1, autoFix: true, rules: { 'readonly-variable-declaration': { fix: 'automatic' }, 'virtual-documentation': { fix: 'automatic' } },
            ignores: ['legacy/**'], overrides: [{ files: ['src/**'], rules: { 'readonly-variable-declaration': { fix: 'off' } } }]
        }, 'shared/base.json');
        await writeConfiguration(directory, { version: 1, rules: { 'virtual-documentation': { fix: 'manual' } } }, 'shared/second.json');
        await writeConfiguration(directory, {
            version: 1, extends: [ '../shared/base.json', '../shared/second.json' ],
            rules: { 'readonly-variable-declaration': { fix: 'manual' } },
            overrides: [
                { files: ['src/**/*.lgd'], rules: { 'readonly-variable-declaration': { fix: 'automatic' } } },
                { files: ['src/test?.lgd'], ignores: ['src/test2.lgd'], rules: { 'readonly-variable-declaration': { fix: 'off' } } }
            ]
        });
        const first = await reader.resolve(makeDocument(directory, 'src/test1.lgd'));
        expect(first).toMatchObject({ valid: true, autoFix: true, rules: { 'readonly-variable-declaration': { fix: 'off' }, 'virtual-documentation': { fix: 'manual' } } });
        const second = await reader.resolve(makeDocument(directory, 'src/test2.lgd'));
        expect(second.ignored).toBe(false);
        expect(second.rules['readonly-variable-declaration'].fix).toBe('automatic');
        expect((await reader.resolve(makeDocument(directory, 'legacy/Old.lgd'))).ignored).toBe(true);
    });

    test.each([
        'node_modules/lib/File.lgd',
        '.git/File.lgd',
        'dist/File.lgd',
        'build/File.lgd',
        'coverage/File.lgd',
        'vendor/File.lgd',
        'generated/File.lgd',
        'typings/File.lgd',
        'tests/mocks/File.lgd',
        'tests/__mocks__/File.lgd',
        'src/Example.generated.lgd',
        'src/Example.d.ts'
    ])('hard excludes %s even when overrides enable fixes', async name =>
    {
        await writeConfiguration(directory, {
            version: 1, autoFix: true, overrides: [{ files: ['**'], rules: { 'readonly-variable-declaration': { fix: 'automatic' } } }]
        });
        const result = await reader.resolve(makeDocument(directory, name));
        expect(result.valid).toBe(true);
        expect(result.ignored).toBe(true);
    });

    test.each([
        '{ "version": 1, }',
        '{ /* comments */ "version": 1 }',
        '[]',
        'null',
        '{}',
        '{"version":2}',
        '{"version":1,"unknown":true}',
        '{"version":1,"autoFix":"true"}',
        '{"version":1,"$schema":4}',
        '{"version":1,"rules":{"not-a-rule":{"fix":"automatic"}}}',
        '{"version":1,"rules":{"readonly-variable-declaration":"automatic"}}',
        '{"version":1,"rules":{"readonly-variable-declaration":{"fix":"on"}}}',
        '{"version":1,"rules":{"readonly-variable-declaration":{"fix":"off","extra":true}}}',
        '{"version":1,"rules":{"__proto__":{"fix":"automatic"}}}',
        '{"version":1,"ignores":["!src/**"]}',
        '{"version":1,"ignores":"src/**"}',
        '{"version":1,"overrides":[{"files":[],"rules":{}}]}',
        '{"version":1,"overrides":[{"files":["**"],"autoFix":true}]}',
        '{"version":1,"extends":"package-name"}',
        '{"version":1,"extends":"https://example.com/settings.json"}',
        '{"version":1,"extends":"./settings.js"}'
    ])('invalid configuration fails closed and emits a diagnostic: %s', async configuration =>
    {
        const configPath = await writeConfiguration(directory, configuration);
        const document = makeDocument(directory, 'Example.lgd');
        const result = await reader.resolve(document);
        expect(result).toMatchObject({ valid: false, autoFix: false, rules: {} });
        expect(diagnosticEntries.get(configPath)[0]).toMatchObject({ source: 'LGD configuration', severity: vscode.DiagnosticSeverity.Error });
        expect(await reader.isCurrent(document, result)).toBe(false);
    });

    test('accepts supplied registry IDs and rejects unregistered default IDs', async () =>
    {
        reader.dispose();
        reader = LgdFixConfiguration.create(['future-rule']);
        await writeConfiguration(directory, { version: 1, rules: { 'future-rule': { fix: 'manual' } } });
        expect((await reader.resolve(makeDocument(directory, 'Example.lgd'))).valid).toBe(true);
        await writeConfiguration(directory, { version: 1, rules: { 'readonly-variable-declaration': { fix: 'manual' } } });
        expect((await reader.resolve(makeDocument(directory, 'Example.lgd'))).valid).toBe(false);
    });

    test('unsaved root and inherited buffers override disk and invalidate prepared fixes', async () =>
    {
        await writeConfiguration(directory, { version: 1, extends: '../shared/base.json' });
        await writeConfiguration(directory, { version: 1, autoFix: true }, 'shared/base.json');
        const document = makeDocument(directory, 'Example.lgd');
        const previous = await reader.resolve(document);
        const inherited = makeDocument(directory, 'shared/base.json', '{"version":1,"autoFix":false}');
        vscode.workspace.textDocuments = [inherited];
        expect(await reader.isCurrent(document, previous)).toBe(false);
        expect((await reader.resolve(document)).autoFix).toBe(false);
        const root = makeDocument(directory, '.vscode/lgd.json', '{');
        vscode.workspace.textDocuments.push(root);
        expect((await reader.resolve(document)).valid).toBe(false);
        root.setText('{"version":1,"autoFix":true}');
        root.version++;
        const result = await reader.resolve(document);
        expect(result.valid).toBe(true);
        expect(result.autoFix).toBe(true);
        expect(diagnosticEntries.has(root.uri.fsPath)).toBe(false);
        root.version++;
        expect(await reader.isCurrent(document, result)).toBe(false);
    });

    test('reads newly created unsaved config files without requiring a disk file', async () =>
    {
        const document = makeDocument(directory, 'Example.lgd');
        const initial = await reader.resolve(document);
        vscode.workspace.textDocuments = [makeDocument(directory, '.vscode/lgd.json', '{"version":1,"autoFix":true}')];
        expect(await reader.isCurrent(document, initial)).toBe(false);
        expect(await reader.resolve(document)).toMatchObject({ valid: true, autoFix: true, root: directory });
    });

    test('an opened config buffer wins over a disk read already in progress', async () =>
    {
        await writeConfiguration(directory, { version: 1, autoFix: true });
        const document = makeDocument(directory, 'Example.lgd');
        let notifyRead;
        let releaseRead;
        const started = new Promise(resolve =>
        {
            notifyRead = resolve;
        });
        const blocked = new Promise(resolve =>
        {
            releaseRead = resolve;
        });
        jest.spyOn(fs.promises, 'readFile').mockImplementationOnce(() =>
        {
            notifyRead();
            return blocked;
        });

        const resolving = reader.resolve(document);
        await started;
        vscode.workspace.textDocuments = [makeDocument(directory, '.vscode/lgd.json', '{"version":1,"autoFix":false}')];
        releaseRead('{"version":1,"autoFix":true}');
        expect(await resolving).toMatchObject({ valid: true, autoFix: false });
    });

    test('final synchronous guards reject config edits while a later inherited read is pending', async () =>
    {
        await writeConfiguration(directory, { version: 1 }, 'shared/base.json');
        const config = makeDocument(directory, '.vscode/lgd.json', '{"version":1,"extends":"../shared/base.json","autoFix":true}');
        vscode.workspace.textDocuments = [config];
        const document = makeDocument(directory, 'Example.lgd');
        const initial = await reader.resolve(document);
        expect(reader.buffersCurrent(initial)).toBe(true);
        let notifyRead;
        let releaseRead;
        const started = new Promise(resolve =>
        {
            notifyRead = resolve;
        });
        const blocked = new Promise(resolve =>
        {
            releaseRead = resolve;
        });
        jest.spyOn(fs.promises, 'readFile').mockImplementationOnce(() =>
        {
            notifyRead();
            return blocked;
        });

        const checking = reader.isCurrent(document, initial);
        await started;
        config.setText('{"version":1,"autoFix":false}');
        config.version++;
        releaseRead('{"version":1}');
        expect(await checking).toBe(false);
        expect(reader.buffersCurrent(initial)).toBe(false);
    });

    test('synchronous guards reject newly opened, closed, or newly created config buffers', async () =>
    {
        const document = makeDocument(directory, 'Example.lgd');
        const missing = await reader.resolve(document);
        const config = makeDocument(directory, '.vscode/lgd.json', '{"version":1}');
        vscode.workspace.textDocuments = [config];
        expect(reader.buffersCurrent(missing)).toBe(false);
        const opened = await reader.resolve(document);
        expect(reader.buffersCurrent(opened)).toBe(true);
        vscode.workspace.textDocuments = [];
        expect(reader.buffersCurrent(opened)).toBe(false);
        await writeConfiguration(directory, { version: 1 });
        const onDisk = await reader.resolve(document);
        vscode.workspace.textDocuments = [config];
        expect(reader.buffersCurrent(onDisk)).toBe(false);
    });

    test('bounds configuration sizes, pattern counts, and override counts', async () =>
    {
        const document = makeDocument(directory, 'Example.lgd');
        const tooManyEntries = 257;
        await writeConfiguration(directory, { version: 1, ignores: new Array(tooManyEntries).fill('src/**') });
        expect((await reader.resolve(document)).valid).toBe(false);
        const tooLongPattern = 513;
        await writeConfiguration(directory, { version: 1, ignores: ['a'.repeat(tooLongPattern)] });
        expect((await reader.resolve(document)).valid).toBe(false);
        const tooManyOverrides = 101;
        await writeConfiguration(directory, { version: 1, overrides: new Array(tooManyOverrides).fill({ files: ['**'] }) });
        expect((await reader.resolve(document)).valid).toBe(false);
        const oversizedLength = 262145;
        const oversized = ' '.repeat(oversizedLength);
        await writeConfiguration(directory, oversized);
        expect((await reader.resolve(document)).valid).toBe(false);
        vscode.workspace.textDocuments = [makeDocument(directory, '.vscode/lgd.json', oversized)];
        expect((await reader.resolve(document)).valid).toBe(false);
    });

    test('detects disk edits, deletion, and a newly created nearer config', async () =>
    {
        const configPath = await writeConfiguration(directory, { version: 1, autoFix: true });
        const document = makeDocument(directory, 'src/Example.lgd');
        const initial = await reader.resolve(document);
        await writeConfiguration(directory, { version: 1, autoFix: false });
        expect(await reader.isCurrent(document, initial)).toBe(false);
        const updated = await reader.resolve(document);
        await fs.promises.unlink(configPath);
        expect(await reader.isCurrent(document, updated)).toBe(false);
        const missing = await reader.resolve(document);
        await writeConfiguration(path.join(directory, 'src'), { version: 1 });
        expect(await reader.isCurrent(document, missing)).toBe(false);
    });

    test('fails closed when inheritance is missing, circular, or too deep', async () =>
    {
        const document = makeDocument(directory, 'Example.lgd');
        await writeConfiguration(directory, { version: 1, extends: './missing.json' });
        expect((await reader.resolve(document)).valid).toBe(false);
        await writeConfiguration(directory, { version: 1, extends: './lgd.json' });
        expect((await reader.resolve(document)).valid).toBe(false);
        await writeConfiguration(directory, { version: 1, extends: './one.json' });
        await writeConfiguration(directory, { version: 1, extends: './lgd.json' }, '.vscode/one.json');
        expect((await reader.resolve(document)).valid).toBe(false);
        const maximumDepth = 10;
        for(let index = 0; index <= maximumDepth; index++)
        {
            await writeConfiguration(directory, { version: 1, extends: `./depth-${index + 1}.json` }, `.vscode/depth-${index}.json`);
        }

        await writeConfiguration(directory, { version: 1, extends: './depth-0.json' });
        expect((await reader.resolve(document)).valid).toBe(false);
        expect([...diagnosticEntries.values()].some(entries => entries[0].message.includes('10 levels'))).toBe(true);
    });

    test('rejects lexical and symlink workspace escapes without reading the outside config', async () =>
    {
        const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-outside-'));
        try
        {
            const outsidePath = await writeConfiguration(outside, { version: 1, autoFix: true }, 'outside.json');
            const document = makeDocument(directory, 'Example.lgd');
            const reference = path.relative(path.join(directory, '.vscode'), outsidePath).split(path.sep).join('/');
            await writeConfiguration(directory, { version: 1, extends: reference });
            const readFile = jest.spyOn(fs.promises, 'readFile');
            expect((await reader.resolve(document)).valid).toBe(false);
            expect(readFile.mock.calls.some(([file]) => file === outsidePath)).toBe(false);
            await fs.promises.symlink(outsidePath, path.join(directory, '.vscode', 'linked.json'));
            await writeConfiguration(directory, { version: 1, extends: './linked.json' });
            expect((await reader.resolve(document)).valid).toBe(false);
            expect(readFile.mock.calls.some(([file]) => file.endsWith('linked.json'))).toBe(false);
            await fs.promises.symlink(outside, path.join(directory, 'linked-sources'));
            expect((await reader.resolve(makeDocument(directory, 'linked-sources/Example.lgd'))).valid).toBe(false);
        }
        finally
        {
            await fs.promises.rm(outside, { recursive: true, force: true });
        }
    });

    test('isolates multiple workspace roots and invalidates changed workspace ownership', async () =>
    {
        const first = path.join(directory, 'first');
        const second = path.join(directory, 'second');
        await writeConfiguration(first, { version: 1, autoFix: true });
        await writeConfiguration(second, { version: 1, autoFix: false });
        vscode.workspace.getWorkspaceFolder.mockImplementation(uri => ({ uri: vscode.Uri.file(uri.fsPath.startsWith(first) ? first : second) }));
        const firstDocument = makeDocument(first, 'Example.lgd');
        const result = await reader.resolve(firstDocument);
        expect(result).toMatchObject({ root: first, autoFix: true });
        expect(await reader.resolve(makeDocument(second, 'Example.lgd'))).toMatchObject({ root: second, autoFix: false });
        vscode.workspace.getWorkspaceFolder.mockReturnValue();
        expect(await reader.isCurrent(firstDocument, result)).toBe(false);
    });

    test('does not exclude workspace ancestors but excludes physical generated targets', async () =>
    {
        const workspaceRoot = path.join(directory, 'build', 'project');
        await writeConfiguration(workspaceRoot, { version: 1 });
        vscode.workspace.getWorkspaceFolder.mockReturnValue({ uri: vscode.Uri.file(workspaceRoot) });
        expect((await reader.resolve(makeDocument(workspaceRoot, 'src/Example.lgd'))).ignored).toBe(false);
        await fs.promises.mkdir(path.join(workspaceRoot, 'generated'));
        await fs.promises.symlink(path.join(workspaceRoot, 'generated'), path.join(workspaceRoot, 'sources'));
        expect((await reader.resolve(makeDocument(workspaceRoot, 'sources/Example.lgd'))).ignored).toBe(true);
    });

    test('native style options and per-option policies merge after declarative imports', async () =>
    {
        reader.formattingSources = LgdFormattingSources;
        const nativeIndentSize = 4;
        const editorConfig = await writeConfiguration(directory, '[*.lgd]\nindent_style = space\nindent_size = 2\n', '.editorconfig');
        await writeConfiguration(directory, { version: 1, formatting: { enabled: true, sources: ['editorconfig'], options: { indentation: { size: 8 } } },
            rules: { 'lgd.format.indentation': { fix: 'automatic', severity: 'error', options: { size: nativeIndentSize } },
                'lgd.format.indentation.size': { fix: 'manual' } } });
        const document = makeDocument(directory, 'Example.lgd');
        const result = await reader.resolve(document);
        expect(result.valid).toBe(true);
        expect(result.formatting.options.indentation.size).toBe(nativeIndentSize);
        expect(LgdFormattingPolicy.setting('lgd.format.indentation.size', result.rules)).toMatchObject({ fix: 'manual', severity: 'error' });
        expect(result.configSnapshots.some(snapshot => snapshot.path === editorConfig)).toBe(true);
        await fs.promises.writeFile(editorConfig, '[*.lgd]\nindent_size = 3\n');
        expect(await reader.isCurrent(document, result)).toBe(false);
    });

    test.each([
        { enabled: 'yes' },
        { enabled: true, sources: ['executable-config'] },
        { enabled: true, sources: [ 'eslint', 'eslint' ] },
        { options: { spacing: { unknown: true } } },
        { options: { indentation: { size: 0 } } },
        { options: { braces: { wrapping: { constructors: 'nextLine' }, style: 'invented' } } }
    ])('invalid native style settings fail closed: %p', async formatting =>
    {
        await writeConfiguration(directory, { version: 1, formatting: formatting });
        expect((await reader.resolve(makeDocument(directory, 'Example.lgd'))).valid).toBe(false);
    });

    test('configuration events refresh diagnostics without editing source documents', async () =>
    {
        const callbacks = {};
        const disposable = { dispose: jest.fn() };
        vscode.workspace.onDidChangeTextDocument = callback =>
        {
            callbacks.change = callback;
            return disposable;
        };

        vscode.workspace.onDidOpenTextDocument = callback =>
        {
            callbacks.open = callback;
            return disposable;
        };

        vscode.workspace.onDidCloseTextDocument = callback =>
        {
            callbacks.close = callback;
            return disposable;
        };

        const config = makeDocument(directory, '.vscode/lgd.json', '{');
        vscode.workspace.textDocuments = [config];
        const subscriptions = [];
        await reader.register(subscriptions);
        expect(diagnosticEntries.get(config.uri.fsPath)).toHaveLength(1);
        config.setText('{"version":1}');
        await callbacks.change({ document: config });
        expect(diagnosticEntries.has(config.uri.fsPath)).toBe(false);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
        expect(subscriptions).toContain(reader);
        reader.dispose();
        await callbacks.change({ document: config });
        expect(diagnosticEntries.size).toBe(0);
    });
});

test('configuration schema rule IDs stay aligned with the real strategy registry', () =>
{
    const registryIds = [...new Set(Array.from(createQuickFixRegistry().values(), handler => handler.ruleId))].sort();
    expect(Object.keys(configurationSchema.definitions.rules.properties).sort()).toEqual(registryIds);
});

describe('bounded LGD configuration globs', () =>
{
    test.each([
        [ '**/*.lgd', 'File.lgd', true ],
        [ '**/*.lgd', 'one/two/File.lgd', true ],
        [ '*.lgd', 'one/File.lgd', false ],
        [ 'src/', 'src/deep/File.lgd', true ],
        [ 'src/*.lgd', 'src/File.lgd', true ],
        [ 'src/*.lgd', 'src/deep/File.lgd', false ],
        [ 'src/test?.lgd', 'src/test1.lgd', true ],
        [ 'src/test?.lgd', 'src/test12.lgd', false ],
        [ './src/**', 'src/File.lgd', true ],
        [ 'src/**/File.lgd', 'src/File.lgd', true ],
        [ 'src/**/File.lgd', 'src/a/b/File.lgd', true ],
        [ '**', 'src/File.lgd', true ],
        [ 'étoile/*.lgd', 'étoile/File.lgd', true ],
        [ '🎮/*.lgd', '🎮/File.lgd', true ],
        [ '?/*.lgd', '🎮/File.lgd', true ]
    ])('%s matches %s: %s', (pattern, sourcePath, expected) =>
    {
        expect(LgdFixGlob.matches(pattern, sourcePath)).toBe(expected);
    });

    test.each([ '', '../src/**', '/src/**', 'src\\**', '!(src)', '{a,b}/**', '[ab]/**', 'src/**bad', 'src//bad', 'src/./bad', 'src\n/**' ])('rejects unsupported glob %s', pattern =>
    {
        expect(LgdFixGlob.isValidPattern(pattern)).toBe(false);
    });
});
