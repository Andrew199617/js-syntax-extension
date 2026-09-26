const assert = require('assert').strict;
const path = require('path');
const init = require('../../src/SemanticHighlighting/CallbackParameters');

// Exercise the supported TypeScript versions installed as development dependencies.
const versions = [ 'typescript-test-5-0', 'typescript-test-5-9', 'typescript-test-6-0' ];

/** @description Independent expectations for the documented 2020 wire format, not plugin exports. */
const typeShift = 8;

// Preserve every modifier bit when correcting a token type.
const modifierMask = 255;

// Identify the original function classification.
const functionType = 10;

// Expect callback bindings to use the parameter classification.
const parameterType = 6;

// Encoded spans contain a start, length and classification.
const spanSize = 3;

// Mark source positions that should be classified as parameters.
const marker = '/*parameter*/';

// Share parsed libraries within each TypeScript version while isolating sample files.
const testEnvironments = new Map();

function tokenType(classification)
{
    return (classification >> typeShift) - 1;
}

function getTestEnvironment(typescript)
{
    let environment = testEnvironments.get(typescript);
    if(!environment)
    {
        environment = {
            registry: typescript.createDocumentRegistry(typescript.sys.useCaseSensitiveFileNames, __dirname),
            comparisons: new Map(),
            nextFileId: 0
        };
        testEnvironments.set(typescript, environment);
    }

    return environment;
}

function createService(typescript, initialSource, extension = '.js')
{
    const environment = getTestEnvironment(typescript);
    environment.nextFileId++;
    const fileName = path.resolve(__dirname, `sample-${environment.nextFileId}${extension}`).replaceAll('\\', '/');
    let source = initialSource;
    let version = 0;
    const dependencySnapshots = new Map();

    const options = { allowJs: true, checkJs: true, types: [], target: typescript.ScriptTarget.ESNext };
    const host = {
        getScriptFileNames: () => [fileName],
        getScriptVersion(name)
        {
            return name === fileName ? String(version) : '0';
        },
        getScriptSnapshot(name)
        {
            if(name === fileName)
            {
                return typescript.ScriptSnapshot.fromString(source);
            }

            if(!dependencySnapshots.has(name))
            {
                const contents = typescript.sys.readFile(name);
                if(contents === undefined)
                {
                    return undefined;
                }

                dependencySnapshots.set(name, typescript.ScriptSnapshot.fromString(contents));
            }

            return dependencySnapshots.get(name);
        },
        getCurrentDirectory: () => __dirname,
        getCompilationSettings: () => options,
        getDefaultLibFileName: settings => typescript.getDefaultLibFilePath(settings),
        fileExists: typescript.sys.fileExists,
        readFile: typescript.sys.readFile,
        readDirectory: typescript.sys.readDirectory
    };

    const service = typescript.createLanguageService(host, environment.registry);
    const info = {
        languageService: service,
        project: { projectService: { logger: { info: () => undefined } } }
    };

    return {
        fileName: fileName,
        service: service,
        info: info,
        update(contents)
        {
            source = contents;
            version++;
        }
    };
}

function compare(typescript, source, extension = '.js', range)
{
    const comparisons = getTestEnvironment(typescript).comparisons;
    let context = comparisons.get(extension);
    if(!context)
    {
        context = createService(typescript, source, extension);
        comparisons.set(extension, context);
    }
    else
    {
        context.update(source);
    }

    const classify = context.service.getEncodedSemanticClassifications;
    const span = range || { start: 0, length: source.length };
    try
    {
        const original = context.service.getEncodedSemanticClassifications(context.fileName, span, '2020');
        Object.freeze(original.spans);
        Object.freeze(original);
        context.service.getEncodedSemanticClassifications = () => original;
        const plugin = init({ typescript: typescript }).create(context.info);
        const actual = plugin.getEncodedSemanticClassifications(context.fileName, span, '2020');
        assert.equal(actual.endOfLineState, original.endOfLineState);
        assert.equal(actual.spans.length, original.spans.length);
        const expectedPositions = new Set();
        let markerStart = source.indexOf(marker);
        while(markerStart !== -1)
        {
            expectedPositions.add(markerStart + marker.length);
            markerStart = source.indexOf(marker, markerStart + marker.length);
        }

        let changes = 0;
        let checked = 0;
        for(let index = 0; index < original.spans.length; index += spanSize)
        {
            const start = original.spans[index];
            const length = original.spans[index + 1];
            const before = original.spans[index + 2];
            const after = actual.spans[index + 2];
            assert.equal(actual.spans[index], start);
            assert.equal(actual.spans[index + 1], length);
            const description = `${source.slice(start, start + length)} at ${start}`;
            if(expectedPositions.has(start))
            {
                checked++;
                assert.equal(tokenType(after), parameterType, description);
                assert.equal(after & modifierMask, before & modifierMask, description);
                if(before !== after)
                {
                    changes++;
                    assert.equal(tokenType(before), functionType, description);
                }
            }
            else
            {
                assert.equal(after, before, `Unrelated token changed: ${description}`);
            }
        }

        if(!range)
        {
            assert.equal(checked, expectedPositions.size, 'Every marked parameter has a semantic token');
        }

        if(changes === 0)
        {
            assert.equal(actual, original, 'No-op must return original object');
        }
        else
        {
            assert.notEqual(actual, original);
            assert.notEqual(actual.spans, original.spans);
        }

        return { changes: changes, checked: checked };
    }
    finally
    {
        // The next comparison must request fresh classifications for its updated source.
        context.service.getEncodedSemanticClassifications = classify;
    }
}

