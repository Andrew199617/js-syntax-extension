const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');

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
        expect(state.jsDocument.getText()).toContain(`//# lgd-source=${JSON.stringify(document.uri.fsPath)}`);
    });

    test('Reports unsupported inheritance while preserving the reported document mirror and unrelated hovers.', async () =>
    {
        const source = await fs.promises.readFile(path.join(__dirname, '../../fixtures/object-inheritance.lgd'), 'utf8');
        const { service, setCalls } = createService();
        const document = makeTextDocument(LGD_URI, source);
        const state = await service.openDocument(document);
        const provider = LgdHoverProvider.create(service);
        expect(setCalls.at(-1).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'inheritance' })]));
        const fieldHover = await provider.provideHover(document, document.positionAt(source.indexOf('test =')));
        expect(fieldHover.contents).toContain('Number GoToAssignment2.test');
        vscode.commands.executeCommand.mockResolvedValue([{ contents: ['let assignmentIndex: number'] }]);
        const position = document.positionAt(source.indexOf('assignmentIndex ='));
        const hover = await provider.provideHover(document, position);
        expect(hover.contents).toEqual(['let assignmentIndex: number']);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.executeHoverProvider', state.jsDocument.uri, service.toJsPosition(document.uri, position));
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

    test.each([ '\n', '\r\n' ])('Save As preserves saved and unsaved preview content while output models refresh with %j', async newline =>
    {
        const { service, errors, setCalls } = createService();
        const options = { javascriptObjectModel: 'oloo' };
        service.getOutputOptions = () => options;
        const document = makeTextDocument(LGD_URI, [
            'class Counter {',
            '    Counter(Number value) { this.value = value; }',
            '}'
        ].join(newline));
        const source = document.getText();
        const state = await service.openDocument(document);
        const originalMirror = state.jsDocument;
        const savedText = originalMirror.getText();
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-saved-mirror-'));
        const savedPath = path.join(directory, 'Preview.js');
        try
        {
            await fs.promises.writeFile(savedPath, savedText);
            const savedPreview = makeTextDocument(`file://${savedPath}`, `${savedText}// unsaved user note\n`);
            const unsavedText = savedPreview.getText();
            originalMirror.isClosed = true;
            options.javascriptObjectModel = 'class';
            await service.updateDocument(document);
            const refreshedMirror = state.jsDocument;
            expect(refreshedMirror).not.toBe(originalMirror);
            expect(refreshedMirror.uri.scheme).toBe('untitled');
            expect(refreshedMirror.getText()).toContain('class Counter');
            expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();

            options.javascriptObjectModel = 'oloo';
            await service.updateDocument(document);
            expect(state.jsDocument).toBe(refreshedMirror);
            expect(state.jsDocument.getText()).toContain('const Counter = {');
            expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(2);
            expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
            expect(originalMirror.getText()).toBe(savedText);
            expect(savedPreview.getText()).toBe(unsavedText);
            expect(await fs.promises.readFile(savedPath, 'utf8')).toBe(savedText);
            expect(document.getText()).toBe(source);
            expect(errors).toEqual([]);
            expect(setCalls.at(-1).diagnostics).toEqual([]);
        }
        finally
        {
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });

    test('a closed mirror URI recycled for another source is never edited through its stale document', async () =>
    {
        const { service, errors } = createService();
        const original = makeTextDocument(LGD_URI, 'Number firstValue = 1;');
        const originalState = await service.openDocument(original);
        const closedMirror = originalState.jsDocument;
        closedMirror.isClosed = true;
        vscode.__reset();
        const otherSource = makeTextDocument('file:///workspace/Other.lgd', 'String secondValue = "untouched";');
        const otherState = await service.openDocument(otherSource);
        const otherMirror = otherState.jsDocument;
        const otherText = otherMirror.getText();
        expect(otherMirror.uri.toString()).toBe(closedMirror.uri.toString());

        original.setText('Boolean firstReady = true;');
        await service.updateDocument(original);
        expect(originalState.jsDocument).not.toBe(closedMirror);
        expect(originalState.jsDocument.uri.toString()).not.toBe(otherMirror.uri.toString());
        expect(originalState.jsDocument.getText()).toContain('let firstReady = true;');
        expect(otherState.jsDocument).toBe(otherMirror);
        expect(otherMirror.getText()).toBe(otherText);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
        expect(errors).toEqual([]);
    });

    test('records normalized applied text without repeatedly replacing an unchanged CRLF mirror', async () =>
    {
        const { service } = createService();
        const document = makeTextDocument(LGD_URI, 'Number value = 1;\r\nString label = "ready";\r\n');
        const state = await service.openDocument(document);
        const mirror = state.jsDocument;
        await service.syncMirror(state, 'let value = 2;\nlet label = "updated";\n');
        await service.syncMirror(state, 'let value = 3;\nlet label = "still ready";\n');
        expect(state.jsDocument).toBe(mirror);
        expect(state.jsDocument.getText()).toBe('let value = 3;\r\nlet label = "still ready";\r\n');
        expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
        expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(2);
    });

    test.each([ 'closed', 'saved', 'edited', 'plaintext', 'duplicated' ])('replaces the %s preview without modifying its content', async lifecycle =>
    {
        const { service, errors } = createService();
        const document = makeTextDocument(LGD_URI, 'Number value = 1;');
        const state = await service.openDocument(document);
        if(lifecycle === 'saved')
        {
            state.jsDocument = makeTextDocument('file:///workspace/Preview.js', state.jsDocument.getText());
        }

        const preview = state.jsDocument;
        if(lifecycle === 'closed')
        {
            preview.isClosed = true;
        }
        else if(lifecycle === 'plaintext')
        {
            preview.languageId = 'plaintext';
        }
        else if(lifecycle === 'duplicated')
        {
            preview.setText(preview.getText() + preview.getText());
        }
        else if(lifecycle === 'edited')
        {
            preview.setText(`${preview.getText()}// unsaved user note\n`);
        }

        const previewText = preview.getText();
        document.setText('String label = "ready";');
        await service.updateDocument(document);
        expect(state.jsDocument).not.toBe(preview);
        expect(state.jsDocument.languageId).toBe('javascript');
        expect(state.jsDocument.getText()).toContain('let label = "ready";');
        expect(preview.getText()).toBe(previewText);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
        expect(errors).toEqual([]);

        service.closeDocument(document);
        const reopened = makeTextDocument(LGD_URI, 'Boolean ready = true;');
        const current = await service.openDocument(reopened);
        expect(current).not.toBe(state);
        expect(current.jsDocument.getText()).toContain('let ready = true;');
        expect(preview.getText()).toBe(previewText);
    });

    test.each([ 'closed', 'edited' ])('a preview %s during a rejected edit gets a fresh mirror', async lifecycle =>
    {
        const { service, errors, setCalls } = createService();
        const document = makeTextDocument(LGD_URI, 'Number value = 1;');
        const state = await service.openDocument(document);
        const preview = state.jsDocument;
        const previewText = preview.getText();
        vscode.workspace.applyEdit.mockImplementationOnce(() =>
        {
            if(lifecycle === 'closed')
            {
                preview.isClosed = true;
            }
            else
            {
                preview.setText(`${preview.getText()}// unsaved user note\n`);
            }

            return Promise.resolve(false);
        });

        const expectedPreview = lifecycle === 'closed' ? previewText : `${previewText}// unsaved user note\n`;
        document.setText('String label = "ready";');
        await service.updateDocument(document);
        expect(state.jsDocument).not.toBe(preview);
        expect(state.jsDocument.getText()).toContain('let label = "ready";');
        expect(preview.getText()).toBe(expectedPreview);
        expect(errors).toEqual([]);
        expect(setCalls.at(-1).diagnostics).toEqual([]);
    });

    test('a rejected mirror edit does not install mappings for unapplied code', async () =>
    {
        const { service, errors, setCalls } = createService();
        const document = makeTextDocument(LGD_URI, 'Number value = 1;');
        const state = await service.openDocument(document);
        const originalMap = state.map;
        service.diagnosticPolicy = jest.fn(current => Promise.resolve(current.errors));
        vscode.workspace.applyEdit.mockResolvedValueOnce(false);
        document.setText('String label = "ready";');

        await expect(service.updateDocument(document)).rejects.toThrow('JavaScript mirror');
        await service.pendingUpdates.get(document.uri.toString());
        expect(state.errors).toEqual([expect.objectContaining({ code: 'lgd.editor.failure' })]);
        expect(state.map).toBe(originalMap);
        expect(setCalls).toHaveLength(2);
        expect(service.diagnosticPolicy).not.toHaveBeenCalled();
        expect(errors).toHaveLength(1);

        await service.updateDocument(document);
        expect(state.jsDocument.getText()).toContain('let label = "ready";');
        expect(setCalls.at(-1).diagnostics).toEqual([]);
        expect(state.errors).toEqual([]);
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

    test('An imported BaseCommand loop cannot prevent the dependent document from creating its hover mirror.', async () =>
    {
        const { service, errors } = createService();
        const fixtures = path.join(__dirname, '../../fixtures');
        const baseSource = await fs.promises.readFile(path.join(fixtures, 'basecommand.lgd'), 'utf8');
        const source = await fs.promises.readFile(path.join(fixtures, 'object-inheritance.lgd'), 'utf8');
        await fs.promises.writeFile(path.join(directory, 'BaseCommand.lgd'), baseSource);
        const document = makeTextDocument(`file://${path.join(directory, 'GoToAssignment.lgd')}`, source);
        const state = await service.openDocument(document);
        expect(errors).toEqual([]);
        expect(state.jsDocument.getText()).toContain('const GoToAssignment =');
        expect(state.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lgd.object.inheritance' })]));
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
