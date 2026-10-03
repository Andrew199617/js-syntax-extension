const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdSemanticTokensProvider = require('../../../src/Lgd/LgdSemanticTokensProvider');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() => vscode.__reset());

describe('Cast editor metadata.', () =>
{
    test('highlights exact cast type names and retains operand parameter/receiver roles', async () =>
    {
        const source = [
            'const vscode = {};',
            'class Reader {',
            '    Number read(String input) { return (Number)input; }',
            '    readPosition(input) { return (vscode.Position?)input; }',
            '    readThis() { return (Number)this.commandName; }',
            '}',
            'const grouped = (input);',
            'const text = "(Number)input";'
        ].join('\n');
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument('file:///workspace/Casts.lgd', source);
        await service.openDocument(document);
        const state = service.getState(document.uri);
        const provider = LgdSemanticTokensProvider.create(service);
        const tokens = await provider.provideDocumentSemanticTokens(document);
        for(const cast of state.casts)
        {
            const selected = tokens.pushed.find(token => document.offsetAt(token.range.start) === cast.typeStart);
            expect(selected.tokenType).toBe('class');
            expect(document.getText(selected.range)).toBe(cast.typeName.replace(/\?$/, ''));
        }

        expect(tokens.pushed.some(token => token.tokenType === 'parameter' && document.getText(token.range) === 'input')).toBe(true);
        expect(tokens.pushed.some(token => token.tokenType === 'lgdExpressionKeyword' && document.getText(token.range) === 'this')).toBe(true);
        const stringStart = source.lastIndexOf('(Number)') + 1;
        expect(tokens.pushed.some(token => document.offsetAt(token.range.start) === stringStart)).toBe(false);
    });

    test('explains numeric conversion versus zero-runtime-check reference assertions on hover', async () =>
    {
        const source = 'class Item {}\nconst raw = {};\nconst item = (Item)raw;\nconst amount = (Number)"1";';
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const document = makeTextDocument('file:///workspace/Casts.lgd', source);
        await service.openDocument(document);
        const provider = LgdHoverProvider.create(service);
        const reference = await provider.provideHover(document, document.positionAt(source.indexOf('(Item)') + 1));
        const numeric = await provider.provideHover(document, document.positionAt(source.indexOf('(Number)') + 1));
        expect(reference.contents).toContain('no runtime check');
        expect(numeric.contents).toContain('JavaScript Number');
        expect(numeric.contents).toContain('NaN');
        expect(document.getText(reference.range)).toBe('Item');
    });
});
