const LgdClassSyntax = require('../../../src/Compilers/LgdClassSyntax');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

function parse(source)
{
    return LgdClassSyntax.parse(source, LgdCompiler.create());
}

describe('LGD interface and abstract syntax.', () =>
{
    test('Reads multiple interface parents and typed method/property contracts with exact source spans.', () =>
    {
        const source = [
            'export interface Task : Named, api.Runnable {',
            '    void reset(/* no arguments */);',
            '    Number run(String text, ...Number values);',
            '    String Name { get; /* mutable */ set; }',
            '    Number Count { get; }',
            '}'
        ].join('\r\n');
        const parsed = parse(source);
        expect(parsed.errors).toEqual([]);
        const declaration = parsed.declarations[0];
        expect(declaration).toMatchObject({ kind: 'interface', exported: true, baseName: 'Named', constructorMember: null });
        expect(declaration.heritage.map(parent => parent.name)).toEqual([ 'Named', 'api.Runnable' ]);
        for(const parent of declaration.heritage)
        {
            expect(source.slice(parent.start, parent.end)).toBe(parent.name);
        }

        expect(source.slice(declaration.typeStart, declaration.typeEnd)).toBe('interface');
        expect(declaration.members.map(member => member.name)).toEqual([ 'reset', 'run', 'Name', 'Count' ]);
        expect(declaration.classMembers.every(member => member.abstract)).toBe(true);
        expect(declaration.classMembers[0].returnTypeName).toBe('void');
        const run = declaration.classMembers[1];
        expect(run.params.map(parameter => parameter.typeName)).toEqual([ 'String', 'Number' ]);
        expect(run.params[1].rest).toBe(true);
        const property = declaration.classMembers[2];
        expect(property).toMatchObject({ kind: 'property', propertyTypeName: 'String', getter: true, setter: true });
        expect(source.slice(declaration.initializerStart + property.propertyTypeStart, declaration.initializerStart + property.propertyTypeEnd)).toBe('String');
        expect(source.slice(property.nameStart, property.nameEnd)).toBe('Name');
        expect(source.slice(property.getterStart, property.getterEnd)).toBe('get');
        expect(source.slice(property.setterStart, property.setterEnd)).toBe('set');
        expect(declaration.classMembers.find(member => member.name === 'Count')).toMatchObject({ getter: true, setter: false });
        expect(declaration.methodTypedParams.every(group => group.abstract)).toBe(true);
    });

    test('Keeps abstract members distinct from concrete constructors, methods and overriding accessors.', () =>
    {
        const source = [
            'abstract class Task : BaseTask, Runnable {',
            '    abstract override Number run(String text);',
            '    abstract String Name { get; set; }',
            '    Task(String title) : base(title) { this.title = title; }',
            '    String describe() { return this.title; }',
            '    override get String label() { return this.title; }',
            '    override set label(String value) { this.title = value; }',
            '}'
        ].join('\n');
        const parsed = parse(source);
        expect(parsed.errors).toEqual([]);
        const declaration = parsed.declarations[0];
        expect(declaration).toMatchObject({ kind: 'class', abstract: true, baseName: 'BaseTask' });
        expect(source.slice(declaration.abstractStart, declaration.abstractEnd)).toBe('abstract');
        expect(source.slice(declaration.typeStart, declaration.typeEnd)).toBe('class');
        expect(declaration.classMembers[0]).toMatchObject({ abstract: true, override: true, returnTypeName: 'Number' });
        expect(declaration.classMembers[1]).toMatchObject({ abstract: true, propertyTypeName: 'String', getter: true, setter: true });
        expect(declaration.constructorMember).toMatchObject({ abstract: false, isConstructor: true });
        expect(declaration.classMembers.find(member => member.name === 'describe').abstract).toBe(false);
        expect(declaration.classMembers.find(member => member.accessorKind === 'get')).toMatchObject({ abstract: false, getter: true, setter: false, override: true });
        expect(declaration.classMembers.find(member => member.accessorKind === 'set')).toMatchObject({ abstract: false, getter: false, setter: true, override: true });
    });

    test.each([
        [ 'interface Task { run(String text); }', 'explicit return and parameter types' ],
        [ 'interface Task { Number run(text); }', 'explicit return and parameter types' ],
        [ 'interface Task { Number run(String text,); }', 'explicit return and parameter types' ],
        [ 'interface Task { Number run() { return 1; } }', 'cannot have a body' ],
        [ 'interface Task { Task(); }', 'cannot declare constructors' ],
        [ 'interface Task { void create(); }', 'cannot declare constructors' ],
        [ 'interface Task { String Name { get {} } }', 'cannot have bodies' ],
        [ 'interface Task { String Name { get; get; } }', 'Duplicate' ],
        [ 'interface Task { String Name {} }', 'at least one' ],
        [ 'interface Task { void Name { get; } }', 'value type' ],
        [ 'interface Task { Number field = 1; }', 'Fields' ],
        [ 'interface Task : Named, {}', 'heritage list' ],
        [ 'abstract interface Task {}', 'already abstract' ],
        [ 'class Task { abstract Number run(); }', 'require an abstract' ],
        [ 'class Task { String Name { get; } }', 'Signature-only properties' ],
        [ 'abstract class Task { String Name { get; } }', 'Signature-only properties' ],
        [ 'abstract class Task { abstract Number run() {} }', 'cannot have a body' ],
        [ 'abstract class Task { abstract Task(); }', 'constructor cannot have' ],
        [ 'abstract class Task { abstract virtual Number run(); }', 'cannot combine virtual' ],
        [ 'abstract class Task { virtual abstract Number run(); }', 'cannot combine virtual' ],
        [ 'abstract class Task { abstract async Number run(); }', 'cannot be async' ],
        [ 'abstract class Task { abstract get String Name(); }', 'typed property contract' ],
        [ 'abstract class Task { Number run(); }', 'Expected an LGD method body' ]
    ])('Rejects malformed or executable contracts: %s.', (source, message) =>
    {
        expect(parse(source).errors.some(error => error.message.includes(message))).toBe(true);
    });
});
