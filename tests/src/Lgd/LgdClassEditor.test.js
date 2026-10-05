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

        expect(items.map(item => item.label)).toEqual([ 'executeCommand', 'title', 'commandName', 'command' ]);
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

    test('shows inherited method prose on declarations, this, base and typed instance accesses', async () =>
    {
        const source = [
            'class Parent {',
            '  /**',
            '   * @description Describes the selected label.',
            '   * @param label The label to describe.',
            '   * @returns The formatted label.',
            '   */',
            '  virtual String describe(String label) { return label; }',
            '}',
            'class Child : Parent {',
            '  override String describe(String label) { return base.describe(label); }',
            '  String call(String label) { return this.describe(label); }',
            '}',
            'Child child = Child.create();',
            'child.describe("ready");'
        ].join('\n');
        const { service, document } = await openClassDocument(source);
        const provider = LgdHoverProvider.create(service);
        const accesses = [
            [ 'override String describe', 'override String '.length ],
            [ 'base.describe', 'base.'.length ],
            [ 'this.describe', 'this.'.length ],
            [ 'child.describe', 'child.'.length ]
        ];

        for(const [ phrase, delta ] of accesses)
        {
            const hover = await provider.provideHover(document, positionIn(document, phrase, delta));
            expect(hover.contents).toContain('Describes the selected label.');
            expect(hover.contents).toContain('**@param** `label` - The label to describe.');
            expect(hover.contents).toContain('**@returns** - The formatted label.');
        }

        const detail = service.getThisMemberDetail(document, positionIn(document, 'this.describe'), 'describe');
        expect(detail.documentation.description).toBe('Describes the selected label.');
        const summary = await service.getTypeSummary(document.uri, 'Child');
        expect(summary.members.find(member => member.name === 'describe').documentation).toEqual(detail.documentation);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    test('retains checked abstract signature types alongside inherited prose on untyped overrides', async () =>
    {
        const { service, document } = await openClassDocument([
            'abstract class Parent {',
            '  /**',
            '   * @description Describes the selected label.',
            '   * @param label The label to describe.',
            '   * @returns The formatted label.',
            '   */',
            '  abstract String describe(String label);',
            '}',
            'class Child : Parent {',
            '  override describe(selected) { return selected; }',
            '  String call(String label) { return this.describe(label); }',
            '}',
            'Child child = Child.create();',
            'child.describe("ready");'
        ].join('\n'));
        const provider = LgdHoverProvider.create(service);
        const accesses = [
            [ 'override describe', 'override '.length ],
            [ 'this.describe', 'this.'.length ],
            [ 'child.describe', 'child.'.length ]
        ];

        for(const [ phrase, delta ] of accesses)
        {
            const hover = await provider.provideHover(document, positionIn(document, phrase, delta));
            expect([ phrase, hover.contents ]).toEqual([ phrase, expect.stringContaining('String Child.describe(String selected)') ]);
            expect(hover.contents).toContain('Describes the selected label.');
            expect(hover.contents).toContain('**@param** `selected` - The label to describe.');
            expect(hover.contents).toContain('**@returns** - The formatted label.');
        }

        const detail = service.getThisMemberDetail(document, positionIn(document, 'this.describe'), 'describe');
        expect(detail.returnTypeName).toBe('String');
        expect(detail.params).toEqual([expect.objectContaining({ name: 'selected', typeName: 'String' })]);
    });

    test('keeps own method prose unless an explicit inheritdoc marker selects the inherited docs', async () =>
    {
        const source = [
            'class Parent {',
            '  /**',
            '   * @description Parent description.',
            '   * @param label Parent parameter prose.',
            '   * @returns Shared return prose.',
            '   */',
            '  virtual String describe(String label) { return label; }',
            '}',
            'class Child : Parent {',
            '  /**',
            '   * @description Child description.',
            '   * @param label Child parameter prose.',
            '   */',
            '  public override String describe(String label) { return label; }',
            '}'
        ].join('\n');
        const { service, document } = await openClassDocument(source);
        const hover = await LgdHoverProvider.create(service).provideHover(document, positionIn(document, 'describe(String'));

        expect(hover.contents).toContain('public String Child.describe(String label)');
        expect(hover.contents).toContain('Child description.');
        expect(hover.contents).toContain('Child parameter prose.');
        expect(hover.contents).not.toContain('Shared return prose.');
        expect(hover.contents).not.toContain('Parent description.');
        expect(hover.contents).not.toContain('Parent parameter prose.');

        const explicitSource = source.replace('   * @description Child description.', '   * @inheritdoc\n   * @description Child description.');
        const inherited = await openClassDocument(explicitSource);
        const inheritedHover = await LgdHoverProvider.create(inherited.service).provideHover(inherited.document, positionIn(inherited.document, 'describe(String'));
        expect(inheritedHover.contents).toContain('Parent description.');
        expect(inheritedHover.contents).toContain('Parent parameter prose.');
        expect(inheritedHover.contents).toContain('Shared return prose.');
        expect(inheritedHover.contents).not.toContain('Child description.');
        expect(inheritedHover.contents).not.toContain('Child parameter prose.');
    });

    test('marks class names, base names and constructors as types while leaving methods to the grammar', async () =>
    {
        const { service, document } = await openClassDocument();
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const names = tokens.pushed.filter(token => token.tokenType === 'class').map(token => document.getText(token.range));

        expect(names.filter(name => name === 'BaseCommand')).toEqual([ 'BaseCommand', 'BaseCommand', 'BaseCommand' ]);
        expect(names.filter(name => name === 'GoToAssignment')).toHaveLength(2);
        expect(names).toContain('String');
        expect(names).toContain('vscode.TextDocument');
        expect(names).not.toContain('executeCommand');
        expect(tokens.pushed.some(token => token.tokenType === 'parameter')).toBe(true);
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

        expect(members.map(member => member.name)).toEqual([ 'execute', 'title' ]);
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
            'const Object Root = require("./Root.js");',
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

    test('refreshes inherited hover prose when an imported ancestor documentation changes', async () =>
    {
        const rootPath = path.join(directory, 'Root.lgd');
        const rootSource = [
            'class Root {',
            '  /**',
            '   * @description Original description.',
            '   * @param label Original parameter prose.',
            '   * @returns Original return prose.',
            '   */',
            '  virtual String describe(String label) { return label; }',
            '}',
            'module.exports = Root;'
        ].join('\n');
        await fs.promises.writeFile(rootPath, rootSource);
        await fs.promises.writeFile(path.join(directory, 'Middle.lgd'), [
            'const Root = require("./Root.js");',
            'class Middle : Root {',
            '  override String describe(String label) { return base.describe(label); }',
            '}',
            'module.exports = Middle;'
        ].join('\n'));
        const { service, document } = await openClassDocument([
            'const Middle = require("./Middle.js");',
            'class Child : Middle {',
            '  override String describe(String label) { return base.describe(label); }',
            '  String call(String label) { return this.describe(label); }',
            '}'
        ].join('\n'), `file://${path.join(directory, 'Child.lgd')}`);
        const provider = LgdHoverProvider.create(service);
        const position = positionIn(document, 'this.describe', 'this.'.length);
        const initial = await provider.provideHover(document, position);
        expect(initial.contents).toContain('Original description.');
        expect(initial.contents).toContain('Original parameter prose.');
        expect(initial.contents).toContain('Original return prose.');

        await fs.promises.writeFile(rootPath, rootSource.replace(/Original/g, 'Updated'));
        await service.invalidateFile(rootPath);

        const refreshed = await provider.provideHover(document, position);
        expect(refreshed.contents).toContain('Updated description.');
        expect(refreshed.contents).toContain('Updated parameter prose.');
        expect(refreshed.contents).toContain('Updated return prose.');
        expect(refreshed.contents).not.toContain('Original');
        const summary = await service.getTypeSummary(document.uri, 'Middle');
        expect(summary.members.find(member => member.name === 'describe').documentation.description).toBe('Updated description.');
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
