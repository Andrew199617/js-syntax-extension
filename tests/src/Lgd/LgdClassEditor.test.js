const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');
const LgdCompletionProvider = require('../../../src/Lgd/LgdCompletionProvider');
const LgdDefinitionProvider = require('../../../src/Lgd/LgdDefinitionProvider');
const LgdSemanticTokensProvider = require('../../../src/Lgd/LgdSemanticTokensProvider');

/** @description Inherited class members and constructor assignments used by the editor tests. */
const CLASS_SOURCE = [
    'const vscode = require("vscode");',
    'class BaseCommand {',
    '    BaseCommand(String commandName, String title) {',
    '        /** @type {vscode.Command} */',
    '        this.command = { command: commandName, title: title };',
    '        this.title = title;',
    '    }',
    '    get commandName() { return this.command.command; }',
    '}',
    'class GoToAssignment : BaseCommand {',
    '    GoToAssignment() : base("lgd.goToAssignment", "Go To Assignment") {',
    '        /** @type {Number} */',
    '        this.title = 1;',
    '    }',
    '    async executeCommand(vscode.TextDocument document) {',
    '        return this.command;',
    '    }',
    '}',
    'GoToAssignment.'
].join('\n');

/**
 * @description Opens an LGD class source in a recording language service.
 * @param {string} source the LGD source.
 * @param {string} uri the source document URI.
 * @returns {Promise<Object>} the service, source document and compiled state.
 */
async function openClassDocument(source = CLASS_SOURCE, uri = 'file:///workspace/ClassCommand.lgd')
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
    const document = makeTextDocument(uri, source);
    const state = await service.openDocument(document);
    return { service: service, document: document, state: state };
}

/**
 * @description Gets a position inside the final occurrence of a source phrase.
 * @param {Object} document the source document.
 * @param {string} phrase the source phrase.
 * @param {number} delta the offset from its beginning.
 * @returns {Object} the editor position.
 */
function positionIn(document, phrase, delta = 0)
{
    return document.positionAt(document.getText().lastIndexOf(phrase) + delta);
}

jest.mock('vscode', () =>
{
    const fake = require('./fakeVscode');

    const api = fake.createFakeVscode(jest);
    api.Uri = { file: filePath => fake.makeTextDocument(`file://${filePath}`, '').uri };
    return api;
});

beforeEach(() =>
{
    vscode.__reset();
    vscode.commands.executeCommand.mockReset();
});

