const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');

/** @description Uri of the LGD document used across language service tests. */
const LGD_URI = 'file:///workspace/examples/Calculator.lgd';

/** @description Character where the variable name starts in 'Number value = 0;'. */
const NAME_START_CHARACTER = 7;

/** @description Length of the variable name 'value'. */
const NAME_LENGTH = 5;

/**
 * @description Creates a language service with a recording diagnostic collection.
 * @returns {object} the service and its recordings.
 */
function createService()
{
    const setCalls = [];
    const deleted = [];
    const diagnosticCollection = {
        set: (uri, diagnostics) => setCalls.push({ uri: uri, diagnostics: diagnostics }),
        delete: uri => deleted.push(uri)
    };
    const errors = [];
    const service = LgdLanguageService.create(diagnosticCollection, error => errors.push(error));

    return { service: service, setCalls: setCalls, deleted: deleted, errors: errors };
}

/**
 * @description Reads text from the compiled mirror at a position.
 * @param {object} service the language service.
 * @param {object} uri the LGD document uri.
 * @param {object} position the mirror position.
 * @param {number} length how many characters to read.
 * @returns {string} the mirror text.
 */
function mirrorTextAt(service, uri, position, length)
{
    const state = service.getState(uri);
    const offset = state.jsDocument.offsetAt(position);

    return state.jsDocument.getText().slice(offset, offset + length);
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() =>
{
    vscode.__reset();
    vscode.workspace.openTextDocument.mockClear();
    vscode.workspace.applyEdit.mockClear();
    vscode.commands.executeCommand.mockReset();
});

describe('LgdLanguageService', () =>
{
    test('openDocument compiles the LGD text into a JavaScript mirror', async () =>
    {
        const { service } = createService();
        const document = makeTextDocument(LGD_URI, 'Number value = 0;\n');

        const state = await service.openDocument(document);

        expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
        expect(state.jsDocument.getText()).toContain('let value = 0;');
        expect(state.map).toBeTruthy();
        expect(state.jsDocument.getText()).toContain('//# lgd-source="/workspace/examples/Calculator.lgd"');
    });

    test('positions roundtrip between LGD source and compiled output', async () =>
    {
        const { service } = createService();
        const document = makeTextDocument(LGD_URI, 'Number value = 0;\n');
        await service.openDocument(document);

        const jsPosition = service.toJsPosition(document.uri, new vscode.Position(0, NAME_START_CHARACTER));

        expect(jsPosition).toBeTruthy();
        expect(mirrorTextAt(service, document.uri, jsPosition, NAME_LENGTH)).toBe('value');

        const backToLgd = service.toLgdPosition(document.uri, jsPosition);
        expect(backToLgd.line).toBe(0);
        expect(backToLgd.character).toBe(NAME_START_CHARACTER);
    });

    test('updateDocument recompiles and refreshes the mirror content', async () =>
    {
        const { service } = createService();
        const document = makeTextDocument(LGD_URI, 'Number value = 0;\n');
        const state = await service.openDocument(document);

        document.setText('Number value = 0;\nString name = "Andrew";\n');
        await service.updateDocument(document);

        expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
        expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
        expect(state.jsDocument.getText()).toContain('let name = "Andrew";');
    });

    test('compiler errors are published as diagnostics on the LGD document', async () =>
    {
        const { service, setCalls } = createService();
        const document = makeTextDocument(LGD_URI, 'Number = 0;\nNumber ok = 1;\n');

        await service.openDocument(document);

        expect(setCalls).toHaveLength(1);
        expect(setCalls[0].uri).toBe(document.uri);
        expect(setCalls[0].diagnostics).toHaveLength(1);
        expect(setCalls[0].diagnostics[0].message).toContain('Invalid typed declaration');
        expect(setCalls[0].diagnostics[0].range.start.line).toBe(0);
    });

    test.each([
        [ '42, "Title"', '42' ],
        [ '42 /* explanation */, "Title"', '42' ],
        [ '"command"', '"command"' ],
        [ '', '' ],
        [ '\r\n        "command"\r\n    ', '\r\n        "command"\r\n    ' ]
    ])('base diagnostics preserve exact argument ranges inside parentheses with CRLF: %s', async (argumentsText, highlighted) =>
    {
        const { service, setCalls } = createService();
        const source = [
            'class Parent { Parent(String command, String title) {} }',
            'class Child : Parent {',
            `    Child() : base(${argumentsText}) {}`,
            '}'
        ].join('\r\n');
        const document = makeTextDocument(LGD_URI, source);
        const state = await service.openDocument(document);
        const start = source.indexOf('base(') + 'base('.length;
        const end = start + highlighted.length;

        expect(state.errors).toHaveLength(1);
        expect(state.errors[0].offset).toBe(start);
        expect(state.errors[0].endOffset).toBe(end);
        expect(setCalls[0].diagnostics).toHaveLength(1);
        const diagnostic = setCalls[0].diagnostics[0];
        expect(diagnostic.range).toEqual(new vscode.Range(document.positionAt(start), document.positionAt(end)));
        expect(document.getText(diagnostic.range)).toBe(highlighted);
    });

    test('closeDocument drops the state and clears diagnostics', async () =>
    {
        const { service, deleted } = createService();
        const document = makeTextDocument(LGD_URI, 'Number value = 0;\n');
        await service.openDocument(document);

        service.closeDocument(document);

        expect(service.getState(document.uri)).toBeUndefined();
        expect(deleted).toEqual([document.uri]);
    });
});

