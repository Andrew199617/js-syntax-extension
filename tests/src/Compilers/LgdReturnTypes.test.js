const virtualMachine = require('vm');
const parser = require('@babel/parser');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');

function compile(method, owner = 'object')
{
    const source = owner === 'class' ? `class Counter { ${method} }` : `Object Counter = { ${method} };`;
    return LgdCompiler.create().compileToJs(source);
}

describe('LGD explicit named return types.', () =>
{
    test.each([ 'object', 'class' ])('Accepts zero-parameter return-only signatures on an %s.', owner =>
    {
        const separator = owner === 'class' ? ' ' : ', ';
        const result = compile(`Number count() { return 2; }${separator}void reset() {}`, owner);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('@returns {number}');
        expect(result.code).toContain('@returns {undefined}');
        expect(result.code).not.toContain('return undefined');
        expect(virtualMachine.runInNewContext(`${result.code}\n[Counter.count(), Counter.reset()];`)).toEqual([ 2, undefined ]);
    });

    test.each([
        [ 'Number count() { return "wrong"; }', 'Cannot return String' ],
        [ 'Number count() { return; }', 'Cannot return undefined' ],
        [ 'Number count() { return undefined; }', 'Cannot return undefined' ],
        [ 'Number count() { return null; }', 'Cannot return null' ],
        [ 'Number count() {}', 'must return Number' ],
        [ 'Number count(Boolean ready) { if(ready) return 1; }', 'must return Number' ],
        [ 'void reset() { return null; }', 'Cannot return null' ],
        [ 'void reset() { return 1; }', 'Cannot return Number' ],
        [ 'void reset() { return []; }', 'Cannot return Array' ],
        [ 'void reset() { return new Date(); }', 'Cannot return Object' ],
        [ 'Number count(String label) { return label; }', 'Cannot return String' ],
        [ 'Number count(...Number values) { return values; }', 'Cannot return Array' ],
        [ 'Number count(Number value) { switch(value) { case 1: return 1; default: break; } }', 'must return Number' ],
        [ 'Number count(Boolean ready) { do { continue; } while(ready); }', 'must return Number' ],
        [ 'Number count() { try { return 1; } catch(error) {} }', 'must return Number' ],
        [ 'Number count(Boolean ready) { return ready ? 1 : "wrong"; }', 'Cannot return String' ],
        [ 'Numer count() { return 1; }', "Unknown return type 'Numer'" ],
        [ 'get Number count() { return 1; }', 'accessors and generators' ],
        [ '*Number count() { return 1; }', 'accessors and generators' ]
    ])('Reports invalid explicit return contracts: %s.', (method, message) =>
    {
        const result = compile(method);
        expect(result.errors.some(error => error.message.includes(message))).toBe(true);
    });

    test.each([
        'void reset() { return; }',
        'void reset() { return undefined; }',
        'void reset() { return void 1; }',
        'void reset() { const nested = () => { return 2; }; nested(); }',
        'Number count(Boolean ready) { if(ready) return 1; else return 2; }',
        'Number count(Boolean ready) { if(ready) return 1; throw new Error("stop"); }',
        'Number count() { if(true) return 1; }',
        'Number count(Number value) { switch(value) { case 0: case 1: return 1; default: return 2; } }',
        'Number count() { try { return 1; } finally { console.log("done"); } }',
        'Number count() { for(;;) {} }'
    ])('Accepts valid completion paths: %s.', method =>
    {
        expect(compile(method).errors).toEqual([]);
    });

    test('Excludes nested returns and honors actual lexical binding shadowing.', () =>
    {
        expect(compile('Number count() { const nested = () => { return 1; }; nested(); }').errors[0].message).toContain('must return Number');
        expect(compile('Number count(String value) { { const value = 2; return value; } }').errors).toEqual([]);
        expect(compile('void reset(Number undefined) { return undefined; }').errors[0].message).toContain('Cannot return Number');
    });

    test('Resolves typed local and nominal constructor return values.', () =>
    {
        const local = compile('Number count() {\nString label = "wrong";\nreturn label;\n}');
        expect(local.errors[0].message).toContain('Cannot return String');
        const source = 'class Counter {}\nObject Factory = { Counter make() { return Counter.create(); } };';
        expect(LgdCompiler.create().compileToJs(source).errors).toEqual([]);
    });

    test('Checks known annotated method results without entering the callee body.', () =>
    {
        const result = compile('String label() { return "wrong"; }, Number count() { return this.label(); }');
        expect(result.errors[0].message).toContain('Cannot return String');
    });

    test('Checks async resolved values and emits ordinary promises without inserted returns.', async () =>
    {
        const result = compile('async Number count() { return await Promise.resolve(2); }, async void reset() {}');
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('@returns {Promise<number>}');
        expect(result.code).toContain('@returns {Promise<undefined>}');
        const methods = virtualMachine.runInNewContext(`${result.code}\nCounter;`);
        expect(await methods.count()).toBe(2);
        expect(await methods.reset()).toBeUndefined();
        expect(compile('async Number count() { return Promise.resolve("wrong"); }').errors[0].message).toContain('Cannot return String');
        expect(compile('async void reset() { return Promise.resolve(null); }').errors[0].message).toContain('Cannot return null');
    });

    test('Keeps constructor instance returns implicit and leaves legacy methods compatible.', () =>
    {
        const source = 'class Counter { Counter(Number value) { this.value = value; } read() { return this.value; } void reset() { this.value = 0; } }';
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(virtualMachine.runInNewContext(`${result.code}\nCounter.create(2).read();`)).toBe(2);
        expect(compile('Number Counter() {}', 'class').errors[0].message).toContain('constructor');
    });

    test('Preserves comments, CRLF, and exact name/body mappings after return erasure.', () =>
    {
        const source = 'class Counter {\r\n    /** Existing description. @returns {string} old */\r\n    Number /* preserve */ count(Number value) { return value; }\r\n}';
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('/* preserve */');
        expect(result.code).toContain('@returns {number} old');
        expect(result.code.replace(/\r\n/g, '')).not.toContain('\n');
        const map = LgdSourceMap.create(result.mappings);
        for(const match of source.matchAll(/count|value|\/\* preserve \*\//g))
        {
            const offset = map.toOutput(match.index);
            expect(result.code.slice(offset, offset + match[0].length)).toBe(match[0]);
            expect(map.toSource(offset)).toBe(match.index);
        }
    });

    test('Maps the diagnostic to the incompatible expression rather than the full method.', () =>
    {
        const source = 'Object Counter = { Number count() { return "wrong"; } };';
        const result = LgdCompiler.create().compileToJs(source);
        const error = result.errors[0];
        expect(source.slice(error.offset, error.endOffset)).toBe('"wrong"');
    });

    test('Uses the same return checks and declared contracts for TypeScript and C# output.', () =>
    {
        const source = 'Object Counter = { async Number count() { return 2; }, void reset() {} };';
        const compiler = LgdCompiler.create();
        const typed = compiler.compileToTs(source);
        expect(typed.errors).toEqual([]);
        expect(typed.code).toContain('count(): Promise<number>');
        expect(typed.code).toContain('reset(): undefined');
        expect(() => parser.parse(typed.code, { plugins: ['typescript'] })).not.toThrow();
        expect(compiler.compileToCSharp(source).code).toContain('System.Threading.Tasks.Task<double>');
        const invalid = 'Object Counter = { Number count() { return "wrong"; } };';
        expect(compiler.compileToTs(invalid).errors[0].message).toContain('Cannot return String');
        expect(compiler.compileToCSharp(invalid).errors[0].message).toContain('Cannot return String');
    });
});
