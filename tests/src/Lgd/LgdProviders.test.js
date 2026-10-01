const path = require('path');
const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');
const LgdDefinitionProvider = require('../../../src/Lgd/LgdDefinitionProvider');
const LgdReferenceProvider = require('../../../src/Lgd/LgdReferenceProvider');
const LgdCompletionProvider = require('../../../src/Lgd/LgdCompletionProvider');

/** @description Uri of the LGD document used across provider tests. */
const LGD_URI = 'file:///workspace/examples/Calculator.lgd';

/** @description LGD source with one declaration and one usage. */
const LGD_TEXT = 'Number value = 0;\nvalue = value + 1;\n';

/** @description LGD line holding the typed declaration. */
const DECLARATION_LINE = 0;

/** @description LGD line holding the variable usage. */
const USAGE_LINE = 1;

/** @description Character where the variable name starts in 'Number value = 0;'. */
const NAME_START_CHARACTER = 7;

/** @description Character where the variable name ends in 'Number value = 0;'. */
const NAME_END_CHARACTER = 12;

/** @description Mirror line of the compiled declaration; the JSDoc tag occupies line 0. */
const MIRROR_DECLARATION_LINE = 1;

/** @description Mirror character where the compiled variable name starts. */
const MIRROR_NAME_START = 4;

/** @description Mirror character where the compiled variable name ends. */
const MIRROR_NAME_END = 9;

/** @description Mirror line holding the compiled variable usage. */
const MIRROR_USAGE_LINE = 2;

/** @description End character of the compiled variable usage range. */
const MIRROR_USAGE_END = 5;

/** @description End character of the throwaway range used for outside-mirror locations. */
const THROWAWAY_RANGE_END = 5;

/**
 * @description Opens an LGD document in a fresh language service.
 * @returns {Promise<object>} the service, document, and state.
 */
async function openLgdDocument()
{
    const diagnosticCollection = { set: () => undefined, delete: () => undefined };
    const service = LgdLanguageService.create(diagnosticCollection, () => undefined);
    const document = makeTextDocument(LGD_URI, LGD_TEXT);
    const state = await service.openDocument(document);

    return { service: service, document: document, state: state };
}

/**
 * @description Makes a mirror range for the compiled variable name.
 * @returns {object} the range.
 */
function makeMirrorNameRange()
{
    return new vscode.Range(
        new vscode.Position(MIRROR_DECLARATION_LINE, MIRROR_NAME_START),
        new vscode.Position(MIRROR_DECLARATION_LINE, MIRROR_NAME_END)
    );
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() =>
{
    vscode.__reset();
    vscode.commands.executeCommand.mockReset();
});

describe('LgdHoverProvider', () =>
{
    test('returns null when the document is not open', async () =>
    {
        const diagnosticCollection = { set: () => undefined, delete: () => undefined };
        const service = LgdLanguageService.create(diagnosticCollection, () => undefined);
        const provider = LgdHoverProvider.create(service);
        const document = makeTextDocument(LGD_URI, LGD_TEXT);

        const hover = await provider.provideHover(document, new vscode.Position(DECLARATION_LINE, NAME_START_CHARACTER));

        expect(hover).toBeNull();
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    test('delegates to the mirror and maps the hover range back to LGD', async () =>
    {
        const { service, document, state } = await openLgdDocument();
        const provider = LgdHoverProvider.create(service);
        const jsRange = makeMirrorNameRange();
        vscode.commands.executeCommand.mockResolvedValue([
            { contents: [{ language: 'typescript', value: 'let value: number' }], range: jsRange }
        ]);

        const hover = await provider.provideHover(document, new vscode.Position(DECLARATION_LINE, NAME_START_CHARACTER));

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode.executeHoverProvider',
            state.jsDocument.uri,
            expect.objectContaining({ line: MIRROR_DECLARATION_LINE, character: MIRROR_NAME_START })
        );
        expect(hover.contents).toEqual([{ language: 'typescript', value: 'let value: number' }]);
        expect(hover.range.start.line).toBe(DECLARATION_LINE);
        expect(hover.range.start.character).toBe(NAME_START_CHARACTER);
        expect(hover.range.end.character).toBe(NAME_END_CHARACTER);
    });

    test('returns null when the language service has no hover', async () =>
    {
        const { service, document } = await openLgdDocument();
        const provider = LgdHoverProvider.create(service);
        vscode.commands.executeCommand.mockResolvedValue([]);

        const hover = await provider.provideHover(document, new vscode.Position(DECLARATION_LINE, 0));

        expect(hover).toBeNull();
    });
});

describe('LgdDefinitionProvider', () =>
{
    test('maps mirror definitions back to the LGD document', async () =>
    {
        const { service, document, state } = await openLgdDocument();
        const provider = LgdDefinitionProvider.create(service);
        const jsRange = makeMirrorNameRange();
        vscode.commands.executeCommand.mockResolvedValue([
            { targetUri: state.jsDocument.uri, targetRange: jsRange }
        ]);

        const definitions = await provider.provideDefinition(document, new vscode.Position(USAGE_LINE, 1));

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode.executeDefinitionProvider',
            state.jsDocument.uri,
            expect.objectContaining({ line: MIRROR_USAGE_LINE, character: 1 })
        );
        expect(definitions).toHaveLength(1);
        expect(definitions[0].uri).toBe(document.uri);
        expect(definitions[0].range.start.line).toBe(DECLARATION_LINE);
        expect(definitions[0].range.start.character).toBe(NAME_START_CHARACTER);
    });

    test('drops definitions that point outside the mirror document', async () =>
    {
        const { service, document } = await openLgdDocument();
        const provider = LgdDefinitionProvider.create(service);
        vscode.commands.executeCommand.mockResolvedValue([
            {
                targetUri: { toString: () => 'file:///other/lib.js' },
                targetRange: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, THROWAWAY_RANGE_END))
            }
        ]);

        const definitions = await provider.provideDefinition(document, new vscode.Position(USAGE_LINE, 1));

        expect(definitions).toEqual([]);
    });
});

