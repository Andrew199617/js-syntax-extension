const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdCodeActionProvider = require('../../../src/Lgd/LgdCodeActionProvider');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');


const LgdDiagnosticDefinitions = require('../../../src/Lgd/LgdDiagnosticDefinitions');

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
    const error = fixture.service.getState(fixture.document.uri).errors.find(candidate => candidate.code === code);
    const visibleCode = LgdDiagnosticDefinitions.get(error).visibleCode;
    const diagnostic = diagnostics.find(candidate => candidate.message === error.message && candidate.code === visibleCode);

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

describe('Redundant constructor and method return documentation fixes', () =>
{
    test.each([ '\n', '\r\n' ])('removes the screenshot constructor return alias and keeps useful docs with %j newlines', async newline =>
    {
        const source = [ 'class BaseCommand {',
            '    /**',
            '     * @description Initialize an instance of BaseCommand.',
            '     * @param commandName The name of the command.',
            '     * @param title The title of the command.',
            '     * @returns {BaseCommandType}',
            '     */',
            '    BaseCommand(String commandName, String title) {',
            '        this.command = { title: title, command: commandName };',
            '    }',
            '}' ].join(newline);
        const fixture = await openFixture(source);
        const [diagnostic] = fixture.diagnostics.get(fixture.document.uri.toString());
        expect(diagnostic.code).toBe('warning');
        expect(diagnostic.source).toBe('LGD');
        expect(diagnostic.severity).toBe(vscode.DiagnosticSeverity.Warning);
        expect(fixture.document.getText(diagnostic.range)).toBe('{BaseCommandType}');
        const [action] = await actionsFor(fixture, 'lgd.jsdoc.returnType');
        expect(action.title).toBe('Remove redundant return-type documentation');
        expect(action.isPreferred).toBe(true);
        await applyAction(fixture, action);
        expect(fixture.document.getText()).toBe(source.replace(`     * @returns {BaseCommandType}${newline}`, ''));
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test.each([
        [ '/** @return {CommandType} */', '' ],
        [ '/**@returns {CommandType}*/', '' ],
        [ '/**\n     * @returns {CommandType}\n     */', '' ],
        [ '/** @returns {CommandType} The initialized command. */', '/** @returns The initialized command. */\n    ' ],
        [ '/** Details. @return {CommandType} */', '/** Details. */\n    ' ],
        [ '/** @returns {CommandType} @deprecated Use a factory. */', '/** @deprecated Use a factory. */\n    ' ],
        [ '/**\n     * @returns {CommandType}\n     * The initialized command.\n     */',
            '/**\n     * @returns \n     * The initialized command.\n     */\n    ' ],
        [ '/** @returns {{label: "}"}} The initialized command. */', '/** @returns The initialized command. */\n    ' ],
        [ '/**\n     * @returns {{\n     * label: string\n     * }}\n     */', '' ]
    ])('preserves meaningful prose and removes empty docs in %s', async (comment, expected) =>
    {
        const fixture = await openFixture(`class Command {\n    ${comment}\n    Command() {}\n}`);
        const [action] = await actionsFor(fixture, 'lgd.jsdoc.returnType');
        await applyAction(fixture, action);
        expect(fixture.document.getText()).toBe(`class Command {\n    ${expected}Command() {}\n}`);
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test.each([ 'class', 'object' ])('applies the existing typed method policy in an LGD %s', async kind =>
    {
        const opening = kind === 'class' ? 'class Command {' : 'Object Command = {';
        const source = `${opening} /** @return {number} The count. */ Number count() { return 1; } };`;
        const fixture = await openFixture(source);
        const [action] = await actionsFor(fixture, 'lgd.jsdoc.returnType');
        await applyAction(fixture, action);
        expect(fixture.document.getText()).toBe(source.replace('{number} ', ''));
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test('keeps examples, paragraph breaks and other tags while removing repeated type-only tags', async () =>
    {
        const source = [ 'class Command {',
            '\t/**',
            '\t * First paragraph.',
            '\t *',
            '\t * Second paragraph.',
            '\t * @example',
            '\t * ```lgd',
            '\t * @returns {ExampleType}',
            '\t * ```',
            '\t * @returns {CommandType}',
            '\t * @return {OldAlias}',
            '\t * @deprecated Use create.',
            '\t */',
            '\tCommand() {}',
            '}' ].join('\r\n');
        const fixture = await openFixture(source);
        const diagnostics = fixture.diagnostics.get(fixture.document.uri.toString());
        expect(diagnostics).toHaveLength(2);
        const range = new vscode.Range(fixture.document.positionAt(0), fixture.document.positionAt(source.length));
        const actions = await fixture.provider.provideCodeActions(fixture.document, range, { diagnostics: diagnostics }, {});
        expect(actions).toHaveLength(1);
        expect(actions[0].diagnostics).toHaveLength(2);
        await applyAction(fixture, actions[0]);
        expect(fixture.document.getText()).toBe(source.replace('\t * @returns {CommandType}\r\n', '').replace('\t * @return {OldAlias}\r\n', ''));
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test('declines stale diagnostics and constructor fixes after documentation changes', async () =>
    {
        const source = 'class Command { /** @returns {CommandType} */ Command() {} }';
        const fixture = await openFixture(source);
        const [action] = await actionsFor(fixture, 'lgd.jsdoc.returnType');
        fixture.document.setText(source.replace('{CommandType}', '{CommandType} Meaningful description.'));
        fixture.document.version++;
        expect(await actionsFor(fixture, 'lgd.jsdoc.returnType')).toEqual([]);
        expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(false);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
        await fixture.service.updateDocument(fixture.document);
        const [current] = await actionsFor(fixture, 'lgd.jsdoc.returnType');
        await applyAction(fixture, current);
        expect(fixture.document.getText()).toBe('class Command { /** @returns Meaningful description. */ Command() {} }');
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });
});

describe('Constructor value-return error quick fixes', () =>
{
    test('shows an LGD syntax error and a guarded early-exit fix, then clears Problems', async () =>
    {
        const source = 'class Sample { Sample(Boolean stop) { if(stop) return this; this.value = 2; } Number later() { return 2; } }';
        const fixture = await openFixture(source);
        const [diagnostic] = fixture.diagnostics.get(fixture.document.uri.toString());
        expect(diagnostic.code).toBe('syntax');
        expect(diagnostic.severity).toBe(vscode.DiagnosticSeverity.Error);
        expect(fixture.document.getText(diagnostic.range)).toBe('this');
        const [action] = await actionsFor(fixture, 'lgd.constructor.returnValue');
        expect(action.title).toBe('Replace return this with an early exit');
        expect(action.isPreferred).toBe(true);
        await applyAction(fixture, action);
        expect(fixture.document.getText()).toBe(source.replace('return this;', 'return;'));
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test('removes the only constructor statement instead of creating a terminal bare return', async () =>
    {
        const source = 'class Command {\r\n    Command() {\r\n        return this;\r\n    }\r\n}';
        const fixture = await openFixture(source);
        const [action] = await actionsFor(fixture, 'lgd.constructor.returnValue');
        expect(action.title).toBe('Remove redundant return this');
        await applyAction(fixture, action);
        expect(fixture.document.getText()).toBe('class Command {\r\n    Command() {\r\n    }\r\n}');
        expect(fixture.diagnostics.get(fixture.document.uri.toString())).toEqual([]);
    });

    test('declines a stale fix after this becomes a side-effecting expression', async () =>
    {
        const source = 'class Sample { Sample() { return this; } }';
        const fixture = await openFixture(source);
        const [action] = await actionsFor(fixture, 'lgd.constructor.returnValue');
        fixture.document.setText(source.replace('return this;', 'return initializeOther();'));
        fixture.document.version++;
        expect(await fixture.provider.applyFix(action.command.arguments[0])).toBe(false);
        expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
        await fixture.service.updateDocument(fixture.document);
        expect(await actionsFor(fixture, 'lgd.constructor.returnValue')).toEqual([]);
    });
});

test('keeps later member hover available after a constructor value-return error', async () =>
{
    const source = 'class Sample { Number value; Sample() { return {}; } Number later() { return this.value; } }';
    const fixture = await openFixture(source);
    const state = fixture.service.getState(fixture.document.uri);
    expect(state.errors.map(error => error.code)).toEqual(['lgd.constructor.returnValue']);
    const position = fixture.document.positionAt(source.lastIndexOf('this.value') + 'this.'.length);
    const hover = await LgdHoverProvider.create(fixture.service).provideHover(fixture.document, position);
    expect(hover.contents).toContain('Number Sample.value');
    expect(fixture.document.getText(hover.range)).toBe('value');
});
