const virtualMachine = require('vm');
const parser = require('@babel/parser');
const JsBackend = require('../../../src/Compilers/JsBackend');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdInterfaceErasure = require('../../../src/Compilers/LgdInterfaceErasure');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');

/** @description Known interface and ordinary class export fixtures. */
const interfaces = new Map([
    [ './IFoo.js', { kind: 'interface' } ],
    [ './IBar.js', { contractKind: 'interface' } ],
    [ './Concrete.js', { kind: 'class' } ]
]);

function identityEmission(source)
{
    return { code: source, segments: [{ srcStart: 0, srcEnd: source.length, outStart: 0, outEnd: source.length, verbatim: true }] };
}

function erase(source, declarations = [], emitted = identityEmission(source))
{
    return LgdInterfaceErasure.apply(source, declarations, interfaces, emitted);
}

function erasedInterfaceEmission(source, name)
{
    const start = source.indexOf(`interface ${name}`);
    const end = source.indexOf('}', start) + 1;
    const nameStart = source.indexOf(name, start);
    const declaration = { kind: 'interface', name: name, nameStart: nameStart, nameEnd: nameStart + name.length, headStart: start, start: start, end: end };
    return {
        declarations: [declaration],
        emitted: {
            code: source.slice(0, start) + source.slice(end),
            segments: [
                { srcStart: 0, srcEnd: start, outStart: 0, outEnd: start, verbatim: true },
                { srcStart: start, srcEnd: end, outStart: start, outEnd: start, verbatim: false,
                    nameSrcStart: nameStart, nameSrcEnd: nameStart + name.length, nameOutStart: start, nameOutEnd: start },
                { srcStart: end, srcEnd: source.length, outStart: start, outEnd: source.length - end + start, verbatim: true }
            ]
        }
    };
}

