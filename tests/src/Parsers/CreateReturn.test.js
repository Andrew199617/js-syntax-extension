const FileParser = require('../../../src/Parsers/FileParser');
const VscodeError = require('../../../src/Errors/VscodeError');
const hasDirectInstanceReturn = require('../../../src/Parsers/HasDirectInstanceReturn');
const babelParser = require('@babel/parser');

jest.mock('@babel/parser', () =>
{
    const actualParser = jest.requireActual('@babel/parser');
    return { ...actualParser, parse: jest.fn(actualParser.parse) };
});

beforeEach(() =>
{
    global.lgd = {
        configuration: { tabSize: 4, extractPropsAndState: false },
        logger: { logInfo: jest.fn(), logWarning: jest.fn(), logError: jest.fn() }
    };

    VscodeError.create = jest.fn(() => ({
        notifyUser(fileParser)
        {
            fileParser.errorOccurred = true;
        }
    }));
});

describe('Direct returns in create methods', () =>
{
    test.each([
        'Object.create(InvertIf)',
        'Object.assign({}, InvertIf)',
        'Oloo.create(InvertIf)',
        'Oloo.createSlow(InvertIf)',
        'Oloo.assign({}, InvertIf)',
        'Oloo.assignSlow({}, InvertIf)'
    ])('accepts return %s without changing subsequent declarations', async expression =>
    {
        const source = `const InvertIf = {
    /** @returns {InvertIfType} */
    create()
    {
        return ${expression};
    },
    execute()
    {
        return true;
    }
};
const AnotherCommand = {
    isEnabled()
    {
        return true;
    }
};`;
        const fileParser = FileParser.create();
        const declaration = await fileParser.parse('', source);

        expect(VscodeError.create).not.toHaveBeenCalled();
        expect(fileParser.errorOccurred).toBe(false);
        expect(fileParser.tabSize).toBe(0);
        expect(declaration).toBe('\ndeclare interface InvertIfType {\n\t/** @returns {InvertIfType} */\n\tcreate(): InvertIfType;\n\n\texecute(): boolean;\n}\n\ndeclare interface AnotherCommandType {\n\tisEnabled(): boolean;\n}\n');
    });

    test.each([
        'return /* factory */ Object.create(Command);',
        'return (Object.create(Command));',
        'if(enabled) { return Object.create(Command); } return {};',
        'await initialize(); return Object.create(Command);'
    ])('accepts executable instance returns in %s', async body =>
    {
        const fileParser = FileParser.create();

        await fileParser.parseCreate(body);

        expect(VscodeError.create).not.toHaveBeenCalled();
        expect(fileParser.errorOccurred).toBe(false);
    });

    test('keeps named instance properties when an earlier branch returns directly', async () =>
    {
        const source = `const Command = {
    create(enabled)
    {
        if(!enabled) return Object.create(Command);
        const command = Object.create(Command);
        command.enabled = true;
        return command;
    }
};`;
        const fileParser = FileParser.create();
        const declaration = await fileParser.parse('', source);

        expect(VscodeError.create).not.toHaveBeenCalled();
        expect(declaration).toContain('\n\tenabled: boolean;\n');
        expect(fileParser.tabSize).toBe(0);
    });

    test.each([
        'return {};',
        'return;',
        'return Factory.create(Command);',
        'return\nObject.create(Command);',
        '// return Object.create(Command);\nreturn {};',
        '/* return Object.create(Command); */ return {};',
        'const example = "return Object.create(Command);"; return {};',
        'const example = `return Object.create(Command);`; return {};',
        'const example = /return Object.create(Command)/; return {};',
        'const example = <span>return Object.create(Command);</span>; return {};',
        'function nested() { return Object.create(Command); } return {};',
        'const nested = () => { return Object.create(Command); }; return {};',
        'return Object.create(Command).value;',
        'return Object.create('
    ])('still reports a missing instance for %s', async body =>
    {
        const fileParser = FileParser.create();

        await fileParser.parseCreate(body);

        expect(VscodeError.create)
            .toHaveBeenCalledWith(
                'LGD: Could not find class instance in create method. Are you creating the instance properly.',
                expect.any(Number),
                0,
                expect.any(Number),
                0,
                expect.any(Number)
            );
        expect(fileParser.errorOccurred).toBe(true);
        expect(fileParser.tabSize).toBe(0);
    });

    test('still checks this assignments before a direct return', async () =>
    {
        const fileParser = FileParser.create();
        fileParser.className = 'Command';

        await fileParser.parseCreate('    this.enabled = true;\n    return Object.create(Command);');

        expect(VscodeError.create).toHaveBeenCalledTimes(1);
        expect(VscodeError.create.mock.calls[0][0]).toContain("Don't use 'this' in create method");
        expect(fileParser.errorOccurred).toBe(true);
    });
});

describe('Direct instance return cache', () =>
{
    test.each([
        [ 'return Object.create(CachedCommand);', true ],
        [ 'return CachedCommand;', false ],
        [ 'return Object.create(CachedCommand', false ]
    ])('parses unchanged text only once: %s', (body, expected) =>
    {
        expect(hasDirectInstanceReturn(body)).toBe(expected);
        expect(hasDirectInstanceReturn(body)).toBe(expected);
        expect(babelParser.parse).toHaveBeenCalledTimes(1);
    });

    test('reparses edited text without reusing its previous result', () =>
    {
        const originalBody = 'return Object.create(EditedCommand);';
        const editedBody = 'return\nObject.create(EditedCommand);';

        expect(hasDirectInstanceReturn(originalBody)).toBe(true);
        expect(hasDirectInstanceReturn(editedBody)).toBe(false);
        expect(hasDirectInstanceReturn(originalBody)).toBe(true);
        expect(babelParser.parse).toHaveBeenCalledTimes(2);
    });

    test('evicts old results after many distinct edits', () =>
    {
        const originalBody = 'return Object.create(EvictedCommand);';
        const editCount = 1000;
        expect(hasDirectInstanceReturn(originalBody)).toBe(true);

        for(let index = 0; index < editCount; index++)
        {
            hasDirectInstanceReturn(`return Object.create(Command${index});`);
        }

        expect(hasDirectInstanceReturn(originalBody)).toBe(true);
        const originalParses = babelParser.parse.mock.calls.filter(([source]) => source === originalBody);
        expect(originalParses).toHaveLength(2);
    });

    test('parses very large bodies without retaining them', () =>
    {
        const commentLength = 1000000;
        const body = `/* ${'x'.repeat(commentLength)} */ return Object.create(LargeCommand);`;

        expect(hasDirectInstanceReturn(body)).toBe(true);
        expect(hasDirectInstanceReturn(body)).toBe(true);
        expect(babelParser.parse).toHaveBeenCalledTimes(2);
    });
});
