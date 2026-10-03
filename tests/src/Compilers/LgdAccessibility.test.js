const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

/** @description Compiles visibility fixtures through both supported JavaScript outputs. */
function compile(lines, objectModel = 'oloo', options = {})
{
    return LgdCompiler.create().compileToJs(lines.join('\r\n'), new Map(), { javascriptObjectModel: objectModel, ...options });
}

/** @description Selects access diagnostics while preserving other useful compiler checks. */
function accessErrors(result)
{
    return result.errors.filter(error => error.code?.startsWith('lgd.access.'));
}

describe.each([ 'oloo', 'class' ])('LGD compile-time accessibility in %s output', objectModel =>
{
    test('Preserves public defaults and erases explicit modifiers without runtime wrappers.', () =>
    {
        const result = compile([
            'public class Sample {',
            '    private Number count = 1;',
            '    internal static Number total = 2;',
            '    public Sample() {}',
            '    public Number read() { return count; }',
            '}',
            'Sample value = Sample.create();',
            'value.read();',
            'Sample.total;'
        ], objectModel);
        expect(result.errors).toEqual([]);
        expect(result.code).not.toMatch(/\b(?:public|private|protected|internal)\b/);
        expect(result.allDeclarations[0].classMembers[0].accessibility).toBe('private');
    });

    test('Allows same-class explicit receivers and nested functions, but rejects outside private reads and writes.', () =>
    {
        const lines = [
            'class Sample {',
            '    private Number count;',
            '    Number read(Sample other) { function nested() { return other.count; } return nested(); }',
            '}',
            'Sample value = Sample.create();',
            'value.count;',
            'value["count"] = 2;',
            'const name = "count";',
            'value[name]++;'
        ];
        const result = compile(lines, objectModel);
        expect(accessErrors(result)).toHaveLength([ 'first', 'second', 'third' ].length);
        expect(accessErrors(result).map(error => lines.join('\r\n').slice(error.offset, error.endOffset))).toEqual([ 'count', '"count"', 'name' ]);
    });

    test('Checks getter and setter visibility independently, including compound assignments.', () =>
    {
        const result = compile([
            'class Sample {',
            '    public get Number score() { return 1; }',
            '    private set score(Number next) {}',
            '    update() { score = 2; }',
            '}',
            'Sample value = Sample.create();',
            'value.score;',
            'value.score = 2;',
            'value.score += 1;'
        ], objectModel);
        expect(accessErrors(result)).toHaveLength(2);
        expect(accessErrors(result).every(error => error.message.includes('private'))).toBe(true);
    });

    test('Restricts private constructors at factories and direct new expressions.', () =>
    {
        const result = compile([
            'class Sample {',
            '    private Sample() {}',
            '    static Sample build() { return Sample.create(); }',
            '}',
            'Sample.create();',
            'new Sample();'
        ], objectModel);
        expect(accessErrors(result)).toHaveLength(2);
        expect(accessErrors(result).every(error => error.message.includes('Sample constructor'))).toBe(true);
    });

    test('Checks object aliases without mistaking a shadowed namesake for its class.', () =>
    {
        const result = compile([
            'class Sample { private Number count; }',
            'const value = Sample.create();',
            'const alias = value;',
            'alias.count;',
            'function ordinary(value) { return value.count; }'
        ], objectModel);
        expect(accessErrors(result)).toHaveLength(1);
    });

    test('Requires public implementations of interface contracts.', () =>
    {
        const result = compile([
            'interface IValue { Number read(); }',
            'class Sample : IValue { private Number read() { return 1; } }'
        ], objectModel);
        expect(result.errors.some(error => error.message.includes('must be public'))).toBe(true);
    });

    test('Rejects less accessible types exposed by public members and permits internal containers.', () =>
    {
        const result = compile([
            'internal class Hidden {}',
            'public class Api {',
            '    public Hidden read(Hidden value) { return value; }',
            '    private Hidden keep(Hidden value) { return value; }',
            '}',
            'internal class LocalApi { public Hidden read(Hidden value) { return value; } }'
        ], objectModel);
        expect(accessErrors(result).filter(error => error.code === 'lgd.access.signature')).toHaveLength(2);
    });
});

