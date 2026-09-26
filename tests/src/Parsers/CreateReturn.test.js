const FileParser = require('../../../src/Parsers/FileParser');
const VscodeError = require('../../../src/Errors/VscodeError');

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