describe('LgdReferenceProvider', () =>
{
    test('maps mirror references back to LGD and passes includeDeclaration through', async () =>
    {
        const { service, document, state } = await openLgdDocument();
        const provider = LgdReferenceProvider.create(service);
        const jsDeclaration = makeMirrorNameRange();
        const jsUsage = new vscode.Range(new vscode.Position(MIRROR_USAGE_LINE, 0), new vscode.Position(MIRROR_USAGE_LINE, MIRROR_USAGE_END));
        vscode.commands.executeCommand.mockResolvedValue([
            new vscode.Location(state.jsDocument.uri, jsDeclaration),
            new vscode.Location(state.jsDocument.uri, jsUsage)
        ]);

        const references = await provider.provideReferences(
            document,
            new vscode.Position(DECLARATION_LINE, NAME_START_CHARACTER),
            { includeDeclaration: true }
        );

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode.executeReferenceProvider',
            state.jsDocument.uri,
            expect.objectContaining({ line: MIRROR_DECLARATION_LINE, character: MIRROR_NAME_START }),
            { includeDeclaration: true }
        );
        expect(references).toHaveLength(2);
        expect(references[0].uri).toBe(document.uri);
        expect(references[0].range.start).toEqual(expect.objectContaining({ line: DECLARATION_LINE, character: NAME_START_CHARACTER }));
        expect(references[1].range.start).toEqual(expect.objectContaining({ line: USAGE_LINE, character: 0 }));
    });
});

describe('LgdHoverProvider typed function parameters', () =>
{
    /** @description LGD source declaring a typed function. */
    const TYPED_TEXT = 'Function record = (Number value) => {};';

    /** @description Character inside the 'record' name in the typed function declaration. */
    const RECORD_NAME_CHARACTER = 12;

    /** @description LGD source declaring an untyped function. */
    const UNTYPED_TEXT = 'Function run = () => {};';

    /** @description Character inside the 'run' name in the untyped function declaration. */
    const RUN_NAME_CHARACTER = 11;

    /** @description Mirror character where the compiled 'run' name starts. */
    const MIRROR_RUN_START = 4;

    /** @description Mirror character where the compiled 'run' name ends. */
    const MIRROR_RUN_END = 7;

    /**
     * @description Opens the typed-function document in a fresh language service.
     * @returns {Promise<object>} the service and document.
     */
    async function openTypedDocument()
    {
        const diagnosticCollection = { set: () => undefined, delete: () => undefined };
        const service = LgdLanguageService.create(diagnosticCollection, () => undefined);
        const document = makeTextDocument(LGD_URI, TYPED_TEXT);
        await service.openDocument(document);

        return { service: service, document: document };
    }

    test('getTypeSummary includes the typed parameter signature', async () =>
    {
        const { service } = await openTypedDocument();

        const summary = await service.getTypeSummary(LGD_URI, 'record');

        expect(summary).toEqual({
            name: 'record',
            typeName: 'Function',
            readonly: false,
            members: [],
            params: [{ name: 'value', typeName: 'Number' }]
        });
    });

    test('getTypeSummary reports no params for untyped functions', async () =>
    {
        const diagnosticCollection = { set: () => undefined, delete: () => undefined };
        const service = LgdLanguageService.create(diagnosticCollection, () => undefined);
        const document = makeTextDocument(LGD_URI, UNTYPED_TEXT);
        await service.openDocument(document);

        const summary = await service.getTypeSummary(LGD_URI, 'run');

        expect(summary.params).toEqual([]);
    });

    test('renders the typed signature as LGD hover markdown', async () =>
    {
        const { service, document } = await openTypedDocument();
        const provider = LgdHoverProvider.create(service);

        const hover = await provider.provideHover(document, new vscode.Position(0, RECORD_NAME_CHARACTER));

        expect(hover).not.toBeNull();
        expect(hover.contents).toBe([ '```lgd', 'record: Function(Number value)', '```' ].join('\n'));
        expect(hover.range.start).toEqual(expect.objectContaining({ line: 0, character: 9 }));
        expect(hover.range.end).toEqual(expect.objectContaining({ line: 0, character: 15 }));
    });

    test('still delegates untyped functions to the TypeScript mirror', async () =>
    {
        const diagnosticCollection = { set: () => undefined, delete: () => undefined };
        const service = LgdLanguageService.create(diagnosticCollection, () => undefined);
        const document = makeTextDocument(LGD_URI, UNTYPED_TEXT);
        const state = await service.openDocument(document);
        const provider = LgdHoverProvider.create(service);
        const jsRange = new vscode.Range(new vscode.Position(1, MIRROR_RUN_START), new vscode.Position(1, MIRROR_RUN_END));
        vscode.commands.executeCommand.mockResolvedValue([
            { contents: [{ language: 'typescript', value: 'let run: Function' }], range: jsRange }
        ]);

        const hover = await provider.provideHover(document, new vscode.Position(0, RUN_NAME_CHARACTER));

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode.executeHoverProvider',
            state.jsDocument.uri,
            expect.anything()
        );
        expect(hover.contents).toEqual([{ language: 'typescript', value: 'let run: Function' }]);
    });
});

