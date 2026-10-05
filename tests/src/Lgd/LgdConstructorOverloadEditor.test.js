const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdSemanticTokensProvider = require('../../../src/Lgd/LgdSemanticTokensProvider');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');
const LgdConstructorHover = require('../../../src/Lgd/LgdConstructorHover');
const LgdFactoryMigration = require('../../../src/Compilers/LgdFactoryMigration');
const { makeTextDocument } = require('./fakeVscode');

/** @description Opens overload source using the real language service with only the editor transport replaced. */
async function open(source, options = {})
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, error =>
    {
        throw error;
    }, () => options);

    const document = makeTextDocument('file:///workspace/BaseCommand.lgd', source);
    const state = await service.openDocument(document);
    return { service: service, document: document, state: state };
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() => vscode.__reset());

describe('Constructor overload editor metadata.', () =>
{
    test('Highlights every constructor as a type while retaining parameters and later accessors.', async () =>
    {
        const source = [
            'class BaseCommand {',
            '    BaseCommand(String commandName, String title) { this.command = { title, command: commandName }; }',
            '    BaseCommand() {}',
            '    get String commandName() { return this.command.command; }',
            '}'
        ].join('\n');
        const { service, document } = await open(source);
        const provider = LgdSemanticTokensProvider.create(service);
        const tokens = await provider.provideDocumentSemanticTokens(document);
        const constructors = tokens.pushed.filter(token => document.getText(token.range) === 'BaseCommand');
        const expectedNames = 3;
        expect(constructors).toHaveLength(expectedNames);
        expect(constructors.every(token => token.tokenType === 'class')).toBe(true);
        expect(tokens.pushed.some(token => token.tokenType === 'parameter' && document.getText(token.range) === 'commandName')).toBe(true);
        const summary = await service.getTypeSummary(document.uri, 'BaseCommand');
        expect(summary.constructorSignatures).toHaveLength(2);
        expect(summary.members.map(member => member.name)).toContain('command');
        const hover = LgdHoverProvider.renderTypeSummary(summary);
        expect(hover).toContain('create(String commandName, String title)');
        expect(hover).toContain('create()');
    });

    test('Recovers a malformed member into a valid mirror and retains later constructor hovers.', async () =>
    {
        const source = 'class BaseCommand { static BaseCommand(String name) {} BaseCommand() {} get String title() { return "ready"; } }';
        const { service, document, state } = await open(source);
        const provider = LgdHoverProvider.create(service);
        const offset = source.indexOf('BaseCommand()');
        const hover = await provider.provideHover(document, document.positionAt(offset));
        expect(hover).not.toBeNull();
        expect(state.jsDocument.getText()).not.toContain('static BaseCommand');
        expect(state.jsDocument.getText()).toContain('get  title()');
        expect(state.declarations[0].constructorMembers).toHaveLength(1);
    });

    test('Retains independent inferred members and all imported signature/cache metadata.', async () =>
    {
        const source = 'class BaseCommand { BaseCommand(String title) { this.title = title; } BaseCommand() { this.ready = true; } }';
        const { service, document, state } = await open(source);
        const summary = await service.getTypeSummary(document.uri, 'BaseCommand');
        expect(summary.members.map(member => member.name)).toEqual(expect.arrayContaining([ 'title', 'ready' ]));
        const original = service.exportSignature({ ...summary, constructorSignatures: summary.constructorSignatures });
        const changed = service.exportSignature({ ...summary, constructorSignatures: [summary.constructorSignatures[0]] });
        expect(original).not.toBe(changed);
        expect(LgdFactoryMigration.read(source, state.declarations[0], state.declarations)).toBeNull();
    });
});