function disposeComparisonServices()
{
    for(const environment of testEnvironments.values())
    {
        for(const context of environment.comparisons.values())
        {
            context.service.dispose();
        }
    }

    testEnvironments.clear();
}

// Cover parameter bindings, references and unrelated functions in real source text.
const fixtures = [
    {
        name: 'JSDoc callback declarations, calls, references and real functions',
        source: `
/** @param {function(string): void} report Activity receiver. */
async function scanCandidates(/*parameter*/report) {
  /*parameter*/report('Scanning');
  const local = /*parameter*/report;
  return { report: /*parameter*/report, local };
}
async function readAvailableProfiles() { return []; }
function ordinary() { return readAvailableProfiles(); }
const local = () => ordinary();
const object = { property: local, method() { return local(); } };
object.method(); object.property(); local();`
    },
    {
        name: 'methods, arrow functions and function expressions',
        source: `
/** @param {function():void} callback */
const arrow = (/*parameter*/callback) => /*parameter*/callback();
/** @param {function():void} callback */
const expression = function named(/*parameter*/callback) { /*parameter*/callback(); };
class Runner {
  /** @param {function():void} callback */
  method(/*parameter*/callback) { /*parameter*/callback(); }
}
const object = {
  /** @param {function():void} callback */
  method(/*parameter*/callback) { /*parameter*/callback(); }
};
arrow(() => {}); expression(() => {}); object.method(() => {});`
    },
    {
        name: 'default and rest parameters, defaults stay function tokens',
        source: `
function fallback() {}
function defaults(/*parameter*/callback = fallback) { /*parameter*/callback(); }
/** @param {...function():void} callbacks */
function rest(.../*parameter*/callbacks) { /*parameter*/callbacks[0](); }
function inline(/*parameter*/callback = () => {}) { /*parameter*/callback(); }`
    },
    {
        name: 'nested object and array bindings, aliases, shorthand and computed keys',
        source: `
function fallback() {}
function key() { return 'callback'; }
/** @param {{callback: function():void, nested: {done: function():void}}} options */
function object({ callback: /*parameter*/report = fallback, nested: { done: /*parameter*/done } }) {
  /*parameter*/report(); /*parameter*/done();
  const local = { report: fallback };
  local.report();
}
/** @param {{callback: function():void}} options */
function shorthand({ /*parameter*/callback }) { /*parameter*/callback(); }
/** @param {[function():void, [function():void]]} values */
function arrays([/*parameter*/first, [/*parameter*/second]]) { /*parameter*/first(); /*parameter*/second(); }
function computed({ [key()]: /*parameter*/callback = fallback }) { /*parameter*/callback(); }
function restBinding([/*parameter*/first = fallback, .../*parameter*/rest] = []) {
  /*parameter*/first(); return /*parameter*/rest;
}
function objectRest({ .../*parameter*/rest }) { return /*parameter*/rest; }`
    },
    {
        name: 'nested scopes, shadowed spellings and local destructuring',
        source: `
function report() {}
const object = { report };
/** @param {function():void} report */
function outer(/*parameter*/report) {
  function capture() { /*parameter*/report(); }
  { const report = () => {}; report(); }
  { const { report } = object; report(); }
  /** @param {function():void} report */
  function inner(/*parameter*/report) { /*parameter*/report(); }
  capture(); inner(/*parameter*/report); return { report };
}
report(); object.report();`
    },
    {
        name: 'a function expression in a default is not an outer binding',
        source: `
function fallback() {}
function defaults(/*parameter*/callback = function named() {
  const local = fallback;
  return local;
}) { /*parameter*/callback(); }`
    },
    {
        name: 'incomplete editing state',
        source: `
/** @param {function():void} callback */
function broken(/*parameter*/callback) {
  /*parameter*/callback();
  const unfinished = {`
    }
];