describe('LgdCompletionProvider', () =>
{
    /** @description LGD source declaring an object literal and a member access. */
    const OBJECT_TEXT = 'Object config = { host: "x", connect() {} };\nconfig.';

    /** @description Line holding the member access. */
    const ACCESS_LINE = 1;

    /** @description Character just past the dot in 'config.'. */
    const AFTER_DOT_CHARACTER = 7;

    /** @description Character just past the dot in 'value.'. */
    const VALUE_DOT_CHARACTER = 6;

    /**
     * @description Opens the object-literal document in a fresh language service.
     * @returns {Promise<object>} the service and document.
     */
    async function openObjectDocument(source)
    {
        const diagnosticCollection = { set: () => undefined, delete: () => undefined };
        const service = LgdLanguageService.create(diagnosticCollection, () => undefined);
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);

        return { service: service, document: document };
    }

    test('returns member completions after object dot', async () =>
    {
        const { service, document } = await openObjectDocument(OBJECT_TEXT);
        const provider = LgdCompletionProvider.create(service);

        const items = await provider.provideCompletionItems(document, new vscode.Position(ACCESS_LINE, AFTER_DOT_CHARACTER));

        expect(items).toEqual([
            { label: 'host', kind: vscode.CompletionItemKind.Property },
            { label: 'connect', kind: vscode.CompletionItemKind.Method }
        ]);
    });

    test('resolves the object when member text is partially typed', async () =>
    {
        const { service, document } = await openObjectDocument(`${OBJECT_TEXT}co`);
        const provider = LgdCompletionProvider.create(service);

        const items = await provider.provideCompletionItems(document, new vscode.Position(ACCESS_LINE, AFTER_DOT_CHARACTER + 2));

        expect(items.map(item => item.label)).toEqual([ 'host', 'connect' ]);
    });

    test('returns null when the cursor is not after a member access', async () =>
    {
        const { service, document } = await openObjectDocument(OBJECT_TEXT);
        const provider = LgdCompletionProvider.create(service);

        const items = await provider.provideCompletionItems(document, new vscode.Position(0, 2));

        expect(items).toBeNull();
    });

    test('returns null when the object has no known members', async () =>
    {
        const { service, document } = await openObjectDocument('Number value = 0;\nvalue.');
        const provider = LgdCompletionProvider.create(service);

        const items = await provider.provideCompletionItems(document, new vscode.Position(ACCESS_LINE, VALUE_DOT_CHARACTER));

        expect(items).toBeNull();
    });
});

describe('LgdLanguageService require resolution', () =>
{
    test('maps compiled .js requires back to the .lgd source', () =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);

        expect(service.resolveLgdSourcePath('/repo/src', './Commands/Foo.js')).toBe(path.resolve('/repo/src/Commands/Foo.lgd'));
        expect(service.resolveLgdSourcePath('/repo/src', './Commands/Foo.lgd.js')).toBe(path.resolve('/repo/src/Commands/Foo.lgd'));
        expect(service.resolveLgdSourcePath('/repo/src', './Commands/Foo.lgd')).toBe(path.resolve('/repo/src/Commands/Foo.lgd'));
        expect(service.resolveLgdSourcePath('/repo/src', './Commands/Foo')).toBe(path.resolve('/repo/src/Commands/Foo.lgd'));
        expect(service.resolveLgdSourcePath('/repo/src', 'vscode')).toBeNull();
    });
});
