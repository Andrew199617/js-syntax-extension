const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdCodeActionProvider = require('../../../src/Lgd/LgdCodeActionProvider');


/** @description Exercises the real diagnostic formatter independently of the global parser mock. */
const VscodeError = jest.requireActual('../../../src/Errors/VscodeError');

const ErrorTypes = require('../../../src/Errors/ErrorTypes');
const createLgdDiagnostics = require('../../../src/Lgd/LgdDiagnostics');

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

    test.each([
        [ 'Number run()', 'override Number run()', 'virtual Number run()', 'Add override keyword' ],
        [ 'virtual Number run()', 'override Number run()', 'virtual Number run()', 'Replace virtual with override' ],
        [ 'async Number run()', 'override async Number run()', 'virtual async Number run()', 'Add override keyword' ]
    ])('repairs the override contract for %s without changing its body', async (method, fixedMethod, baseMethod, title) =>
    {
        const fixture = await openFixture(`class Parent { ${baseMethod} { return 1; } }\nclass Child : Parent { ${method} { return 2; } }`);
        const [action] = await actionsFor(fixture, 'lgd.override.required');
        expect(action.title).toBe(title);
        expect(action.isPreferred).toBe(true);
        await applyAction(fixture, action);
        expect(fixture.document.getText()).toContain(`${fixedMethod} { return 2; }`);
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test('does not change a base contract for a child that has not explicitly declared override', async () =>
    {
        const fixture = await openFixture('class Parent { run() {} }\nclass Child : Parent { run() {} }');
        expect(await actionsFor(fixture, 'lgd.override.nonVirtual')).toEqual([]);
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

    test('deduplicates identical edits while retaining diagnostic links', async () =>
    {
        const fixture = await openFixture(screenshotSource);
        const diagnostics = fixture.diagnostics.get(fixture.document.uri.toString());
        const diagnostic = diagnostics[0];
        const request = { diagnostics: [ diagnostic, { ...diagnostic } ] };
        const actions = await fixture.provider.provideCodeActions(fixture.document, diagnostic.range, request, {});
        expect(actions).toHaveLength(1);
        expect(actions[0].diagnostics).toHaveLength(2);
        expect(fixture.provider.proposals.size).toBe(1);
    });

    test('validates every retained edit again before dispatch', async () =>
    {
        const fixture = await openFixture(screenshotSource);
        const [action] = await actionsFor(fixture, 'lgd.base.argumentCount');
        const proposalId = action.command.arguments[0];
        fixture.provider.proposals.get(proposalId).offset = -1;
        expect(await fixture.provider.applyFix(proposalId)).toBe(false);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });

    test('requires contract-specific apply guards to synchronously return true', async () =>
    {
        const fixture = await openFixture(screenshotSource);
        const [action] = await actionsFor(fixture, 'lgd.base.argumentCount');
        const proposalId = action.command.arguments[0];
        fixture.provider.proposals.get(proposalId).validate = () => Promise.resolve(false);
        expect(await fixture.provider.applyFix(proposalId)).toBe(false);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });

    test('uses one LGD source label without duplicating it in diagnostic messages', async () =>
    {
        const fixture = await openFixture('class Counter { void increment(Number value) { value = "wrong"; } }');
        const diagnostics = fixture.diagnostics.get(fixture.document.uri.toString());
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].message).toBe('Cannot assign String to Number.');
        expect(diagnostics[0].source).toBe('LGD');
    });

    test.each([ 'LGD: Legacy problem.', 'Legacy problem.' ])('normalizes legacy diagnostic branding for %s', message =>
    {
        const document = makeTextDocument('file:///workspace/legacy.js', 'const value = 1;');
        const diagnostics = [];
        const context = { document: document, diagnostics: diagnostics, diagnosticCollection: { set: jest.fn() } };
        const endCharacter = 'const'.length;
        const error = VscodeError.create(message, 0, 0, 0, endCharacter, ErrorTypes.ERROR);
        error.notifyUser({ compilationContext: context });
        expect(diagnostics[0].message).toBe('Legacy problem.');
        expect(diagnostics[0].source).toBe('LGD');
    });

    test('keeps diagnostic code, severity and source while using the unprefixed compiler message', () =>
    {
        const document = makeTextDocument('file:///workspace/source.lgd', 'class Example {}');
        const compilerError = { offset: 0, endOffset: 'class'.length, code: 'lgd.test.warning', message: 'Example warning.', severity: 'warning' };
        const [diagnostic] = createLgdDiagnostics(document, [compilerError]);
        expect(diagnostic.message).toBe('Example warning.');
        expect(diagnostic.source).toBe('LGD');
        expect(diagnostic.code).toBe('lgd.test.warning');
        expect(diagnostic.severity).toBe(vscode.DiagnosticSeverity.Warning);
    });

    test.each([ '\n', '\r\n' ])('changes only the parameter annotation with %j line endings', async newline =>
    {
        const source = [
            'Number earlier = 1;',
            'class Counter {',
            '    void increment(Number value) {',
            '        // Keep the programmer’s assignment and comments.',
            '        value = "wrong";',
            '    }',
            '}'
        ].join(newline);
        const fixture = await openFixture(source);
        const [action] = await actionsFor(fixture, 'lgd.assignment.typeMismatch');
        expect(action.title).toBe("Change parameter 'value' to String (changes signature)");
        expect(action.isPreferred).toBe(false);
        expect(action.edit).toBeUndefined();
        await applyAction(fixture, action);
        expect(fixture.document.getText()).toBe(source.replace('increment(Number value)', 'increment(String value)'));
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test('discloses and preserves the original Number return error after the parameter-only fix', async () =>
    {
        const source = 'class Counter { Number increment(Number value) { value = "wrong"; return value; } }';
        const fixture = await openFixture(source);
        const before = fixture.diagnostics.get(fixture.document.uri.toString());
        expect(before).toHaveLength(2);
        const [action] = await actionsFor(fixture, 'lgd.assignment.typeMismatch');
        expect(action.title).toContain('1 existing diagnostic remains');
        await applyAction(fixture, action);
        const after = fixture.diagnostics.get(fixture.document.uri.toString());
        expect(after).toHaveLength(1);
        expect(after[0].message).toBe(before.find(diagnostic => diagnostic.code !== 'lgd.assignment.typeMismatch').message);
        expect(fixture.document.getText()).toBe(source.replace('increment(Number value)', 'increment(String value)'));
    });

    test('deduplicates compatible writes to the same parameter without hiding their diagnostics', async () =>
    {
        const fixture = await openFixture('class Counter { void increment(Number value) { value = "wrong"; value = "again"; } }');
        const diagnostics = fixture.diagnostics.get(fixture.document.uri.toString());
        const range = new vscode.Range(fixture.document.positionAt(0), fixture.document.positionAt(fixture.document.getText().length));
        const actions = await fixture.provider.provideCodeActions(fixture.document, range, { diagnostics: diagnostics }, {});
        expect(actions).toHaveLength(1);
        expect(actions[0].diagnostics).toHaveLength(2);
        await applyAction(fixture, actions[0]);
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test('targets the correct lexical method parameter rather than same-name locals or sibling parameters', async () =>
    {
        const source = 'class Counter { void first(Number value) { value = "wrong"; } void second(Number value) { value = 2; } }';
        const fixture = await openFixture(source);
        const [action] = await actionsFor(fixture, 'lgd.assignment.typeMismatch');
        await applyAction(fixture, action);
        expect(fixture.document.getText()).toBe(source.replace('first(Number value)', 'first(String value)'));
    });

    test.each([
        'class Counter { void increment(Number value = 1) { value = "wrong"; } }',
        'class Counter { void increment(Number value) { value = "wrong"; value = 1; } }',
        'class Counter { void increment(Number value) { value = "wrong"; Number copy = value; } }',
        'class Counter { void increment(Number value) { const write = () => { value = "wrong"; }; } }',
        'class Counter { virtual void increment(Number value) { value = "wrong"; } }',
        'class Counter { void increment(Number value) { value = "wrong"; } } module.exports = Counter;',
        'class Counter { void increment(Number value) { value = "wrong"; } } const instance = Counter.create();',
        'Number local = "wrong";',
        'class Parent {} class Counter : Parent { void increment(Number value) { value = "wrong"; } }'
    ])('withholds a signature-changing fix for unsafe or unrelated source %s', async source =>
    {
        const fixture = await openFixture(source);
        const diagnostics = fixture.diagnostics.get(fixture.document.uri.toString());
        const range = new vscode.Range(fixture.document.positionAt(0), fixture.document.positionAt(source.length));
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(await fixture.provider.provideCodeActions(fixture.document, range, { diagnostics: diagnostics }, {})).toEqual([]);
    });

    test('rejects a parameter proposal after source changes and does not offer signature fixes as Fix All', async () =>
    {
        const source = 'class Counter { void increment(Number value) { value = "wrong"; } }';
        const fixture = await openFixture(source);
        const [action] = await actionsFor(fixture, 'lgd.assignment.typeMismatch');
        fixture.document.setText(source.replace('"wrong"', '"new value"'));
        fixture.document.version++;
        expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(false);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
        await fixture.service.updateDocument(fixture.document);
        expect(await actionsFor(fixture, 'lgd.assignment.typeMismatch', { only: { contains: () => false } })).toEqual([]);
    });

    test('rejects an already offered parameter edit when a new consumer appears', async () =>
    {
        const fixture = await openFixture('class Counter { void increment(Number value) { value = "wrong"; } }');
        const [action] = await actionsFor(fixture, 'lgd.assignment.typeMismatch');
        const consumer = makeTextDocument('file:///workspace/Consumer.lgd', '');
        fixture.service.states.set(consumer.uri.toString(), {
            document: consumer,
            externals: new Map([[ 'Counter', { sourcePath: fixture.document.uri.fsPath } ]])
        });
        expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(false);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });

    test('pins transitive contracts even when the selected base has its own method', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-contract-quickfix-'));
        const rootPath = path.join(directory, 'Root.lgd');
        const parentPath = path.join(directory, 'Parent.lgd');
        const rootText = 'class Root {}\nmodule.exports = Root;';
        const parentText = 'Object Root = require("./Root.js");\nclass Parent : Root { void run() {} }\nmodule.exports = Parent;';
        await fs.promises.writeFile(rootPath, rootText);
        await fs.promises.writeFile(parentPath, parentText);
        const fixture = await openFixture(
            'Object Parent = require("./Parent.js");\nclass Child : Parent { override void run() {} }',
            path.join(directory, 'Child.lgd')
        );
        const rootDocument = makeTextDocument(`file://${rootPath}`, rootText);
        const parentDocument = makeTextDocument(`file://${parentPath}`, parentText);
        rootDocument.version = 1;
        parentDocument.version = 1;
        await fixture.service.openDocument(rootDocument);
        await fixture.service.openDocument(parentDocument);
        const originalOpen = vscode.workspace.openTextDocument.getMockImplementation();
        const knownDocuments = new Map([ [ rootPath, rootDocument ], [ parentPath, parentDocument ] ]);
        vscode.workspace.openTextDocument.mockImplementation(options => knownDocuments.get(options.fsPath) || originalOpen(options));
        try
        {
            const [action] = await actionsFor(fixture, 'lgd.override.nonVirtual');
            expect(action.title).toBe('Make Parent.run virtual');
            rootDocument.setText(rootText.replace('class Root {}', 'class Root { virtual void run() {} }'));
            rootDocument.version++;
            expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(false);
            expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
            expect(await actionsFor(fixture, 'lgd.override.nonVirtual')).toEqual([]);
        }
        finally
        {
            vscode.workspace.openTextDocument.mockImplementation(originalOpen);
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
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
