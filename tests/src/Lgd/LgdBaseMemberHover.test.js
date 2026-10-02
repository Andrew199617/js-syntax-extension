const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');

/** @description Uri of the LGD document used across base-member hover tests. */
const LGD_URI = 'file:///workspace/DemoCommand.lgd';

/** @description LGD source with a derived class calling into its base. */
const LGD_TEXT = [
    'class DemoBase {',
    '    DemoBase(String commandName, String title) {',
    '        this.command = { command: commandName, title: title };',
    '    }',
    '',
    '    get commandName() {',
    '        return this.command.command;',
    '    }',
    '',
    '    virtual void executeCommand() {',
    '        return;',
    '    }',
    '}',
    '',
    'class DemoCommand: DemoBase {',
    '    DemoCommand(): base("lgd.demo", "Demo") {',
    '    }',
    '',
    '    override async void executeCommand() {',
    '        await base.executeCommand();',
    '    }',
    '}',
    ''
].join('\n');

/** @description Line holding 'await base.executeCommand();'. */
const BASE_CALL_LINE = 19;

/** @description Character inside 'executeCommand' of the base call. */
const BASE_CALL_CHARACTER = 20;

/** @description Line holding the constructor ': base(...)' initializer (not a member access). */
const PLAIN_WORD_LINE = 15;

/** @description Character inside 'base' of the constructor initializer. */
const PLAIN_WORD_CHARACTER = 20;

/**
 * @description Opens the class fixture in a fresh language service.
 * @returns {Promise<object>} the service and document.
 */
async function openClassDocument()
{
    const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
    const document = makeTextDocument(LGD_URI, LGD_TEXT);
    await service.openDocument(document);

    return { service: service, document: document };
}

jest.mock('vscode', () => require('./fakeVscode').createFakeVscode(jest));

beforeEach(() =>
{
    vscode.__reset();
    vscode.commands.executeCommand.mockReset();
});

describe('LGD base. member hover.', () =>
{
    test('getBaseMemberDetail resolves the method on the local base class.', async () =>
    {
        const { service, document } = await openClassDocument();

        const detail = service.getBaseMemberDetail(
            document,
            new vscode.Position(BASE_CALL_LINE, BASE_CALL_CHARACTER),
            'executeCommand'
        );

        expect(detail).not.toBeNull();
        expect(detail.name).toBe('executeCommand');
        expect(detail.kind).toBe('method');
    });

    test('getBaseMemberDetail resolves base properties as well as methods.', async () =>
    {
        const { service, document } = await openClassDocument();

        const detail = service.getBaseMemberDetail(
            document,
            new vscode.Position(BASE_CALL_LINE, BASE_CALL_CHARACTER),
            'commandName'
        );

        expect(detail).not.toBeNull();
        expect(detail.name).toBe('commandName');
    });

    test('getBaseMemberDetail returns null for unknown members.', async () =>
    {
        const { service, document } = await openClassDocument();

        const detail = service.getBaseMemberDetail(
            document,
            new vscode.Position(BASE_CALL_LINE, BASE_CALL_CHARACTER),
            'noSuchMember'
        );

        expect(detail).toBeNull();
    });

    test('provideHover renders the base method instead of the TypeScript any.', async () =>
    {
        const { service, document } = await openClassDocument();
        const provider = LgdHoverProvider.create(service);
        vscode.commands.executeCommand.mockResolvedValue([]);

        const hover = await provider.provideHover(
            document,
            new vscode.Position(BASE_CALL_LINE, BASE_CALL_CHARACTER)
        );

        expect(hover).not.toBeNull();
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
        const text = contents.map(entry => entry.value || entry).join('\n');
        expect(text).toContain('(method) executeCommand()');
    });

    test('provideHover ignores words that are not a base. member access.', async () =>
    {
        const { service, document } = await openClassDocument();
        const provider = LgdHoverProvider.create(service);
        vscode.commands.executeCommand.mockResolvedValue([]);

        const hover = await provider.provideHover(
            document,
            new vscode.Position(PLAIN_WORD_LINE, PLAIN_WORD_CHARACTER)
        );

        expect(hover).toBeNull();
    });
});
