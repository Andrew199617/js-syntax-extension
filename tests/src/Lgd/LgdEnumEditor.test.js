const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdDefinitionProvider = require('../../../src/Lgd/LgdDefinitionProvider');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');
const LgdCompletionProvider = require('../../../src/Lgd/LgdCompletionProvider');
const LgdSemanticTokensProvider = require('../../../src/Lgd/LgdSemanticTokensProvider');

/** @description Opens a real LGD compiler-backed editor service with a fake transport. */
async function openEnum(source)
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
    const document = makeTextDocument('file:///workspace/DownloadState.lgd', source);
    const state = await service.openDocument(document);
    return { service: service, document: document, state: state };
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() =>
{
    vscode.__reset();
    vscode.commands.executeCommand.mockReset();
});

describe('LGD enum editor integration', () =>
{
    test('shows exact values in the enum hover and provides members at the receiver', async () =>
    {
        const source = "export enum DownloadState { Progress = 'progress', Completed = 'completed' }\nDownloadState.";
        const { service, document } = await openEnum(source);
        const position = document.positionAt(source.length);
        const completions = await LgdCompletionProvider.create(service).provideCompletionItems(document, position);
        expect(completions.map(item => item.label)).toEqual([ 'Progress', 'Completed' ]);
        const hover = await LgdHoverProvider.create(service).provideHover(document, document.positionAt(source.indexOf('DownloadState')));
        expect(hover.contents).toContain('enum DownloadState {');
        expect(hover.contents).toContain("Progress = 'progress'");
        expect(hover.contents).toContain("Completed = 'completed'");
    });

    test('marks enum as a declaration keyword and its name as a type', async () =>
    {
        const source = "enum DownloadState { Progress = 'progress' }";
        const { service, document } = await openEnum(source);
        const tokens = await LgdSemanticTokensProvider.create(service).provideDocumentSemanticTokens(document);
        const declaration = tokens.pushed.find(token => document.getText(token.range) === 'enum');
        expect(declaration.tokenType).toBe('lgdDeclarationKeyword');
        const name = tokens.pushed.find(token => document.getText(token.range) === 'DownloadState');
        expect(name.tokenType).toBe('class');
    });

    test('resolves an enum type annotation to its source declaration name', async () =>
    {
        const source = "enum State { Ready = 'ready' }\nState current = State.Ready;";
        const { service, document } = await openEnum(source);
        const position = document.positionAt(source.indexOf('State current'));
        const definitions = await LgdDefinitionProvider.create(service).provideDefinition(document, position);
        expect(definitions).toHaveLength(1);
        expect(document.getText(definitions[0].range)).toBe('State');
        expect(document.offsetAt(definitions[0].range.start)).toBe(source.indexOf('State'));
    });

    test('updates member values and names after an edit rather than keeping a stale hover', async () =>
    {
        const { service, document } = await openEnum("enum State { Ready = 'ready' }");
        document.setText("enum State { Done = 'done' }");
        await service.updateDocument(document);
        const summary = await service.getTypeSummary(document.uri, 'State');
        expect(summary.members.map(member => member.name)).toEqual(['Done']);
        expect(summary.members[0].valueText).toBe("'done'");
    });
});
