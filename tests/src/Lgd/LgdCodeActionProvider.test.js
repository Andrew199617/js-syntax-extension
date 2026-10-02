const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdCodeActionProvider = require('../../../src/Lgd/LgdCodeActionProvider');

/** @description Exact source shown in the user's screenshot, with CRLF and preserved indentation. */
const screenshotSource = [
    'class PlainBase {',
    '    PlainBase() {',
    '    }',
    '',
    '    void run() {',
    '    }',
    '}',
    '',
    'class DemoBad : PlainBase {',
    '    DemoBad() : base("too", "many", "args") {',
    '    }',
    '',
    '    override void run() {',
    '    }',
    '}',
    '',
    'module.exports = DemoBad;'
].join('\r\n');

/** @description Opens source with a recording language service and native fix provider. */
async function openFixture(source, filename = '/workspace/DemoBad.lgd')
{
    const diagnostics = new Map();
    const collection = { set: (uri, entries) => diagnostics.set(uri.toString(), entries), delete: uri => diagnostics.delete(uri.toString()) };
    const service = LgdLanguageService.create(collection, error =>
    {
        throw error;
    });

    const document = makeTextDocument(`file://${filename}`, source);
    document.version = 1;
    await service.openDocument(document);
    const originalApply = vscode.workspace.applyEdit.getMockImplementation();
    vscode.workspace.applyEdit.mockImplementation(edit =>
    {
        for(const replacement of edit.replacements)
        {
            const state = service.getState(replacement.uri);
            if(state)
            {
                const target = state.document;
                const text = target.getText();
                const start = target.offsetAt(replacement.range.start);
                const end = target.offsetAt(replacement.range.end);
                target.setText(text.slice(0, start) + replacement.newText + text.slice(end));
                target.version++;
            }
        }

        return originalApply(edit);
    });

    return { service: service, document: document, diagnostics: diagnostics, provider: LgdCodeActionProvider.create(service) };
}

/** @description Requests fixes for one current coded diagnostic. */
function actionsFor(fixture, code, options = {})
{
    const diagnostics = fixture.diagnostics.get(fixture.document.uri.toString());
    const diagnostic = diagnostics.find(candidate => candidate.code === code);
    return fixture.provider.provideCodeActions(fixture.document, diagnostic.range, { diagnostics: [diagnostic], ...options }, {});
}

/** @description Applies one guarded native quick fix and waits for diagnostic refresh. */
async function applyAction(fixture, action)
{
    expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(true);
}

jest.mock('vscode', () =>
{
    const api = require('./fakeVscode').createFakeVscode(jest);

    api.CodeAction = jest.fn((title, kind) => ({ title: title, kind: kind }));
    api.CodeActionKind = { QuickFix: { value: 'quickfix' } };
    api.window = { setStatusBarMessage: jest.fn() };
    api.commands.registerCommand = jest.fn();
    api.Uri = { file: filename => require('./fakeVscode').makeTextDocument(`file://${filename}`, '').uri };
    return api;
});

/** @description Restores the shared fake's mirror-edit implementation between independent fixtures. */
const baselineApplyEdit = vscode.workspace.applyEdit.getMockImplementation();

beforeEach(() =>
{
    vscode.__reset();
    vscode.workspace.applyEdit.mockImplementation(baselineApplyEdit);
    vscode.workspace.applyEdit.mockClear();
    vscode.workspace.openTextDocument.mockClear();
    vscode.commands.executeCommand.mockReset();
});

