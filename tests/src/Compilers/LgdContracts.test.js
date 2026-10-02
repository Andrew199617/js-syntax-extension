const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdContractChecker = require('../../../src/Compilers/LgdContractChecker');
const LgdOverrideChecker = require('../../../src/Compilers/LgdOverrideChecker');

/** @description Compiles one contract fixture and returns its precise contract diagnostics. */
function contracts(source, externals = new Map())
{
    return LgdCompiler.create().parse(source, externals).errors.filter(error => error.code?.startsWith('lgd.contract.'));
}

/** @description Produces export metadata matching the language-service contract cache. */
function exported(source, name, externals = new Map())
{
    const parsed = LgdCompiler.create().parse(source, externals);
    const declaration = parsed.allDeclarations.find(candidate => candidate.name === name);
    return { exportName: name, keyword: 'Object', kind: declaration.kind,
        ...LgdOverrideChecker.describeMethods(source, parsed.allDeclarations, declaration, externals),
        ...LgdContractChecker.describeContracts(source, parsed.allDeclarations, declaration, externals) };
}

describe('LGD interface and abstract contracts', () =>
{
    test('accepts inherited concrete implementations and erases interface methods from JavaScript', () =>
    {
        const source = [
            'interface IRun { Number run(Number count); }',
            'class Base { Number run(Number count) { return count; } }',
            'class Child : Base, IRun {}'
        ].join('\n');
        const compiled = LgdCompiler.create().compileToJs(source);
        expect(compiled.errors).toEqual([]);
        expect(compiled.code).not.toContain('interface');
        expect(compiled.allDeclarations[2].baseName).toBe('Base');
        expect(compiled.allDeclarations[2].interfaceNames).toEqual(['IRun']);
    });

    test('reports a missing transitive interface member on the concrete class name', () =>
    {
        const source = 'interface IBase { void run(); }\ninterface IChild : IBase {}\nclass Child : IChild {}';
        const errors = contracts(source);
        expect(errors).toHaveLength(1);
        expect(errors[0].code).toBe('lgd.contract.missingMember');
        expect(errors[0].message).toContain("required by 'IBase'");
        expect(source.slice(errors[0].offset, errors[0].endOffset)).toBe('Child');
    });

    test('allows abstract classes to defer obligations and requires override when implementing an abstract method', () =>
    {
        const source = [
            'interface IRun { Number run(Number count); }',
            'abstract class Base : IRun { abstract Number run(Number count); }',
            'abstract class Middle : Base {}',
            'class Child : Middle { override Number run(Number count) { return count; } }'
        ].join('\n');
        expect(LgdCompiler.create().compileToJs(source).errors).toEqual([]);
        const missingOverride = source.replace('override Number run', 'Number run');
        expect(LgdCompiler.create().parse(missingOverride).errors.some(error => error.code === 'lgd.override.required')).toBe(true);
        expect(contracts(source.replace('override Number run(Number count) { return count; }', ''))).toMatchObject([{ code: 'lgd.contract.missingMember' }]);
    });

    test.each([
        [ 'String run(Number count) { return "ok"; }', 'must return Number' ],
        [ 'Number run(String count) { return 1; }', 'parameter 1 must be Number' ],
        [ 'Number run() { return 1; }', 'must have 1 parameter' ],
        [ 'run(Number count) { return count; }', 'must declare return type Number' ],
        [ 'Number run(count) { return 1; }', 'must declare parameter 1 as Number' ]
    ])('rejects incompatible interface implementation %s', (implementation, message) =>
    {
        const source = `interface IRun { Number run(Number count); }\nclass Child : IRun { ${implementation} }`;
        expect(contracts(source)).toMatchObject([{ code: 'lgd.contract.signatureMismatch', message: expect.stringContaining(message) }]);
    });

    test('checks rest and optional/default arguments without depending on parameter names', () =>
    {
        expect(contracts('interface I { void run(Number count = 1); }\nclass A : I { void run(Number renamed = 2) {} }')).toEqual([]);
        expect(contracts('interface I { void run(Number count = 1); }\nclass A : I { void run(Number renamed) {} }')[0].message).toContain('optional parameter');
        expect(contracts('interface I { void run(...Number values); }\nclass A : I { void run(Number renamed) {} }')[0].message).toContain('rest parameter');
    });

    test('checks local named types while leaving opaque external annotation identities unguessed', () =>
    {
        const local = 'class First {}\nclass Second {}\ninterface I { void run(First value); }\nclass A : I { void run(Second value) {} }';
        expect(contracts(local)[0].message).toContain('must be First, not Second');
        const opaque = 'const ns = require("package");\ninterface I { void run(ns.First value); }\nclass A : I { void run(ns.Second value) {} }';
        expect(contracts(opaque)).toEqual([]);
    });

    test('coalesces typed getter and setter implementations and checks both property types', () =>
    {
        const prefix = 'interface I { String Name { get; set; } }\nclass A : I {';
        const getter = 'get String Name() { return "ok"; }';
        expect(LgdCompiler.create().compileToJs(`${prefix} ${getter} set Name(String value) {} }`).errors).toEqual([]);
        expect(contracts(`${prefix} ${getter} }`)[0].message).toContain('required property accessors');
        expect(contracts(`${prefix} ${getter} set Name(Number value) {} }`)[0].message).toContain('property type String');
    });

    test('requires override on concrete accessors implementing an inherited abstract property', () =>
    {
        const prefix = 'abstract class Base { abstract String Name { get; set; } }\nclass A : Base {';
        const implementation = 'override get String Name() { return "ok"; } override set Name(String value) {} }';
        expect(LgdCompiler.create().compileToJs(`${prefix} ${implementation}`).errors).toEqual([]);
        expect(LgdCompiler.create().parse(`${prefix} ${implementation.replace(/override /g, '')}`).errors.filter(error => error.code === 'lgd.override.required')).toHaveLength(2);
    });

    test.each([
        [ 'interface I : Missing {}', 'unknownHeritage' ],
        [ 'interface I {}\nclass A : I, I {}', 'duplicateHeritage' ],
        [ 'class Base {}\ninterface I : Base {}', 'invalidHeritage' ],
        [ 'class Base {}\ninterface I {}\nclass A : I, Base {}', 'invalidHeritage' ],
        [ 'interface A : B {}\ninterface B : A {}', 'inheritanceCycle' ]
    ])('rejects invalid contract heritage %s', (source, code) =>
    {
        expect(contracts(source).some(error => error.code === `lgd.contract.${code}`)).toBe(true);
    });

    test('rejects abstract and interface factories or native instantiation with lexical shadowing preserved', () =>
    {
        const source = 'interface I {}\nabstract class A {}\nI.create(); new I(); A.create(); new A();\nfunction run() { const A = {}; A.create(); }';
        expect(contracts(source).filter(error => error.code === 'lgd.contract.instantiation')).toHaveLength([ 'I.create', 'new I', 'A.create', 'new A' ].length);
        expect(contracts('interface I {}\n// I.create(); new I();\nconst text = "I.create()";')).toEqual([]);
    });

    test('serializes transitive obligations and validates cross-file aliases', () =>
    {
        const interfaceSource = 'interface IBase { Number run(Number count); }\ninterface IChild : IBase {}';
        const interfaceExport = exported(interfaceSource, 'IChild');
        expect(interfaceExport).toMatchObject({ contractKind: 'interface', abstract: true, contractsKnown: true,
            contractSignatures: [{ name: 'run', declaredIn: 'IBase' }] });
        const externals = new Map([[ './interface', interfaceExport ]]);
        expect(contracts('const Alias = require("./interface");\nclass A : Alias { Number run(Number count) { return count; } }', externals)).toEqual([]);
        expect(contracts('const Alias = require("./interface");\nclass A : Alias {}', externals)[0].code).toBe('lgd.contract.missingMember');
    });

    test('fails closed when a known external interface lacks contract metadata', () =>
    {
        const externals = new Map([[ './interface', { exportName: 'I', keyword: 'Object', kind: 'interface' } ]]);
        expect(contracts('const I = require("./interface");\nclass A : I {}', externals)[0].code).toBe('lgd.contract.unavailable');
    });

    test('validates supplied concrete methods in abstract classes while allowing missing obligations', () =>
    {
        const prefix = 'interface I { Number run(Number count); }\nabstract class A : I {';
        expect(contracts(`${prefix} }`)).toEqual([]);
        expect(contracts(`${prefix} String run(Number count) { return "ok"; } }`)[0].code).toBe('lgd.contract.signatureMismatch');
    });

    test('rejects incompatible inherited interface signatures before a concrete class exists', () =>
    {
        const source = 'interface I { Number run(); }\ninterface J { String run(); }\ninterface K : I, J {}';
        expect(contracts(source)).toMatchObject([{ code: 'lgd.contract.conflictingMembers' }]);
        expect(contracts(source.replace('String run()', 'Number run()'))).toEqual([]);
    });

    test('merges complementary inherited interface property accessors in export metadata', () =>
    {
        const source = 'interface IRead { String Name { get; } }\ninterface IWrite { String Name { set; } }\ninterface IBoth : IRead, IWrite {}';
        expect(contracts(source)).toEqual([]);
        expect(exported(source, 'IBoth').contractSignatures).toMatchObject([{ name: 'Name', getter: true, setter: true }]);
    });

    test('rejects arbitrary runtime interface reads but permits compile-time types and CommonJS exports', () =>
    {
        const source = 'interface I {}\nconst value = I;\nmodule.exports = I;';
        const errors = contracts(source);
        expect(errors).toHaveLength(1);
        expect(errors[0].code).toBe('lgd.contract.runtimeInterface');
        expect(source.slice(errors[0].offset, errors[0].endOffset)).toBe('I');
        expect(contracts('interface I {}\nclass A { I run(I value) { return value; } }')).toEqual([]);
    });

    test('honors ordinary function and class method parameters shadowing erased or abstract declarations', () =>
    {
        const source = 'interface I {}\nabstract class A {}\nfunction run(I, A) { I.create(); new A(); return I; }\nclass B { run(I, A) { I.create(); new A(); } }';
        expect(contracts(source)).toEqual([]);
        const arrows = 'interface I {}\nabstract class A {}\nconst first = (I, A) => { I.create(); new A(); };\nconst second = I => I.create();\nfunction destructured({ I }, [A]) { return I.create(new A()); }';
        expect(contracts(arrows)).toEqual([]);
        const otherBindings = 'interface I {}\nconst runner = { run(I) { return I; } };\nfunction f() { const { I } = {}; return I; }';
        expect(contracts(otherBindings)).toEqual([]);
    });

    test('requires typed evidence from both concrete property accessors', () =>
    {
        const source = 'interface I { String Name { get; set; } }\nclass A : I { get String Name() { return "ok"; } set Name(value) {} }';
        expect(contracts(source)[0].message).toContain('on both accessors');
    });

    test('accepts compatible abstract re-overrides and checks local nominal override types', () =>
    {
        const source = 'abstract class A { abstract Number run(Number count); }\nabstract class B : A { abstract override Number run(Number count); }\nclass C : B { override Number run(Number count) { return count; } }';
        expect(LgdCompiler.create().parse(source).errors).toEqual([]);
        const nominal = 'class First {}\nclass Second {}\nclass Base { virtual void run(First value) {} }\nclass Child : Base { override void run(Second value) {} }';
        expect(LgdCompiler.create().parse(nominal).errors.some(error => error.message.includes('must be First, not Second'))).toBe(true);
    });

    test('preserves property type and accessor obligations through abstract re-overrides', () =>
    {
        const prefix = 'abstract class Base { abstract String Name { get; set; } }\nabstract class Middle : Base {';
        const valid = `${prefix} abstract override String Name { get; set; } }\nclass Last : Middle { override get String Name() { return "ok"; } override set Name(String value) {} }`;
        expect(LgdCompiler.create().parse(valid).errors).toEqual([]);
        const wrongType = `${prefix} abstract override Number Name { get; set; } }`;
        expect(LgdCompiler.create().parse(wrongType).errors.some(error => error.message.includes('must have type String, not Number'))).toBe(true);
        const missingAccessor = `${prefix} abstract override String Name { get; } }`;
        expect(LgdCompiler.create().parse(missingAccessor).errors.some(error => error.message.includes('must preserve its inherited accessors'))).toBe(true);
    });

    test('checks inherited abstract method return bodies when annotations are omitted', () =>
    {
        const prefix = 'abstract class Base { abstract Number run(Number count); }\nclass Child : Base {';
        const valid = `${prefix} override run(renamed) { return renamed + 1; } }`;
        expect(LgdCompiler.create().compileToJs(valid).errors).toEqual([]);
        const invalid = `${prefix} override run(count) { return "wrong"; } }`;
        const errors = LgdCompiler.create().compileToJs(invalid).errors;
        expect(errors).toMatchObject([{ message: 'Cannot return String from a Number method.' }]);
        expect(invalid.slice(errors[0].offset, errors[0].endOffset)).toBe('"wrong"');
        const missing = `${prefix} override run(count) {} }`;
        const missingErrors = LgdCompiler.create().parse(missing).errors;
        expect(missingErrors).toMatchObject([{ message: "Method 'run' must return Number on every normal path." }]);
        expect(missing.slice(missingErrors[0].offset, missingErrors[0].endOffset)).toBe('run');
        expect(LgdCompiler.create().compileToJs(invalid, new Map(), { javascriptObjectModel: 'class' }).errors).toMatchObject(errors);
    });

    test('checks unannotated getter bodies implementing inherited abstract properties', () =>
    {
        const prefix = 'abstract class Base { abstract String Name { get; } }\nclass Child : Base {';
        expect(LgdCompiler.create().compileToJs(`${prefix} override get Name() { return "ok"; } }`).errors).toEqual([]);
        const invalid = `${prefix} override get Name() { return 1; } }`;
        const errors = LgdCompiler.create().parse(invalid).errors;
        expect(errors).toMatchObject([{ message: 'Cannot return Number from a String method.' }]);
        expect(invalid.slice(errors[0].offset, errors[0].endOffset)).toBe('1');
        const missing = `${prefix} override get Name() {} }`;
        const missingErrors = LgdCompiler.create().parse(missing).errors;
        expect(missingErrors[0].message).toContain('must return String');
        expect(missing.slice(missingErrors[0].offset, missingErrors[0].endOffset)).toBe('Name');
    });

    test('keeps inherited body contracts separate from physical annotations and lexical return scopes', () =>
    {
        const source = 'abstract class Base { abstract Number run(Number count); }\nclass Child : Base { override run(count) { function nested() { return "ok"; } return count; } }';
        const parsed = LgdCompiler.create().parse(source);
        expect(parsed.errors).toEqual([]);
        expect(parsed.allDeclarations[1].methodTypedParams).toEqual([]);
        expect(parsed.allDeclarations[1].inheritedMethodContracts).toMatchObject([{ inherited: true, returnTypeName: 'Number', returnTypeStart: -1, returnTypeEnd: -1 }]);
        const shadowed = source.replace('function nested() { return "ok"; } return count;', '{ const count = "wrong"; return count; }');
        expect(LgdCompiler.create().parse(shadowed).errors[0].message).toBe('Cannot return String from a Number method.');
        const reassigned = source.replace('function nested() { return "ok"; } return count;', 'count = "wrong"; return count;');
        expect(LgdCompiler.create().parse(reassigned).errors[0].message).toBe('Cannot return String from a Number method.');
        const validAssignment = source.replace('function nested() { return "ok"; } return count;', 'count = count + 1; return count;');
        expect(LgdCompiler.create().parse(validAssignment).errors).toEqual([]);
    });

    test('validates omitted abstract return contracts through cross-file export aliases', () =>
    {
        const baseSource = 'abstract class Base { abstract Number run(Number count); abstract String Name { get; } }';
        const externals = new Map([[ './base', exported(baseSource, 'Base') ]]);
        const prefix = 'const Parent = require("./base");\nclass Child : Parent {';
        const valid = `${prefix} override run(count) { return count; } override get Name() { return "ok"; } }`;
        expect(LgdCompiler.create().parse(valid, externals).errors).toEqual([]);
        const invalid = valid.replace('return count;', 'return "wrong";').replace('return "ok";', 'return 1;');
        expect(LgdCompiler.create().parse(invalid, externals).errors.map(error => error.message)).toEqual([
            'Cannot return String from a Number method.', 'Cannot return Number from a String method.'
        ]);
    });

    test('leaves ordinary virtual overrides and opaque inherited annotation identities conservative', () =>
    {
        const ordinary = 'class Base { virtual Number run(Number count) { return count; } }\nclass Child : Base { override run(count) { return "unchanged"; } }';
        expect(LgdCompiler.create().parse(ordinary).errors).toEqual([]);
        const opaqueBase = 'const ns = require("package");\nabstract class Base { abstract ns.Result run(ns.Result value); }';
        const externals = new Map([[ './base', exported(opaqueBase, 'Base') ]]);
        const source = 'const Base = require("./base");\nclass Child : Base { override run(value) { return value; } }';
        expect(LgdCompiler.create().parse(source, externals).errors).toEqual([]);
        const nominalBase = 'class Result {}\nabstract class Base { abstract Result run(Result value); }';
        const nominalExternals = new Map([[ './base', exported(nominalBase, 'Base') ]]);
        const localShadow = 'class Result {}\nconst Parent = require("./base");\nclass Child : Parent { override run(value) { return {}; } }';
        expect(LgdCompiler.create().parse(localShadow, nominalExternals).errors).toEqual([]);
    });

    test('fails closed for exported incomplete interface and abstract member syntax', () =>
    {
        const sources = [
            'interface I { Number run(count); }',
            'interface I { Number run(Number count) {} }',
            'abstract class I { abstract Number run(count); }'
        ];
        for(const source of sources)
        {
            const metadata = exported(source, 'I');
            expect(metadata.contractsKnown).toBe(false);
            const externals = new Map([[ './contract', metadata ]]);
            expect(contracts('const I = require("./contract");\nclass Child : I {}', externals)[0].code).toBe('lgd.contract.unavailable');
        }
    });

    test('marks unbound declared contract annotations incomplete without rejecting ordinary body diagnostics', () =>
    {
        expect(exported('interface I { Missing run(); }', 'I').contractsKnown).toBe(false);
        expect(exported('interface I { void run(Missing value); }', 'I').contractsKnown).toBe(false);
        expect(exported('abstract class I { abstract Missing run(); }', 'I').contractsKnown).toBe(false);
        const ordinaryBody = 'abstract class I { Number run() { return "wrong"; } }';
        expect(LgdCompiler.create().parse(ordinaryBody).errors).not.toEqual([]);
        expect(exported(ordinaryBody, 'I').contractsKnown).toBe(true);
    });

    test('reclassifies cached interface inheritance using resolved imports without reparsing or stale error gating', () =>
    {
        const source = 'const Parent = require("./parent");\ninterface I : Parent {}';
        const parsed = LgdCompiler.create().parse(source);
        const declaration = parsed.allDeclarations.find(candidate => candidate.name === 'I');
        expect(parsed.errors).not.toEqual([]);
        expect(declaration.contractSyntaxComplete).toBe(true);
        expect(LgdContractChecker.describeContracts(source, parsed.allDeclarations, declaration).contractsKnown).toBe(false);
        const parent = exported('interface Parent { Number run(Number count); }', 'Parent');
        const externals = new Map([[ './parent', parent ]]);
        LgdContractChecker.classify(source, parsed.allDeclarations, externals);
        const metadata = LgdContractChecker.describeContracts(source, parsed.allDeclarations, declaration, externals);
        expect(metadata).toMatchObject({ contractsKnown: true, contractSignatures: [{ name: 'run', returnTypeName: 'Number' }] });
        expect(contracts('const I = require("./contract");\nclass Child : I {}', new Map([[ './contract', metadata ]]))[0].code).toBe('lgd.contract.missingMember');
    });

    test('reports unknown erased return and property contract types on their exact type names', () =>
    {
        const source = 'interface I { Missing run(); Other Name { get; } }';
        const errors = contracts(source);
        expect(errors.map(error => source.slice(error.offset, error.endOffset))).toEqual([ 'Missing', 'Other' ]);
    });
});
