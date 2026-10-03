const virtualMachine = require('vm');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdEnumConversion = require('../../../src/Compilers/LgdEnumConversion');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');

/** @description Compiles a source using the shared LGD compiler. */
function compile(source, options = {})
{
    return LgdCompiler.create().compileToJs(source, new Map(), options);
}

/** @description Downloads retain their exact wire values in both JavaScript object models. */
const downloadSource = [
    'enum DownloadState {',
    "    Progress = 'progress',",
    "    Started = 'started',",
    "    Failed = 'failed',",
    "    Completed = 'completed',",
    '}'
].join('\n');

describe('explicit LGD enum syntax', () =>
{
    test.each([ 'oloo', 'class' ])('preserves frozen runtime values in %s output', objectModel =>
    {
        const result = compile(downloadSource, { javascriptObjectModel: objectModel });
        expect(result.errors).toEqual([]);
        const runtime = virtualMachine.runInNewContext(`${result.code}\n({ frozen: Object.isFrozen(DownloadState), values: Object.values(DownloadState) });`);
        expect(runtime.frozen).toBe(true);
        expect(runtime.values).toEqual([ 'progress', 'started', 'failed', 'completed' ]);
        expect(result.code).toContain('const DownloadState = Object.freeze(');
    });

    test('exports and numeric values are preserved without reverse mappings', () =>
    {
        const result = compile('export enum Result { Failed = -1, Good = 0x10, Same = 16 };');
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('export const Result = Object.freeze(');
        const runtime = virtualMachine.runInNewContext(`${result.code.replace('export const', 'const')}\nResult;`);
        expect(Object.keys(runtime)).toEqual([ 'Failed', 'Good', 'Same' ]);
        expect(runtime.Failed).toBe(-1);
        expect(runtime.Good).toBe(runtime.Same);
    });

    test.each([
        'enum State { Started }',
        "enum State { Started = 'started', Other = 1 }",
        "enum State { Started = 'a', Started = 'b' }",
        "enum State { __proto__ = 'a' }",
        'enum State { Started = makeValue() }',
        'enum State { Started = 1 + 2 }',
        'enum State { Started = 1e999 }',
        'enum State { Started = `started` }',
        'enum State { Started = true }',
        "enum Number { Started = 'started' }",
        "enum State { Started = 'a' Other = 'b' }",
        "enum State { Started = 'a'"
    ])('rejects unsupported or ambiguous member forms: %s', source =>
    {
        expect(compile(source).errors.length).toBeGreaterThan(0);
    });

    test('preserves comments, escaped strings, CRLF and exact member mappings', () =>
    {
        const source = "/** Wire state. */\r\nexport enum State {\r\n    // value comment\r\n    Ready = 'it\\'s ready', // trailing\r\n    Done = 'done'\r\n}\r\n";
        const result = compile(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('// value comment');
        expect(result.code).toContain("'it\\'s ready'");
        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
        const map = LgdSourceMap.create(result.mappings);
        for(const name of [ 'State', 'Ready', 'Done' ])
        {
            const sourceOffset = source.indexOf(name);
            const outputOffset = map.toOutput(sourceOffset);
            expect(result.code.slice(outputOffset, outputOffset + name.length)).toBe(name);
            expect(map.toSource(outputOffset)).toBe(sourceOffset);
        }
    });

    test('ignores enum-shaped text in comments and strings', () =>
    {
        const source = "// enum State { A = 'a' }\nconst text = \"enum State { A = 'a' }\";";
        const result = compile(source);
        expect(result.errors).toEqual([]);
        expect(result.declarations).toEqual([]);
        expect(result.code).toBe(source);
    });

    test('checks nominal enum assignments while exposing the serialized primitive type', () =>
    {
        const source = [
            "enum State { Ready = 'ready', Done = 'done' }",
            "enum Other { Ready = 'ready' }",
            'State current = State.Ready;',
            'String wire = current;',
            'String directWire = State.Done;',
            'current = State.Done;',
            "current = 'ready';",
            'current = Other.Ready;',
            'current = State;',
            'Number invalidWire = State.Done;'
        ].join('\n');
        const result = compile(source);
        expect(result.errors.map(error => error.message)).toEqual([
            'Cannot assign String to State.',
            'Cannot assign Other to State.',
            'Cannot assign Object to State.',
            'Cannot assign String to Number.'
        ]);
    });

    test('checks member access and frozen writes with lexical shadowing', () =>
    {
        const source = [
            "enum State { Ready = 'ready' }",
            'State.Missing;',
            "State['Absent'];",
            "State.Ready = 'bad';",
            'State.Ready++;',
            'delete State.Ready;',
            'function run(State) { State.Missing = 1; }'
        ].join('\n');
        const messages = compile(source).errors.map(error => error.message);
        expect(messages).toEqual([
            "Enum 'State' has no member 'Missing'.",
            "Enum 'State' has no member 'Absent'.",
            "Cannot modify frozen enum 'State'.",
            "Cannot modify frozen enum 'State'.",
            "Cannot modify frozen enum 'State'."
        ]);
    });

    test('checks optional reads, known numeric keys and destructuring writes', () =>
    {
        const source = [
            "enum State { Ready = 'ready' }",
            'console.log(State?.Missing);',
            'console.log(State[1]);',
            "[State.Ready] = ['bad'];",
            "({ current: State.Ready } = { current: 'bad' });",
            "for(State.Ready of ['bad']) {}",
            'console.log({ current: State.Ready });'
        ].join('\n');
        expect(compile(source).errors.map(error => error.message)).toEqual([
            "Enum 'State' has no member 'Missing'.",
            "Enum 'State' has no member '1'.",
            "Cannot modify frozen enum 'State'.",
            "Cannot modify frozen enum 'State'.",
            "Cannot modify frozen enum 'State'."
        ]);
    });

    test('does not infer a computed identifier as a literal member name', () =>
    {
        const result = compile("enum State { Ready = 'ready' }\nconst key = 'Ready';\nconst result = State[key];");
        expect(result.errors).toEqual([]);
    });

    test('diagnoses a shadowed Object rather than promising a frozen value', () =>
    {
        const source = "function scope(Object) {\n enum State { Ready = 'ready' }\n}";
        expect(compile(source).errors.map(error => error.message)).toContain('Enum declarations require the native Object.freeze; Object is shadowed in this scope.');
    });

    test('checks typed parameters and method returns using enum identity', () =>
    {
        const source = [
            "enum State { Ready = 'ready' }",
            "Function update = (State state) => { state = 'bad'; };",
            'class Store {',
            '    State read() { return State.Ready; }',
            "    State invalid() { return 'ready'; }",
            '}'
        ].join('\n');
        expect(compile(source).errors.map(error => error.message)).toEqual([
            'Cannot assign String to State.', 'Cannot return String from a State method.'
        ]);
    });

    test('uses resolved enum import metadata while retaining local alias identity checks', () =>
    {
        const source = [
            "const Alias = require('./State');",
            'Alias current = Alias.Ready;',
            'String wire = Alias.Ready;',
            "current = 'ready';",
            'current = Alias;',
            'Alias.Missing;'
        ].join('\n');
        const externals = new Map([[ './State', {
            exportName: 'State', kind: 'enum', keyword: 'Object', enumValueType: 'String',
            members: [{ name: 'Ready', typeName: 'String' }]
        } ]]);
        const result = LgdCompiler.create().compileToJs(source, externals);
        expect(result.errors.map(error => error.message)).toEqual([
            "Enum 'State' has no member 'Missing'.", 'Cannot assign String to Alias.', 'Cannot assign Object to Alias.'
        ]);
    });

    test('TypeScript emits the same frozen runtime form and a value union alias', () =>
    {
        const result = LgdCompiler.create().compileToTs(downloadSource);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('type DownloadState = typeof DownloadState[keyof typeof DownloadState];');
        expect(result.code).toContain('const DownloadState = Object.freeze(');
    });

    test('the experimental C# backend explicitly reports unsupported enum emission', () =>
    {
        const result = LgdCompiler.create().compileToCSharp(downloadSource);
        expect(result.errors.map(error => error.message)).toContain('LGD enum emission is not supported by the experimental C# backend. String-valued enums are not C# enums.');
    });
});

describe('bounded JavaScript to LGD enum conversion', () =>
{
    test('requires explicit selection instead of interpreting arbitrary frozen settings as a type', () =>
    {
        const source = "const Settings = Object.freeze({ Mode: 'fast' });";
        expect(LgdEnumConversion.toLgd(source).code).toBe(source);
    });

    test('preserves exports, comments and values in both directions', () =>
    {
        const source = "export const State = Object.freeze({\n // wire state\n Ready /* key: note */ : 'ready', Done: 'done',\n});";
        const result = LgdEnumConversion.toLgd(source, ['State']);
        expect(result.converted).toEqual(['State']);
        expect(result.skipped).toEqual([]);
        expect(result.code).toContain("Ready /* key: note */ = 'ready'");
        expect(result.code).toContain('export enum State');
        const compiled = compile(result.code);
        expect(compiled.errors).toEqual([]);
        expect(compiled.code).toContain("Ready /* key: note */ : 'ready'");
    });

    test('repeated conversion never accumulates generated typedef aliases', () =>
    {
        let source = downloadSource;
        for(let index = 0; index < [ 'first', 'second', 'third' ].length; index++)
        {
            const compiled = compile(source);
            expect(compiled.errors).toEqual([]);
            expect(compiled.code.match(/@typedef/g)).toHaveLength(1);
            source = LgdEnumConversion.toLgd(compiled.code, ['DownloadState']).code;
        }
    });

    test.each([
        "let State = Object.freeze({ Ready: 'ready' });",
        'const State = Object.freeze({ Ready: getValue() });',
        "const State = Object.freeze({ Ready: 'ready', Count: 1 });",
        "const State = Object.freeze({ ['Ready']: 'ready' });",
        "const State = Object.freeze({ Ready: 'ready', ...other });",
        "const State = Object.freeze({ get Ready() { return 'ready'; } });",
        "const State = Object.freeze({ __proto__: 'ready' });",
        "const State = Object.freeze({ Ready: 'a', Ready: 'b' });",
        "function run(Object) { const State = Object.freeze({ Ready: 'ready' }); }",
        "const State = Object.freeze({ Ready: 'ready' }); State = replacement;",
        "const /* preserve wrapper comment */ State = Object.freeze({ Ready: 'ready' });"
    ])('preserves uncertain source unchanged: %s', source =>
    {
        const result = LgdEnumConversion.toLgd(source, ['State']);
        expect(result.code).toBe(source);
        expect(result.converted).toEqual([]);
        expect(result.skipped).toEqual(['State']);
    });
});
