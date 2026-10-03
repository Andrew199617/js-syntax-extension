const vscode = require('vscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdSemanticTokensProvider = require('../../../src/Lgd/LgdSemanticTokensProvider');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');
const LgdFactoryMigration = require('../../../src/Compilers/LgdFactoryMigration');
const { makeTextDocument } = require('./fakeVscode');

/** @description Opens overload source using the real language service with only the editor transport replaced. */
async function open(source)
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, error =>
    {
        throw error;
    });

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
