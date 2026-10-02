const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdSemanticTokensProvider = require('../../../src/Lgd/LgdSemanticTokensProvider');

/** @description Uri of the LGD document used across semantic token tests. */
const LGD_URI = 'file:///workspace/Typed.lgd';

/** @description LGD source with typed params and a JSDoc type tag. */
const LGD_TEXT = [
    'readonly Object Commands = {',
    '    findNextChar(vscode.TextDocument document, Number line) {',
    '        return line;',
    '    },',
    '    create() {',
    '        /** @type {vscode.Command} */',
    '        this.command = {};',
    '        return this;',
    '    }',
    '};',
    ''
].join('\n');

/**
 * @description Opens the typed fixture in a fresh language service.
 * @returns {Promise<object>} the service and document.
 */
async function openTypedDocument()
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
    const document = makeTextDocument(LGD_URI, LGD_TEXT);
    await service.openDocument(document);

    return { service: service, document: document };
}

/**
 * @description Reads the token text for one pushed token.
 * @param {object} document the text document.
 * @param {object} token the pushed {range, tokenType} token.
 * @returns {string} the covered text.
 */
function tokenText(document, token)
{
    return document.getText(token.range);
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() =>
{
    vscode.__reset();
});

describe('LgdSemanticTokensProvider', () =>
{
    test('reports class tokens for typed parameter types.', async () =>
    {
        const { service, document } = await openTypedDocument();
        const provider = LgdSemanticTokensProvider.create(service);

        const tokens = provider.provideDocumentSemanticTokens(document);

        expect(tokens).not.toBeNull();
        const texts = tokens.pushed.map(token => tokenText(document, token));
        expect(texts).toContain('vscode.TextDocument');
        expect(texts).toContain('Number');
        for(const token of tokens.pushed)
        {
            expect(token.tokenType).toBe('class');
        }
    });

    test('reports a class token for the JSDoc @type tag.', async () =>
    {
        const { service, document } = await openTypedDocument();
        const provider = LgdSemanticTokensProvider.create(service);

        const tokens = provider.provideDocumentSemanticTokens(document);

        const texts = tokens.pushed.map(token => tokenText(document, token));
        expect(texts).toContain('vscode.Command');
    });

    test('returns null when the document is not open.', () =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const provider = LgdSemanticTokensProvider.create(service);
        const document = makeTextDocument(LGD_URI, LGD_TEXT);

        expect(provider.provideDocumentSemanticTokens(document)).toBeNull();
    });

    test('exposes class in the legend.', () =>
    {
        expect(LgdSemanticTokensProvider.legend.tokenTypes).toContain('class');
    });
});

test('semantic JSDoc types exclude comment-looking text inside strings and line comments', () =>
{
    const service = LgdLanguageService.create({}, () => undefined);
    const provider = LgdSemanticTokensProvider.create(service);
    const source = [
        'const text = "/** @type {FakeType} */";',
        '// /** @type {CommentedType} */',
        '/** @type {ActualType} */',
        'Object settings = {};'
    ].join('\n');

    expect(provider.collectTypeSpans(source, []).map(span => source.slice(span.start, span.end))).toEqual(['ActualType']);
});