if(process.env.TS_LIBRARY_PATH)
{
    versions.push(process.env.TS_LIBRARY_PATH);
}

afterAll(disposeComparisonServices);

for(const moduleName of versions)
{
    const typescript = require(moduleName);

    for(const fixture of fixtures)
    {
        test(`${typescript.version}: ${fixture.name}`, () =>
        {
            assert.ok(compare(typescript, fixture.source).changes > 0);
        });
    }

    test(`${typescript.version}: JS, JSX, MJS and CJS; TypeScript and TSX unchanged`, () =>
    {
        for(const extension of [ '.js', '.jsx', '.mjs', '.cjs' ])
        {
            assert.ok(compare(typescript, fixtures[0].source, extension).changes > 0);
        }

        const source = 'function typed(callback: () => void) { callback(); }';
        compare(typescript, source, '.ts');
        compare(typescript, source, '.tsx');
        const jsx = '/** @param {function():void} callback */\n'
      + 'function View(/*parameter*/callback) { return <button onClick={/*parameter*/callback} />; }';
        assert.ok(compare(typescript, jsx, '.jsx').changes > 0);
    });

    test(`${typescript.version}: range requests and empty ranges`, () =>
    {
        const source = fixtures[0].source;
        const start = source.indexOf("/*parameter*/report('Scanning')") + marker.length;
        const result = compare(typescript, source, '.js', { start: start, length: 'report'.length });
        assert.equal(result.changes, 1);
        assert.equal(result.checked, 1);
        compare(typescript, source, '.js', { start: source.length, length: 0 });
        compare(typescript, source, '.js', { start: start + 1, length: 1 });
    });

    test(`${typescript.version}: unsupported formats, missing program/source/symbol and method context`, () =>
    {
        const context = createService(typescript, fixtures[0].source);
        const original = context.service.getEncodedSemanticClassifications(
            context.fileName,
            { start: 0, length: fixtures[0].source.length }, '2020'
        );
        const program = context.service.getProgram();
        const originalChecker = program.getTypeChecker();
        const service = {
            getProgram: () => program,
            getEncodedSemanticClassifications()
            {
                assert.equal(this, service);
                return original;
            },
            otherMethod(...args)
            {
                assert.equal(this, service);
                return args;
            }
        };
        context.info.languageService = service;
        const plugin = init({ typescript: typescript }).create(context.info);
        const range = { start: 0, length: fixtures[0].source.length };
        try
        {
            assert.deepEqual(plugin.otherMethod('argument', 2), [ 'argument', 2 ]);
            for(const format of [ undefined, 'original', 'future' ])
            {
                assert.equal(plugin.getEncodedSemanticClassifications(context.fileName, range, format), original);
            }

            service.getProgram = () => undefined;
            assert.equal(plugin.getEncodedSemanticClassifications(context.fileName, range, '2020'), original);
            service.getProgram = () => program;
            assert.equal(plugin.getEncodedSemanticClassifications('missing.js', range, '2020'), original);
            program.getTypeChecker = () => ({ getSymbolAtLocation: () => undefined });
            assert.equal(plugin.getEncodedSemanticClassifications(context.fileName, range, '2020'), original);
            program.getTypeChecker = () => originalChecker;
            const legacy = init({ typescript: { ...typescript, versionMajorMinor: '4.9' } }).create(context.info);
            assert.equal(legacy, service);
            const future = init({ typescript: { ...typescript, versionMajorMinor: '7.0' } }).create(context.info);
            assert.equal(future, service);
        }
        finally
        {
            context.service.dispose();
        }
    });

    test(`${typescript.version}: uses the current program after edits`, () =>
    {
        const source = '/** @param {function():void} callback */\nfunction run(callback) { callback(); }';
        const context = createService(typescript, source);
        const plugin = init({ typescript: typescript }).create(context.info);
        try
        {
            const range = { start: 0, length: source.length };
            const adjusted = plugin.getEncodedSemanticClassifications(context.fileName, range, '2020');
            assert.ok(adjusted.spans.some((value, index) => index % spanSize === 2 && tokenType(value) === parameterType));
            const next = 'function callback() {} callback();';
            context.update(next);
            const nextRange = { start: 0, length: next.length };
            assert.deepEqual(
                plugin.getEncodedSemanticClassifications(context.fileName, nextRange, '2020'),
                context.service.getEncodedSemanticClassifications(context.fileName, nextRange, '2020')
            );
        }
        finally
        {
            context.service.dispose();
        }
    });
}