describe.each([ 'oloo', 'class' ])('Constructor call previews with %s output.', javascriptObjectModel =>
{
    const declaration = [
        'class Command {',
        '    Command() {}',
        '    Command(String commandName, String title) { this.command = commandName; }',
        '    get String commandName() { return this.command; }',
        '}'
    ].join('\n');

    test('Shows only constructor signatures at the new keyword and callee, including arity errors.', async () =>
    {
        const source = `${declaration}\nconst invalid = new Command("one");`;
        const { service, document, state } = await open(source, { javascriptObjectModel: javascriptObjectModel });
        expect(state.errors.some(error => error.code === 'lgd.constructor.argumentCount')).toBe(true);
        const provider = LgdHoverProvider.create(service);
        for(const offset of [ source.indexOf('new Command'), source.indexOf('Command("one")') ])
        {
            const hover = await provider.provideHover(document, document.positionAt(offset));
            expect(hover.contents).toBe('```lgd-constructor\nnew Command()\nnew Command(String commandName, String title)\n```');
            expect(document.getText(hover.range)).toBe('new Command');
        }

        const classHover = await provider.provideHover(document, document.positionAt(source.indexOf('Command {')));
        expect(classHover.contents).toContain('class Command {');
        expect(classHover.contents).toContain('commandName: String');
        expect(classHover.contents).toContain('command: String');
    });

    test('Shows parameter types and names over an erroneous literal with the relevant overload first.', async () =>
    {
        const source = `${declaration}\nconst invalid = new Command(7, "Run");`;
        const { service, document } = await open(source, { javascriptObjectModel: javascriptObjectModel });
        const hover = await LgdHoverProvider.create(service).provideHover(document, document.positionAt(source.indexOf('7, "Run"')));
        expect(hover.contents).toBe('```lgd-constructor\nnew Command(String commandName, String title)\nnew Command()\n```\n\nArgument 1: `String commandName`');
        expect(document.getText(hover.range)).toBe('7');
    });

    test('Preserves nullable, default, and rest parameter syntax without guessing spread arity.', async () =>
    {
        const source = [
            'class Flexible {',
            '    Flexible() {}',
            '    Flexible(String? label, Number attempts = 2) {}',
            '    Flexible(String label, Number attempts, Boolean active, ...String tags) {}',
            '}',
            'const values = [];',
            'const instance = new Flexible(...values);'
        ].join('\n');
        const { service, document } = await open(source, { javascriptObjectModel: javascriptObjectModel });
        const hover = await LgdHoverProvider.create(service).provideHover(document, document.positionAt(source.indexOf('new Flexible')));
        expect(hover.contents).toBe('```lgd-constructor\nnew Flexible()\nnew Flexible(String? label, Number attempts = 2)\nnew Flexible(String label, Number attempts, Boolean active, ...String tags)\n```');
        const constructor = await LgdHoverProvider.create(service).provideHover(document, document.positionAt(source.indexOf('Flexible(String?')));
        expect(constructor.contents).toBe('```lgd-constructor\nFlexible(String? label, Number attempts = 2)\n```');
    });

    test('Shows the active rest parameter for extra erroneous arguments.', async () =>
    {
        const source = 'class Tags { Tags() {} Tags(String name, ...String tags) {} } const invalid = new Tags("one", "two", 7);';
        const { service, document } = await open(source, { javascriptObjectModel: javascriptObjectModel });
        const hover = await LgdHoverProvider.create(service).provideHover(document, document.positionAt(source.indexOf('7);')));
        expect(hover.contents).toContain('new Tags(String name, ...String tags)');
        expect(hover.contents).toContain('Argument 3: `...String tags`');
    });

    test('Filters private constructors outside the owner and retains them inside its methods.', async () =>
    {
        const source = [
            'class Guarded {',
            '    Guarded() {}',
            '    private Guarded(String secret) {}',
            '    protected Guarded(String name, Number count) {}',
            '    static inside() { return new Guarded("inside"); }',
            '}',
            'const outside = new Guarded("outside");'
        ].join('\n');
        const { service, document } = await open(source, { javascriptObjectModel: javascriptObjectModel });
        const provider = LgdHoverProvider.create(service);
        const outside = await provider.provideHover(document, document.positionAt(source.indexOf('new Guarded("outside")')));
        expect(outside.contents).toBe('```lgd-constructor\nnew Guarded()\n```');
        const inside = await provider.provideHover(document, document.positionAt(source.indexOf('new Guarded("inside")')));
        expect(inside.contents).toContain('new Guarded(String secret)');
        expect(inside.contents).toContain('new Guarded(String name, Number count)');
        const constructor = await provider.provideHover(document, document.positionAt(source.indexOf('Guarded(String secret)')));
        expect(constructor.contents).toBe('```lgd-constructor\nprivate Guarded(String secret)\n```');
    });

    test('Does not suggest inaccessible constructors or claim abstract classes are constructible.', async () =>
    {
        const source = 'class Hidden { private Hidden() {} }\nabstract class Abstract {}\nnew Hidden(); new Abstract();';
        const { service, document } = await open(source, { javascriptObjectModel: javascriptObjectModel });
        const provider = LgdHoverProvider.create(service);
        const hidden = await provider.provideHover(document, document.positionAt(source.indexOf('new Hidden')));
        expect(hidden.contents).toBe('No constructors are accessible here.');
        const abstract = await provider.provideHover(document, document.positionAt(source.indexOf('new Abstract')));
        expect(abstract.contents).toContain('Abstract classes cannot be constructed directly.');
    });

    test('Supports implicit zero-argument constructors and source-spelled factory aliases.', async () =>
    {
        const source = 'class Empty {} const Alias = Empty; const make = Alias.create; new Alias(); Alias.create(); make();';
        const { service, document } = await open(source, { javascriptObjectModel: javascriptObjectModel });
        const provider = LgdHoverProvider.create(service);
        for(const phrase of [ 'new Alias()', 'Alias.create()', 'make()' ])
        {
            const hover = await provider.provideHover(document, document.positionAt(source.indexOf(phrase)));
            const language = phrase.startsWith('new ') ? 'lgd-constructor' : 'lgd';
            expect(hover.contents).toBe(`\`\`\`${language}\n${phrase}\n\`\`\``);
        }
    });

    test('Leaves same-named properties, ordinary argument values, and shadowed class bindings alone.', async () =>
    {
        const source = [
            declaration,
            'const text = "okay";',
            'const holder = { Command: 1 }; holder.Command;',
            'const valid = new Command(text, "Run");',
            'function other(Command) { return new Command(); }'
        ].join('\n');
        const { document, state } = await open(source, { javascriptObjectModel: javascriptObjectModel });
        for(const phrase of [ 'holder.Command;', 'text, "Run"', 'new Command();' ])
        {
            expect(LgdConstructorHover.get(state, document.positionAt(source.indexOf(phrase)))).toBeNull();
        }
    });

    test('Uses the innermost constructor error and rejects stale document state.', async () =>
    {
        const source = `${declaration}\nclass Outer { Outer(Object value) {} } new Outer(new Command(7, "Run"));`;
        const { service, document, state } = await open(source, { javascriptObjectModel: javascriptObjectModel });
        const position = document.positionAt(source.indexOf('7, "Run"'));
        const hover = await LgdHoverProvider.create(service).provideHover(document, position);
        expect(hover.contents).toContain('new Command(String commandName, String title)');
        expect(hover.contents).not.toContain('Outer');
        document.setText(`${source}\n`);
        expect(LgdConstructorHover.get(state, position)).toBeNull();
    });

    test.each([ '{ title } = {}', '...[title]' ])('Preserves destructured parameter patterns locally and across imports: %s.', async parameters =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-pattern-hovers-'));
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, error =>
        {
            throw error;
        }, () => ({ javascriptObjectModel: javascriptObjectModel }));

        const source = `class Pattern { Pattern(${parameters}) {} }\nnew Pattern();\nmodule.exports = Pattern;`;
        const root = makeTextDocument(`file://${path.join(directory, 'Pattern.lgd')}`, source);
        const consumerSource = 'const Alias = require("./Pattern"); new Alias();';
        const consumer = makeTextDocument(`file://${path.join(directory, 'Consumer.lgd')}`, consumerSource);
        try
        {
            await service.openDocument(root);
            await service.openDocument(consumer);
            const provider = LgdHoverProvider.create(service);
            const local = await provider.provideHover(root, root.positionAt(source.indexOf('new Pattern')));
            expect(local.contents).toContain(`new Pattern(${parameters})`);
            const imported = await provider.provideHover(consumer, consumer.positionAt(consumerSource.indexOf('new Alias')));
            expect(imported.contents).toContain(`new Alias(${parameters})`);
        }
        finally
        {
            await service.pendingDependencyUpdates;
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });

    test('Retains imported aliases and refreshes every accessible overload after an exporter edit.', async () =>
    {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lgd-constructor-hovers-'));
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, error =>
        {
            throw error;
        }, () => ({ javascriptObjectModel: javascriptObjectModel }));

        const rootSource = `${declaration}\nmodule.exports = Command;`;
        const root = makeTextDocument(`file://${path.join(directory, 'Command.lgd')}`, rootSource);
        const consumerSource = 'const Alias = require("./Command"); new Alias(7, "Run");';
        const consumer = makeTextDocument(`file://${path.join(directory, 'Consumer.lgd')}`, consumerSource);
        try
        {
            await service.openDocument(root);
            await service.openDocument(consumer);
            const provider = LgdHoverProvider.create(service);
            const offset = consumerSource.indexOf('7, "Run"');
            const hover = await provider.provideHover(consumer, consumer.positionAt(offset));
            expect(hover.contents).toContain('new Alias(String commandName, String title)');
            expect(hover.contents).toContain('Argument 1: `String commandName`');
            root.setText(rootSource.replace('Command() {}', 'private Command() {}').replace('String title)', 'String title = "Default")'));
            await service.updateDocument(root);
            await service.pendingDependencyUpdates;
            const updated = await provider.provideHover(consumer, consumer.positionAt(consumerSource.indexOf('new Alias')));
            expect(updated.contents).toBe('```lgd-constructor\nnew Alias(String commandName, String title = "Default")\n```');
        }
        finally
        {
            await service.pendingDependencyUpdates;
            await fs.promises.rm(directory, { recursive: true, force: true });
        }
    });
});