describe('LGD class editor integration', () =>
{
    test('summarizes the class base, generated factory and typed constructor', async () =>
    {
        const { service, document } = await openClassDocument();
        const hoverProvider = LgdHoverProvider.create(service);
        const hover = await hoverProvider.provideHover(document, positionIn(document, 'BaseCommand {'));

        expect(hover.contents).toContain('class BaseCommand {');
        expect(hover.contents).toContain('create(String commandName, String title)');
        expect(hover.contents).toContain('title: String');
        const derived = await hoverProvider.provideHover(document, positionIn(document, 'GoToAssignment.'));
        expect(derived.contents).toContain('class GoToAssignment : BaseCommand {');
        expect(derived.contents).toContain('executeCommand()');
        expect(derived.contents).not.toContain('GoToAssignment()');
    });

    test('completes inherited members and shows inherited assignment details on this', async () =>
    {
        const { service, document } = await openClassDocument();
        const position = positionIn(document, 'this.command', 'this.'.length);
        const items = await LgdCompletionProvider.create(service).provideCompletionItems(document, position);

        expect(items.map(item => item.label)).toEqual([ 'create', 'executeCommand', 'title', 'commandName', 'command' ]);
        const hover = await LgdHoverProvider.create(service).provideHover(document, position);
        expect(hover.contents).toContain('(property) command: vscode.Command');
        expect(hover.contents).toContain('command,');
        expect(hover.contents).toContain('title,');
        expect(service.getThisMemberDetail(document, position, 'title').typeName).toBe('Number');
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    test('completes an instance declared with its class type', async () =>
    {
        const source = `${CLASS_SOURCE.slice(0, CLASS_SOURCE.lastIndexOf('GoToAssignment.'))}GoToAssignment command = GoToAssignment.create();\ncommand.`;
        const { service, document } = await openClassDocument(source);
        const items = await LgdCompletionProvider.create(service).provideCompletionItems(document, document.positionAt(source.length));

        expect(items.map(item => item.label)).toContain('executeCommand');
        expect(items.map(item => item.label)).toContain('commandName');
        const summary = await service.getTypeSummary(document.uri, 'command');
        expect(summary.typeName).toBe('GoToAssignment');
        expect(summary.kind).toBeUndefined();
    });

    test('marks class names, base names and constructors as types while leaving methods to the grammar', async () =>
    {
        const { service, document } = await openClassDocument();
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const names = tokens.pushed.map(token => document.getText(token.range));

        expect(names.filter(name => name === 'BaseCommand')).toEqual([ 'BaseCommand', 'BaseCommand', 'BaseCommand' ]);
        expect(names.filter(name => name === 'GoToAssignment')).toHaveLength(2);
        expect(names).toContain('String');
        expect(names).toContain('vscode.TextDocument');
        expect(names).not.toContain('executeCommand');
        expect(tokens.pushed.every(token => token.tokenType === 'class')).toBe(true);
    });

    test('does not treat returned unrelated objects as class instances', async () =>
    {
        const { service, document } = await openClassDocument([
            'class Command {',
            '  Command(String title) {',
            '    this.title = title;',
            '    const unrelated = {};',
            '    unrelated.ignored = true;',
            '    // this.commented = true;',
            '  }',
            '  execute() { return this.title; }',
            '}'
        ].join('\n'));
        const members = service.getThisMembers(document, positionIn(document, 'this.title'));

        expect(members.map(member => member.name)).toEqual([ 'create', 'execute', 'title' ]);
        expect(members.find(member => member.name === 'title').typeName).toBe('String');
    });
});

describe('LGD class cross-file metadata', () =>
{
    let directory;

    beforeEach(async () =>
    {
        directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-class-editor-'));
    });

    afterEach(async () =>
    {
        await fs.promises.rm(directory, { recursive: true, force: true });
    });

    test('retains constructor signatures and inherited members through direct CommonJS exports', async () =>
    {
        await fs.promises.writeFile(path.join(directory, 'Root.lgd'), [
            'class Root {',
            '  Root(String title) { this.title = title; }',
            '  run() { return this.title; }',
            '}',
            'module.exports = Root;'
        ].join('\n'));

        await fs.promises.writeFile(path.join(directory, 'Middle.lgd'), [
            'readonly Object Root = require("./Root.js");',
            'class Middle : Root {',
            '  Middle(String title) : base(title) {}',
            '  middle() {}',
            '}',
            'module.exports = Middle;'
        ].join('\n'));
        const source = [
            'const Parent = require("./Middle.js");',
            'class Child : Parent {',
            '  Child() : base("ready") {}',
            '  child() { return this.title; }',
            '}'
        ].join('\n');
        const { service, document, state } = await openClassDocument(source, `file://${path.join(directory, 'Child.lgd')}`);
        const imported = state.externals.get('./Middle.js');

        expect(imported).toMatchObject({ exportName: 'Middle', kind: 'class', baseName: 'Root' });
        expect(imported.constructorParams).toEqual([expect.objectContaining({ name: 'title', typeName: 'String' })]);
        const summary = await service.getTypeSummary(document.uri, 'Child');
        expect(summary.members.map(member => member.name)).toEqual([ 'create', 'child', 'middle', 'run', 'title' ]);
        const detail = service.getThisMemberDetail(document, positionIn(document, 'this.title'), 'title');
        expect(detail.typeName).toBe('String');
        expect(state.errors).toEqual([]);
        const importedSummary = await service.getTypeSummary(document.uri, 'Parent');
        expect(importedSummary.kind).toBe('class');
        expect(importedSummary.members.map(member => member.name)).toContain('title');
        const definitions = await LgdDefinitionProvider.create(service).provideDefinition(document, positionIn(document, 'Parent {'));
        expect(definitions).toHaveLength(1);
        expect(definitions[0].uri.fsPath).toBe(path.join(directory, 'Middle.lgd'));
        expect(definitions[0].range.start).toEqual(expect.objectContaining({ line: 1, character: 'class '.length }));
    });

    test('provides known OLOO base signatures to compiler diagnostics', async () =>
    {
        await fs.promises.writeFile(path.join(directory, 'Base.lgd'), [
            'Object Base = { create(String title) { this.title = title; return this; } };',
            'module.exports = Base;'
        ].join('\n'));
        const source = [
            'Object Base = require("./Base.js");',
            'class Child : Base { Child() : base(42) {} }'
        ].join('\n');
        const { state } = await openClassDocument(source, `file://${path.join(directory, 'Child.lgd')}`);

        expect(state.externals.get('./Base.js').constructorParams).toEqual([expect.objectContaining({ name: 'title', typeName: 'String' })]);
        expect(state.errors.some(error => error.message.includes('String'))).toBe(true);
    });

    test('terminates inherited member lookup for circular relative imports', async () =>
    {
        await fs.promises.writeFile(path.join(directory, 'First.lgd'), [
            'Object Second = require("./Second.js");',
            'class First : Second { first() {} }',
            'module.exports = First;'
        ].join('\n'));

        await fs.promises.writeFile(path.join(directory, 'Second.lgd'), [
            'Object First = require("./First.js");',
            'class Second : First { second() {} }',
            'module.exports = Second;'
        ].join('\n'));
        const { service } = await openClassDocument('');
        const exported = await service.readExportDeclaration(path.join(directory, 'First.lgd'));

        expect(exported.members.map(member => member.name)).toEqual([ 'create', 'first', 'second' ]);
    });
});
