const virtualMachine = require('vm');
const LgdCompiler = require('../../../src/Compilers/LgdCompiler');

describe('LGD native inference proofs.', () =>
{
    test.each([
        'Promise.resolve = () => "ok";',
        '(Promise["resolve"] = () => "ok");',
        'globalThis.Promise.resolve = () => "ok";',
        'const nativePromise = Promise; nativePromise.resolve = () => "ok";',
        'const globals = globalThis; globals.Promise.resolve = () => "ok";',
        'Object.defineProperty(Promise, "resolve", { value: () => "ok" });',
        'const replace = target => { target.resolve = () => "ok"; }; replace(Promise);',
        'const replace = target => { target.resolve = () => "ok"; }; replace?.(Promise);',
        `const replace = (strings, target) => { target.resolve = () => "ok"; }; replace\`value:\${Promise}\`;`
    ])('Does not invent Promise results after an explicit native mutation: %s.', mutation =>
    {
        const source = `${mutation}\nString label = Promise.resolve(1);`;
        const result = LgdCompiler.create().compileToJs(source);
        expect(virtualMachine.runInNewContext(`${result.code}\nlabel;`)).toBe('ok');
        expect(result.errors).toEqual([]);
    });

    test.each([
        [ 'Array', 'Array values = new Array();', '(Array = function Replacement() { return []; });' ],
        [ 'Function', 'Function work = new Function();', '(Function = function Replacement() { return () => 1; });' ]
    ])('Keeps replaced %s constructors conservative without affecting valid values.', (name, declaration, mutation) =>
    {
        expect(LgdCompiler.create().compileToJs(`${mutation}\n${declaration}`).errors).toEqual([]);
    });

    test('Retains known Promise diagnostics when a same-named local alone is mutated.', () =>
    {
        const source = 'function replace(Promise) { Promise.resolve = () => "ok"; }\n'
            + 'Object Reader = { async Number read() { return Promise.resolve("wrong"); } };';
        expect(LgdCompiler.create().compileToJs(source).errors).toEqual([expect.objectContaining({
            message: 'Cannot return String from a Number method.'
        })]);
    });

    test('Still rejects the Promise result of an unchanged native assignment.', () =>
    {
        expect(LgdCompiler.create().compileToJs('String label = Promise.resolve(1);').errors).toEqual([expect.objectContaining({
            message: 'Cannot assign Promise to String.'
        })]);
    });
});