describe('LGD diagnostic quick fixes', () =>
{
    test('offers both screenshot fixes and clears both diagnostics after explicit application', async () =>
    {
        const fixture = await openFixture(screenshotSource);
        const diagnostics = fixture.diagnostics.get(fixture.document.uri.toString());
        expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([ 'lgd.base.argumentCount', 'lgd.override.nonVirtual' ]);
        expect(fixture.document.getText(diagnostics[0].range)).toBe('"too", "many", "args"');
        expect(fixture.document.getText(diagnostics[1].range)).toBe('override');
        const [remove] = await actionsFor(fixture, 'lgd.base.argumentCount');
        expect(remove.title).toBe('Remove extra arguments from base call');
        expect(remove.kind.value).toBe('quickfix');
        expect(remove.isPreferred).toBe(false);
        expect(remove.diagnostics).toEqual([diagnostics[0]]);
        await applyAction(fixture, remove);
        const [makeVirtual] = await actionsFor(fixture, 'lgd.override.nonVirtual');
        expect(makeVirtual.title).toBe('Make PlainBase.run virtual');
        await applyAction(fixture, makeVirtual);
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
        expect(fixture.document.getText()).toBe(screenshotSource.replace('base("too", "many", "args")', 'base()').replace('    void run()', '    virtual void run()'));
    });

    test.each([ 'sideEffect()', 'object.value', '...values', '"value" /* keep this comment */', '/* keep */ "value"', '`literal`', '+1n' ])('does not offer argument removal for effectful or comment-bearing suffix %s', async argument =>
    {
        const fixture = await openFixture(`class Parent { Parent() {} }\nclass Child : Parent { Child() : base(${argument}) {} }`);
        const diagnostic = fixture.diagnostics.get(fixture.document.uri.toString()).find(candidate => candidate.code === 'lgd.base.argumentCount');
        if(diagnostic)
        {
            expect(await actionsFor(fixture, diagnostic.code)).toEqual([]);
        }
        else
        {
            expect(argument).toBe('...values');
        }
    });

    test('offers explicit removal for signed numeric literals and negative BigInt literals', async () =>
    {
        const fixture = await openFixture('class Parent { Parent() {} }\nclass Child : Parent { Child() : base(-1, +2, -3n) {} }');
        const [action] = await actionsFor(fixture, 'lgd.base.argumentCount');
        await applyAction(fixture, action);
        expect(fixture.document.getText()).toContain('base()');
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test('removes only the extra literal suffix and preserves a required argument and surrounding comments', async () =>
    {
        const fixture = await openFixture('class Parent { Parent(Number count) {} }\nclass Child : Parent { Child() : base(/* keep */ 1, "extra", false) {} }');
        const [action] = await actionsFor(fixture, 'lgd.base.argumentCount');
        await applyAction(fixture, action);
        expect(fixture.document.getText()).toContain('base(/* keep */ 1)');
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test('adds override before the method return type without changing its body', async () =>
    {
        const fixture = await openFixture('class Parent { virtual Number run() { return 1; } }\nclass Child : Parent { Number run() { return 2; } }');
        const [action] = await actionsFor(fixture, 'lgd.override.required');
        expect(action.title).toBe('Add override keyword');
        expect(action.isPreferred).toBe(true);
        await applyAction(fixture, action);
        expect(fixture.document.getText()).toContain('override Number run() { return 2; }');
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test('declines missing arguments, unrelated ranges, other action kinds, and canceled requests', async () =>
    {
        const missing = await openFixture('class Parent { Parent(Number count) {} }\nclass Child : Parent { Child() : base() {} }');
        expect(await actionsFor(missing, 'lgd.base.argumentCount')).toEqual([]);
        const fixture = await openFixture(screenshotSource);
        expect(await actionsFor(fixture, 'lgd.base.argumentCount', { only: { contains: () => false } })).toEqual([]);
        const diagnostics = fixture.diagnostics.get(fixture.document.uri.toString());
        const unrelated = new vscode.Range(fixture.document.positionAt(0), fixture.document.positionAt(1));
        expect(await fixture.provider.provideCodeActions(fixture.document, unrelated, { diagnostics: diagnostics }, {})).toEqual([]);
        expect(await fixture.provider.provideCodeActions(fixture.document, diagnostics[0].range, { diagnostics: diagnostics }, { isCancellationRequested: true })).toEqual([]);
    });

    test('declines stale diagnostics and stale actions before applying edits', async () =>
    {
        const fixture = await openFixture(screenshotSource);
        const [action] = await actionsFor(fixture, 'lgd.base.argumentCount');
        fixture.document.setText(`// new line\r\n${screenshotSource}`);
        fixture.document.version++;
        expect(await actionsFor(fixture, 'lgd.base.argumentCount')).toEqual([]);
        expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(false);
        await fixture.service.updateDocument(fixture.document);
        const [current] = await actionsFor(fixture, 'lgd.base.argumentCount');
        fixture.document.isClosed = true;
        expect(await fixture.provider.applyFix(current.command.arguments[0])).toBe(false);
    });

    test('targets the nearest lexical base and follows an inherited local method', async () =>
    {
        const source = 'class Parent { virtual run() {} }\nfunction build() {\n class Parent { run() {} }\n class Middle : Parent {}\n class Child : Middle { override run() {} }\n}';
        const fixture = await openFixture(source);
        const [action] = await actionsFor(fixture, 'lgd.override.nonVirtual');
        await applyAction(fixture, action);
        expect(fixture.document.getText()).toBe(source.replace(' class Parent { run()', ' class Parent { virtual run()'));
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test('does not invent editable methods for OLOO or unknown external bases', async () =>
    {
        const fixture = await openFixture('Object Parent = { create() {}, run() {} };\nclass Child : Parent { override run() {} }');
        expect(await actionsFor(fixture, 'lgd.override.nonVirtual')).toEqual([]);
        const unknown = await openFixture('Object Parent = require("external");\nclass Child : Parent { override run() {} }');
        expect(unknown.diagnostics.get(unknown.document.uri.toString())).toEqual([]);
    });

    test('passes only a serializable proposal ID through the native command and bounds retained actions', async () =>
    {
        const fixture = await openFixture(screenshotSource);
        const subscriptions = [];
        fixture.provider.registerCommands(subscriptions);
        const requestCount = 101;
        let first;
        let latest;
        for(let index = 0; index < requestCount; index++)
        {
            const [action] = await actionsFor(fixture, 'lgd.base.argumentCount');
            first ||= action;
            latest = action;
        }

        expect(fixture.provider.proposals.size).toBe(requestCount - 1);
        expect(await fixture.provider.applyFix(first.command.arguments[0])).toBe(false);
        const argumentsAfterTransport = JSON.parse(JSON.stringify(latest.command.arguments));
        expect(typeof argumentsAfterTransport[0]).toBe('number');
        const registration = vscode.commands.registerCommand.mock.calls.find(([name]) => name === latest.command.command);
        expect(await registration[1](...argumentsAfterTransport)).toBe(true);
        expect(fixture.document.getText()).toContain('base()');
        subscriptions[1].dispose();
        expect(fixture.provider.proposals.size).toBe(0);
    });

    test('edits an imported base source, rechecks its dependent, and refuses a changed imported buffer', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-quickfix-'));
        const basePath = path.join(directory, 'Parent.lgd');
        const baseText = 'class Parent { void run() {} }\nmodule.exports = Parent;';
        await fs.promises.writeFile(basePath, baseText);
        const fixture = await openFixture('Object Base = require("./Parent.js");\nclass Child : Base { override void run() {} }', path.join(directory, 'Child.lgd'));
        const baseDocument = makeTextDocument(`file://${basePath}`, baseText);
        baseDocument.version = 1;
        await fixture.service.openDocument(baseDocument);
        const originalOpen = vscode.workspace.openTextDocument.getMockImplementation();
        vscode.workspace.openTextDocument.mockImplementation(options =>
        {
            if(options.fsPath === basePath)
            {
                return baseDocument;
            }

            return originalOpen(options);
        });

        try
        {
            const [action] = await actionsFor(fixture, 'lgd.override.nonVirtual');
            expect(action.title).toBe('Make Parent.run virtual');
            baseDocument.setText(`// changed\n${baseText}`);
            baseDocument.version++;
            expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(false);
            expect(await actionsFor(fixture, 'lgd.override.nonVirtual')).toEqual([]);
            await fixture.service.updateDocument(baseDocument);
            await fixture.service.pendingDependencyUpdates;
            const [current] = await actionsFor(fixture, 'lgd.override.nonVirtual');
            await applyAction(fixture, current);
            const appliedEdit = vscode.workspace.applyEdit.mock.calls.find(([edit]) => edit.replacements.some(replacement => replacement.newText === 'virtual '))[0];
            expect(appliedEdit.replacements[0].uri.fsPath).toBe(basePath);
            expect(baseDocument.getText()).toContain('virtual void run()');
            expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
            expect(fixture.document.getText()).toContain('override void run()');
        }
        finally
        {
            vscode.workspace.openTextDocument.mockImplementation(originalOpen);
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });
});