describe('LgdLanguageService asynchronous lifecycle', () =>
{
    test('a closing document cannot publish diagnostics or replace a reopened mirror', async () =>
    {
        const { service, setCalls } = createService();
        const original = makeTextDocument(LGD_URI, 'Number oldValue = 1;');
        let releaseMirror;
        let started;
        const mirrorGate = new Promise(resolve =>
        {
            releaseMirror = resolve;
        });
        const mirrorStarted = new Promise(resolve =>
        {
            started = resolve;
        });
        vscode.workspace.openTextDocument.mockImplementationOnce(async options =>
        {
            started();
            await mirrorGate;
            return makeTextDocument('untitled:old-mirror', options.content);
        });

        const firstOpen = service.openDocument(original);
        await mirrorStarted;
        service.closeDocument(original);
        const reopened = makeTextDocument(LGD_URI, 'String newValue = "ready";');
        const current = await service.openDocument(reopened);
        releaseMirror();
        await firstOpen;

        expect(service.getState(reopened.uri)).toBe(current);
        expect(current.jsDocument.getText()).toContain('let newValue = "ready";');
        expect(setCalls).toHaveLength(1);
        expect(setCalls[0].uri).toBe(reopened.uri);
    });

    test('a rejected mirror edit does not install mappings for unapplied code', async () =>
    {
        const { service, errors, setCalls } = createService();
        const document = makeTextDocument(LGD_URI, 'Number value = 1;');
        const state = await service.openDocument(document);
        const originalMap = state.map;
        vscode.workspace.applyEdit.mockResolvedValueOnce(false);
        document.setText('String label = "ready";');

        await expect(service.updateDocument(document)).rejects.toThrow('JavaScript mirror');
        expect(state.map).toBe(originalMap);
        expect(setCalls).toHaveLength(1);
        expect(errors).toHaveLength(1);

        await service.updateDocument(document);
        expect(state.jsDocument.getText()).toContain('let label = "ready";');
        expect(setCalls).toHaveLength(2);
    });
});

describe('LgdLanguageService cross-file source reading', () =>
{
    let directory;

    beforeEach(async () =>
    {
        directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-editor-'));
    });

    afterEach(async () =>
    {
        await fs.promises.rm(directory, { recursive: true, force: true });
    });

    test('reads the real exported declaration and its create-assigned members from disk', async () =>
    {
        const { service } = createService();
        const sourcePath = path.join(directory, 'Service.lgd');
        await fs.promises.writeFile(sourcePath, [
            'Number Wrong = 1;',
            '// module.exports = Wrong;',
            'String sample = "module.exports = Wrong;";',
            'Object Service = { create() { this.ready = true; return this; }, run() {} };',
            'module.exports = Service;'
        ].join('\n'));

        const exported = await service.readExportDeclaration(sourcePath);

        expect(exported.name).toBe('Service');
        expect(exported.members.map(member => member.name)).toEqual([ 'create', 'run', 'ready' ]);
    });

    test('prefers current open LGD text over stale disk exports', async () =>
    {
        const { service } = createService();
        const sourcePath = path.join(directory, 'Service.lgd');
        await fs.promises.writeFile(sourcePath, 'Number Service = 1;\nmodule.exports = Service;');
        const document = makeTextDocument(`file://${sourcePath}`, 'String Service = "updated";\nmodule.exports = Service;');
        await service.openDocument(document);

        expect((await service.readExportDeclaration(sourcePath)).typeName).toBe('String');
    });

    test('only executable relative require calls contribute external types', async () =>
    {
        const { service } = createService();
        await fs.promises.writeFile(path.join(directory, 'Value.lgd'), 'Number Value = 1;\nmodule.exports = Value;');
        const document = makeTextDocument(`file://${path.join(directory, 'Main.lgd')}`, [
            '// require("./Commented.js")',
            'String example = "require(\'./Quoted.js\')";',
            'Number actual = require("./Value.js");'
        ].join('\n'));
        const readExport = jest.spyOn(service, 'readExportDeclaration');

        expect((await service.collectExternalTypes(document)).get('./Value.js')).toEqual({ exportName: 'Value', keyword: 'Number' });
        expect(readExport).toHaveBeenCalledTimes(1);
    });
});