describe('Interface JavaScript binding erasure.', () =>
{
    test.each([ 'const', 'let', 'var' ])('Erases %s interface imports and their sole CommonJS exports.', keyword =>
    {
        const result = erase(`${keyword} LocalContract = require('./IFoo.js');\r\nmodule.exports = LocalContract;`);
        expect(result.code.trim()).toBe('');
        expect(result.code).toContain('\r\n');
    });

    test('Recognizes external contract metadata and preserves ordinary runtime imports.', () =>
    {
        const source = "const Alias = require('./IBar.js');\nconst Concrete = require('./Concrete.js');\nmodule.exports = Concrete;";
        const result = erase(source);
        expect(result.code).not.toContain('Alias');
        expect(result.code).toContain("const Concrete = require('./Concrete.js');");
        expect(result.code).toContain('module.exports = Concrete;');
    });

    test('Erases a resolved local interface export after its declaration span has collapsed.', () =>
    {
        const source = 'interface IFoo {}\r\nmodule.exports = IFoo;\r\nconst remaining = 1;';
        const fixture = erasedInterfaceEmission(source, 'IFoo');
        const result = erase(source, fixture.declarations, fixture.emitted);
        expect(result.code).not.toContain('IFoo');
        expect(result.code).not.toContain('module.exports');
        const map = LgdSourceMap.create(result.segments);
        expect(map.toSource(result.code.indexOf('remaining'))).toBe(source.indexOf('remaining'));
        expect(map.toOutput(source.indexOf('remaining'))).toBe(result.code.indexOf('remaining'));
        expect(Number.isFinite(map.toOutput(source.indexOf('IFoo')))).toBe(true);
    });

    test('Preserves local and parameter shadows of an erased interface name.', () =>
    {
        const source = [
            'interface IFoo {}',
            'function assign(IFoo) { module.exports = IFoo; }',
            '{ const IFoo = value; module.exports = IFoo; }',
            'module.exports = IFoo;'
        ].join('\n');
        const fixture = erasedInterfaceEmission(source, 'IFoo');
        const result = erase(source, fixture.declarations, fixture.emitted);
        expect(result.code).toContain('function assign(IFoo) { module.exports = IFoo; }');
        expect(result.code).toContain('{ const IFoo = value; module.exports = IFoo; }');
        expect(result.code.match(/module\.exports/g)).toHaveLength(2);
    });

    test('Preserves shadowed require and module bindings.', () =>
    {
        const source = [
            "const IFoo = require('./IFoo.js');",
            "function nested(require) { const IFoo = require('./IFoo.js'); return IFoo; }",
            'function publish(module) { module.exports = IFoo; }'
        ].join('\n');
        const result = erase(source);
        expect(result.code).toContain("function nested(require) { const IFoo = require('./IFoo.js'); return IFoo; }");
        expect(result.code).toContain('function publish(module) { module.exports = IFoo; }');
    });

    test('Preserves comments and maps retained text around a generated typed import head.', () =>
    {
        const source = [
            '/** Contract documentation. */',
            "Object Alias = require(/* keep this */ './IFoo.js'); // trailing comment",
            'Number remaining = 1;',
            'module.exports = Alias;'
        ].join('\r\n');
        const compiler = LgdCompiler.create();
        const parsed = compiler.parse(source, interfaces);
        const emitted = compiler.emitRange(source, JsBackend.create('\r\n'), compiler.fullRange(source, parsed.declarations));
        const snapshot = JSON.stringify(emitted);
        const result = erase(source, parsed.allDeclarations, emitted);
        expect(result.code).toContain('Contract documentation.');
        expect(result.code).toContain('/* keep this */');
        expect(result.code).toContain('// trailing comment');
        expect(result.code).not.toContain('require(');
        expect(result.code).not.toContain('module.exports');
        expect(JSON.stringify(emitted)).toBe(snapshot);
        const map = LgdSourceMap.create(result.segments);
        expect(map.toSource(result.code.indexOf('remaining'))).toBe(source.indexOf('remaining'));
        expect(map.toOutput(source.indexOf('remaining'))).toBe(result.code.indexOf('remaining'));
        expect(map.toSource(result.code.indexOf('trailing comment'))).toBe(source.indexOf('trailing comment'));
        expect(result.segments.every(segment => segment.srcStart >= 0 && segment.srcEnd <= source.length && segment.srcStart <= segment.srcEnd)).toBe(true);
        expect(result.segments.every(segment => segment.nameSrcStart === undefined || segment.nameSrcStart <= segment.nameSrcEnd)).toBe(true);
    });

    test('Retains runtime sibling declarators and their execution order.', () =>
    {
        const source = "const First=require('./IFoo.js'), before=record('before'), Middle=require('./IBar.js'), after=record('after'), Last=require('./IFoo.js');";
        const result = erase(source);
        const events = [];
        virtualMachine.runInNewContext(result.code, { record: event => events.push(event) });
        expect(events).toEqual([ 'before', 'after' ]);
        expect(result.code).not.toContain('require');
    });

    test('Retains side-effect imports, indirect initializers and non-static require calls.', () =>
    {
        const source = [
            "require('./IFoo.js');",
            "const property = require('./IFoo.js').value;",
            "const additional = require('./IFoo.js', record());",
            "const computed = require('./' + name);",
            "const { member } = require('./IFoo.js');",
            "const callback = function() { return require('./IFoo.js'); };",
            "const optional = require?.('./IFoo.js');"
        ].join('\n');
        expect(erase(source).code).toBe(source);
    });

    test('Preserves runtime expressions and reassigned export values.', () =>
    {
        const source = [
            "let IFoo = require('./IFoo.js');",
            'IFoo = replacement;',
            'module.exports = IFoo;',
            'module.exports = (record(), IFoo);',
            'const holder = (module.exports = IFoo);'
        ].join('\n');
        const result = erase(source);
        expect(result.code).toContain('IFoo = replacement;');
        expect(result.code).toContain('module.exports = IFoo;');
        expect(result.code).toContain('module.exports = (record(), IFoo);');
        expect(result.code).toContain('const holder = (module.exports = IFoo);');
    });

    test('Keeps enclosing control flow valid when a sole statement or loop initializer is erased.', () =>
    {
        const source = [
            "if(flag) var IFoo=require('./IFoo.js'); else record();",
            "for(let Contract=require('./IBar.js'); flag; advance()) { record(); }",
            'while(flag) module.exports = IFoo;'
        ].join('\n');
        const result = erase(source);
        expect(() => parser.parse(result.code)).not.toThrow();
        expect(result.code).toContain('if(flag) ;');
        expect(result.code).toContain('else record();');
        expect(result.code).toContain('advance()');
        expect(result.code).toContain('while(flag) ;');
    });

    test('Leaves incomplete emitted JavaScript available for existing parser diagnostics.', () =>
    {
        const emitted = identityEmission("const IFoo = require('./IFoo.js'); function unfinished(");
        expect(LgdInterfaceErasure.apply(emitted.code, [], interfaces, emitted)).toBe(emitted);
    });
});
