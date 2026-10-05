const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/** @description A process deadline can stop a synchronous compiler loop, unlike a Jest timer. */
const DEADLINE_MS = 5000;

/** @description Useful depths that expose accidental truncation and repeated shared-subgraph work. */
const LINEAR_DEPTH = 512;

/** @description Shared conditional levels that previously repeated the same subgraph exponentially. */
const SHARED_DEPTH = 40;

/** @description Finite field hops through a recursive nominal type. */
const PROPERTY_DEPTH = 128;

/** @description Compiles in isolation so a regression cannot block the test runner indefinitely. */
function compileBounded(source, objectModel)
{
    const runner = [
        'const fs = require("fs");',
        'const { performance } = require("perf_hooks");',
        'const Compiler = require("./src/Compilers/LgdCompiler");',
        'const source = fs.readFileSync(0, "utf8");',
        'const started = performance.now();',
        'const result = Compiler.create().compileToJs(source, new Map(), { javascriptObjectModel: process.argv[1] });',
        'process.stdout.write(JSON.stringify({ elapsedMs: performance.now() - started, errors: result.errors, emitted: result.code.length }));'
    ].join('\n');
    const child = spawnSync(process.execPath, [ '-e', runner, objectModel ], {
        cwd: path.resolve(__dirname, '../../..'), input: source, encoding: 'utf8', timeout: DEADLINE_MS
    });
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    const result = JSON.parse(child.stdout);
    expect(result.elapsedMs).toBeLessThan(DEADLINE_MS);
    expect(result.emitted).toBeGreaterThan(0);
    return result;
}

/** @description Keeps error spans, error kinds, and known leaf types observable in every stress case. */
function diagnostics(source, result)
{
    return result.errors.map(error => ({
        code: error.code, message: error.message, expression: source.slice(error.offset, error.endOffset)
    }));
}

/** @description Builds a deep acyclic alias chain with either linear or shared conditional edges. */
function aliasChain(depth, shared)
{
    const initial = shared ? 'ready ? 1 : "wrong"' : '"wrong"';
    const declarations = [`const step0 = ${initial};`];
    for(let index = 0; index < depth; index++)
    {
        const value = shared ? `ready ? step${index} : step${index}` : `step${index}`;
        declarations.push(`const step${index + 1} = ${value};`);
    }

    return `class Reader { Number read(Boolean ready) { ${declarations.join(' ')} return step${depth}; } }`;
}

/** @description Expected assignment error preserved after uncertain graph edges. */
const ASSIGNMENT_ERROR = { code: 'lgd.assignment.typeMismatch', message: 'Cannot assign String to Number.', expression: '"wrong"' };

/** @description Expected return error preserved through known alias and cyclic branches. */
const RETURN_ERROR = { code: 'lgd.return.typeMismatch', message: 'Cannot return String from a Number method.' };

describe.each([ 'oloo', 'class' ])('Bounded inference graphs with %s output.', objectModel =>
{
    test.each([ 'deep-control', 'loop-properties' ])('Completes %s while preserving the exact independent error.', async filename =>
    {
        const source = await fs.promises.readFile(path.join(__dirname, '../../fixtures/inference', `${filename}.lgd`), 'utf8');
        expect(diagnostics(source, compileBounded(source, objectModel))).toEqual([ASSIGNMENT_ERROR]);
        const repaired = source.replace('"wrong"', '1');
        expect(compileBounded(repaired, objectModel).errors).toEqual([]);
    });

    test('Resolves recursive class properties through aliases and respects object-binding shadowing.', async () =>
    {
        const source = await fs.promises.readFile(path.join(__dirname, '../../fixtures/inference/recursive-fields.lgd'), 'utf8');
        expect(diagnostics(source, compileBounded(source, objectModel))).toEqual([
            { ...ASSIGNMENT_ERROR, expression: 'alias.label' },
            { code: 'lgd.assignment.typeMismatch', message: 'Cannot assign Number to String.', expression: 'label' }
        ]);
    });

    test.each([ [ LINEAR_DEPTH, false ], [ SHARED_DEPTH, true ] ])('Retains String across %i alias levels, shared graph: %s.', (depth, shared) =>
    {
        const source = aliasChain(depth, shared);
        expect(diagnostics(source, compileBounded(source, objectModel))).toEqual([
            { ...RETURN_ERROR, expression: `step${depth}` }
        ]);
        expect(compileBounded(source.replace('"wrong"', '1'), objectModel).errors).toEqual([]);
    });

    test.each([
        [ 'self', 'let first = "wrong"; while(ready) { first = first; }' ],
        [ 'mutual', 'let first = 1; let second = "wrong"; while(ready) { first = second; second = first; }' ],
        [ 'unknown and known siblings', 'let first = document.text; while(ready) { first = ready ? first : "wrong"; }' ]
    ])('Completes %s value origins without hiding a known return branch.', (name, body) =>
    {
        const source = `class Reader { Number read(Object document, Boolean ready) { ${body} return first; } }`;
        expect(diagnostics(source, compileBounded(source, objectModel))).toEqual([{ ...RETURN_ERROR, expression: 'first' }]);
    });

    test('Retains the leaf of a deeply nested object destructuring pattern.', () =>
    {
        const depth = 48;
        const object = `${'{ inner: '.repeat(depth)}{ label: "wrong" }${'}'.repeat(depth)}`;
        const pattern = `${'{ inner: '.repeat(depth)}{ label }${'}'.repeat(depth)}`;
        const source = `const tree = ${object};\nconst ${pattern} = tree;\nNumber rejected = label;`;
        expect(diagnostics(source, compileBounded(source, objectModel))).toEqual([{ ...ASSIGNMENT_ERROR, expression: 'label' }]);
    });

    test('Resolves a finite 128-hop path through a self-referential field type.', () =>
    {
        const expression = `root.${'next.'.repeat(PROPERTY_DEPTH)}label`;
        const source = 'class Link { Link next; String label = "leaf"; }\n'
            + `Link root = Link.create();\nNumber rejected = ${expression};`;
        expect(diagnostics(source, compileBounded(source, objectModel))).toEqual([{ ...ASSIGNMENT_ERROR, expression: expression }]);
    });
});