describe('LGD visibility inheritance and syntax', () =>
{
    test('Locates rewritten implicit access and checks named destructuring reads.', () =>
    {
        const lines = [
            'class Base { private Number secret; }',
            'class Derived : Base { test() { secret; } }',
            'const value = Base.create();',
            'const { secret: copy } = value;',
            'let count; ({ secret: count } = value);'
        ];
        const source = lines.join('\r\n');
        const result = compile(lines);
        expect(accessErrors(result).map(error => source.slice(error.offset, error.endOffset))).toEqual([ 'secret', 'secret', 'secret' ]);
    });

    test('Allows protected access through derived receivers and rejects base and sibling receivers.', () =>
    {
        const result = compile([
            'class Base { protected Number score() { return 1; } protected static Number total; }',
            'class Sibling : Base {}',
            'class Derived : Base {',
            '    test(Derived derived, Base parent, Sibling sibling) {',
            '        this.score(); derived.score(); base.score(); Base.total;',
            '        parent.score(); sibling.score();',
            '    }',
            '}',
            'Derived.create().score();'
        ]);
        expect(accessErrors(result)).toHaveLength([ 'first', 'second', 'third' ].length);
    });

    test('Distinguishes protected member destructuring from protected factory extraction.', () =>
    {
        const result = compile([
            'class Base { protected Base() {} protected Number score() { return 1; } }',
            'class Derived : Base { test(Derived other) { const { score } = other; const { create } = Base; } }'
        ]);
        expect(accessErrors(result)).toHaveLength(1);
        expect(accessErrors(result)[0].message).toContain('create');
    });

    test('Allows protected base construction but rejects explicit base factories inside the derived class.', () =>
    {
        const result = compile([
            'class Base { protected Base() {} }',
            'class Derived : Base { Derived() : base() {} test() { Base.create(); } }',
            'Derived.create();'
        ]);
        expect(accessErrors(result)).toHaveLength(1);
        expect(accessErrors(result)[0].message).toContain('Base constructor');
    });

    test('Rejects implicit access to a private base constructor.', () =>
    {
        const result = compile([ 'class Base { private Base() {} }', 'class Derived : Base {}' ]);
        expect(accessErrors(result)).toHaveLength(1);
    });

    test('Preserves override access and does not require overriding an inaccessible private method.', () =>
    {
        const result = compile([
            'class Base { protected virtual Number read() { return 1; } private Number hidden() { return 1; } }',
            'class Derived : Base { public override Number read() { return 2; } Number hidden() { return 2; } }'
        ]);
        expect(accessErrors(result).map(error => error.code)).toEqual(['lgd.access.override']);
        expect(result.errors).toHaveLength(1);
    });

    test('Accepts internal interfaces implemented by public classes, but rejects public interface inheritance.', () =>
    {
        const result = compile([
            'internal interface IHidden { Number read(); }',
            'public class Sample : IHidden { Number read() { return 1; } }',
            'public interface IPublic : IHidden {}'
        ]);
        expect(accessErrors(result)).toHaveLength(1);
        expect(accessErrors(result)[0].message).toContain('Public interface');
    });

    test.each([
        [ 'class Sample { public private Number count; }', 'private' ],
        [ 'class Sample { private private Number count; }', 'private' ],
        [ 'private class Sample {}', 'private' ],
        [ 'protected interface ISample {}', 'protected' ],
        [ 'public internal enum Choice { One = 1 }', 'internal' ]
    ])('Rejects conflicting or misplaced modifiers in %s.', (source, token) =>
    {
        const result = compile([source]);
        const error = result.errors.find(candidate => candidate.code?.startsWith('lgd.syntax.'));
        expect(error).toBeTruthy();
        expect(source.slice(error.offset, error.endOffset)).toBe(token);
    });

    test('Accepts public/internal enums and rejects private virtual members.', () =>
    {
        const result = compile([ 'internal enum Choice { One = 1 }', 'class Sample { private virtual Number read() { return 1; } }' ]);
        expect(accessErrors(result).map(error => error.code)).toEqual(['lgd.access.privateVirtual']);
    });

    test('Supports restricted abstract property accessors and matching overrides.', () =>
    {
        const result = compile([
            'abstract class Base { public abstract Number Score { get; protected set; } }',
            'class Derived : Base {',
            '    public override get Number Score() { return 1; }',
            '    protected override set Score(Number value) {}',
            '}',
            'Derived value = Derived.create();',
            'value.Score;',
            'value.Score = 2;'
        ]);
        expect(accessErrors(result)).toHaveLength(1);
        expect(accessErrors(result)[0].message).toContain('protected');
    });
});
