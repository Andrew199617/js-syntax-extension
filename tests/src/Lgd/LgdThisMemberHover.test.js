const vscode = require('vscode');
const { makeTextDocument } = require('./fakeVscode');
const LgdLanguageService = require('../../../src/Lgd/LgdLanguageService');
const LgdHoverProvider = require('../../../src/Lgd/LgdHoverProvider');

/** @description Uri of the LGD document used across this-member hover tests. */
const LGD_URI = 'file:///workspace/BaseCommand.lgd';

/** @description LGD source mirroring the OLOO builder pattern in BaseCommand.lgd. */
const LGD_TEXT = [
    'readonly Object BaseCommand = {',
    '    create(String commandName, String title) {',
    '        readonly Object baseCommand = Object.create(BaseCommand);',
    '',
    '        /** @type {vscode.Command} */',
    '        baseCommand.command = {',
    '            title: title,',
    '            command: commandName',
    '        };',
    '',
    '        return baseCommand;',
    '    },',
    '    get commandName() {',
    '        return this.command.command;',
    '    }',
    '};',
    ''
].join('\n');

/** @description Line holding 'return this.command.command;'. */
const THIS_COMMAND_LINE = 13;

/** @description Character inside the 'command' of 'this.command'. */
const THIS_COMMAND_CHARACTER = 20;

/** @description Line holding the plain 'title' word used for the negative hover case. */
const PLAIN_WORD_LINE = 6;

/** @description Character inside the second 'title' on the plain-word line. */
const PLAIN_WORD_CHARACTER = 20;

/**
 * @description Opens the OLOO fixture in a fresh language service.
 * @returns {Promise<object>} the service and document.
 */
async function openOlooDocument()
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

describe('LGD this. member hover.', () =>
{
    test('getTypeSummary lists the property create() assigns as a member.', async () =>
    {
        const { service } = await openOlooDocument();

        const summary = await service.getTypeSummary(LGD_URI, 'BaseCommand');

        expect(summary.members.map(member => member.name)).toContain('command');
    });

    test('getThisMemberDetail reports the declared type and literal shape.', async () =>
    {
        const { service, document } = await openOlooDocument();

        const detail = service.getThisMemberDetail(
            document,
            new vscode.Position(THIS_COMMAND_LINE, THIS_COMMAND_CHARACTER),
            'command'
        );

        expect(detail).not.toBeNull();
        expect(detail.name).toBe('command');
        expect(detail.typeName).toBe('vscode.Command');
        expect(detail.properties).toEqual([ 'title', 'command' ]);
    });

    test('provideHover renders the create() property instead of falling through.', async () =>
    {
        const { service, document } = await openOlooDocument();
        const provider = LgdHoverProvider.create(service);
        vscode.commands.executeCommand.mockResolvedValue([]);

        const hover = await provider.provideHover(
            document,
            new vscode.Position(THIS_COMMAND_LINE, THIS_COMMAND_CHARACTER)
        );

        expect(hover).not.toBeNull();
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
        const text = contents.map(entry => entry.value || entry).join('\n');
        expect(text).toContain('(property) command: vscode.Command');
        expect(text).toContain('title,');
        expect(text).toContain('command,');
    });

    test('this member hover takes precedence over an unrelated top-level name', async () =>
    {
        const service = LgdLanguageService.create({ set: () => undefined, delete: () => undefined }, () => undefined);
        const source = `Object command = { unrelated: 1 };\n${LGD_TEXT}`;
        const document = makeTextDocument(LGD_URI, source);
        await service.openDocument(document);
        const provider = LgdHoverProvider.create(service);

        const hover = await provider.provideHover(document, new vscode.Position(THIS_COMMAND_LINE + 1, THIS_COMMAND_CHARACTER));

        expect(hover.contents).toContain('(property) command: vscode.Command');
        expect(hover.contents).not.toContain('unrelated');
    });

    test('provideHover ignores words that are not a this. member access.', async () =>
    {
        const { service, document } = await openOlooDocument();
        const provider = LgdHoverProvider.create(service);
        vscode.commands.executeCommand.mockResolvedValue([]);

        const hover = await provider.provideHover(document, new vscode.Position(PLAIN_WORD_LINE, PLAIN_WORD_CHARACTER));

        expect(hover).toBeNull();
    });
});

describe('LGD create() member extraction regressions', () =>
{
    test('ignores assignments and return names in comments and strings', () =>
    {
        const service = LgdLanguageService.create({}, () => undefined);
        const source = [
            '{ create() {',
            '  // this.commented = 1;',
            '  const sample = "this.quoted = 2; return unrelated;";',
            '  /* return unrelated; */',
            '  unrelated.noise = 3;',
            '  this.actual = 4;',
            '  return this;',
            '} }'
        ].join('\n');

        expect(service.extractCreateMembers(source).map(member => member.name)).toEqual(['actual']);
    });

    test('reads only the object own create method and handles parameter defaults', () =>
    {
        const service = LgdLanguageService.create({}, () => undefined);
        const source = '{ nested: { create() { this.wrong = 1; } }, create(Number count = Number("1")) { this.right = count; return this; } }';

        expect(service.extractCreateMembers(source).map(member => member.name)).toEqual(['right']);
    });

    test('preserves literal property names around commas, brackets and comments in values', () =>
    {
        const service = LgdLanguageService.create({}, () => undefined);
        const source = '{ create() { this.settings = { label: "[", /* separator , */ enabled: true, nested: { ignored: 1 }, shorthand }; return this; } }';

        expect(service.extractCreateMembers(source)[0].properties).toEqual([ 'label', 'enabled', 'nested', 'shorthand' ]);
    });
});
