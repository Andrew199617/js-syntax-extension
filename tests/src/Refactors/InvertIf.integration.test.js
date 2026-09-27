const vscode = require('vscode');
const InvertIf = require('../../../src/Refactor/InvertIf');
const RefactorProvider = require('../../../src/Refactor/RefactorProvider');
const StatusBarMessage = require('../../../src/Logging/StatusBarMessage');

function positionAt(source, offset)
{
    const prefix = source.slice(0, offset);
    return { line: prefix.split('\n').length - 1, character: offset - prefix.lastIndexOf('\n') - 1 };
}

function createEditor(source, marker = 'if')
{
    const offset = source.indexOf(marker);
    const cursor = positionAt(source, offset);
    const range = { start: cursor, end: cursor, isEmpty: true };
    const edits = [];
    const document = {
        languageId: 'javascript',
        getText: () => source,
        positionAt: target => positionAt(source, target),
        offsetAt(position)
        {
            const lines = source.split('\n');
            let start = 0;
            for(let index = 0; index < position.line; index++)
            {
                start += lines[index].length + 1;
            }

            return start + position.character;
        }
    };
    const editor = {
        document: document,
        selection: range,
        options: { insertSpaces: true, tabSize: 2 },
        edit: jest.fn(callback =>
        {
            callback({ replace: (target, text) => edits.push({ range: target, text: text }) });
            return Promise.resolve(true);
        })
    };

    return { editor: editor, document: document, range: range, edits: edits };
}

function createProvider()
{
    const provider = Object.create(RefactorProvider);
    provider.extractFunction = {
        shouldProvideRefactor: jest.fn(() => false),
        createCodeAction: jest.fn()
    };
    return provider;
}

jest.mock('vscode', () => ({
    window: {},
    commands: { registerCommand: jest.fn() },
    languages: { registerCodeActionsProvider: jest.fn() },
    Range: jest.fn().mockImplementation((start, end) => ({ start: start, end: end })),
    CodeAction: jest.fn().mockImplementation((title, kind) => ({ title: title, kind: kind })),
    CodeActionKind: { Refactor: 'refactor' }
}));

jest.mock('../../../src/Logging/StatusBarMessage', () => ({ show: jest.fn() }));

beforeEach(() =>
{
    vscode.window.activeTextEditor = undefined;
});

test('uses the action range after the cursor has moved', async () =>
{
    const source = `function run(ready) {
  if (ready) {
    work();
  }
}`;
    const context = createEditor(source);
    context.editor.selection = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    vscode.window.activeTextEditor = context.editor;
    expect(await InvertIf.create().executeCommand(context.document, context.range)).toBe(true);
    expect(context.edits).toHaveLength(1);
    expect(context.edits[0].range.start).toEqual(context.range.start);
    expect(context.edits[0].text).toContain(`if (!ready)`);
});

test('uses the active selection for the command palette', async () =>
{
    const source = `function run(ready) {
  if (ready)
    work();
}`;
    const context = createEditor(source);
    vscode.window.activeTextEditor = context.editor;
    expect(await InvertIf.create().executeCommand()).toBe(true);
    expect(context.edits).toHaveLength(1);
});

test('does not edit a different active document', async () =>
{
    const targetSource = `function run(ready) {
  if (ready)
    work();
}`;
    const otherSource = `function other(ready) {
  if (ready)
    work();
}`;
    const target = createEditor(targetSource);
    const other = createEditor(otherSource);
    vscode.window.activeTextEditor = other.editor;
    expect(await InvertIf.create().executeCommand(target.document, target.range)).toBe(false);
    expect(other.editor.edit).not.toHaveBeenCalled();
});

test('returns false without an editor or a safe conversion', async () =>
{
    expect(await InvertIf.create().executeCommand()).toBe(false);
    const source = `function run(ready) {
  if (ready)
    work();

  finish();
}`;
    const context = createEditor(source);
    vscode.window.activeTextEditor = context.editor;
    expect(await InvertIf.create().executeCommand()).toBe(false);
    expect(context.editor.edit).not.toHaveBeenCalled();
});

test('waits for editor acceptance and reports a rejected edit', async () =>
{
    const source = `function run(ready) {
  if (ready)
    work();
}`;
    const context = createEditor(source);
    vscode.window.activeTextEditor = context.editor;
    let finishEdit;
    context.editor.edit.mockImplementation(() => new Promise(resolve =>
    {
        finishEdit = resolve;
    }));

    const contextSubscriptions = { subscriptions: [] };
    InvertIf.create().register(contextSubscriptions);
    const command = vscode.commands.registerCommand.mock.calls[0][1];
    const pending = command(context.document, context.range);
    expect(StatusBarMessage.show).not.toHaveBeenCalled();
    finishEdit(false);
    expect(await pending).toBe(false);
    expect(StatusBarMessage.show).toHaveBeenCalledTimes(1);
});

test('offers the action only when the selected if can become a guard', () =>
{
    const source = `function run(ready) {
  if (ready)
    work();
}`;
    const context = createEditor(source);
    const actions = createProvider().provideCodeActions(context.document, context.range, {});
    expect(actions).toHaveLength(1);
    expect(actions[0].command.arguments).toEqual([ context.document, context.range ]);
    const unsafeSource = `function run(ready) {
  if (ready)
    work();

  finish();
}`;
    const unsafe = createEditor(unsafeSource);
    expect(createProvider().provideCodeActions(unsafe.document, unsafe.range, {})).toEqual([]);
});

test('registers JavaScript, JSX, TypeScript and TSX documents', () =>
{
    const provider = createProvider();
    provider.context = { subscriptions: [] };
    provider.register();
    expect(vscode.languages.registerCodeActionsProvider.mock.calls[0][0])
        .toEqual([
            'javascript', 'javascriptreact', 'typescript', 'typescriptreact'
        ]);
});
