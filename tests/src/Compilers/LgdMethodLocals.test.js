const LgdCompiler = require('../../../src/Compilers/LgdCompiler');
const LgdSourceMap = require('../../../src/Compilers/LgdSourceMap');
const typescript = require('typescript-test-5-9');

describe('LGD method-local typed declarations.', () =>
{
    function compile(source)
    {
        return LgdCompiler.create().compileToJs(source);
    }

    test('Resolves an assignment to the nearest preceding declaration when a name is redeclared.', () =>
    {
        const source = [
            'Object widget = {',
            '    findNext: function() {',
            '        Number index = 0;',
            '        index = 1;',
            '    },',
            '    findPrevious: function() {',
            '        const Number index = 2;',
            '    }',
            '};'
        ].join('\n');
        expect(compile(source).errors).toEqual([]);
    });

    test('Ignores an unrelated block when resolving the visible declaration.', () =>
    {
        const source = [
            'Object widget = {',
            '    run: function() {',
            '        Number index = 0;',
            '        {',
            '            Number other = index;',
            '        }',
            '        const Number index2 = 1;',
            '        index = 2;',
            '    }',
            '};'
        ].join('\n');
        expect(compile(source).errors).toEqual([]);
    });

    test('Rejects an assignment to a readonly local shadowed by a later mutable declaration.', () =>
    {
        const source = [
            'Object widget = {',
            '    run: function() {',
            '        const Number index = 0;',
            '        index = 1;',
            '    },',
            '    walk: function() {',
            '        Number index = 2;',
            '    }',
            '};'
        ].join('\n');
        const result = compile(source);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toBe('Cannot assign to const variable \'index\'.');
    });

    test('Strips method parameter types at the right offset when earlier methods have typed locals.', () =>
    {
        const source = [
            'Object o = {',
            '  first() {',
            '    const Number count = 1;',
            '    return count;',
            '  },',
            '  second(Number value) {',
            '    return value;',
            '  }',
            '};'
        ].join('\n');
        const result = compile(source);
        expect(result.errors).toEqual([]);
        expect(result.code).toContain('second(value) {');
        expect(result.code).toContain('/** @type {number} */\n    const count = 1;');
    });
});

describe('LGD typed method hover regressions.', () =>
{
    /** @description Source with documented methods, typed locals, defaults, and a rest parameter. */
    const lines = [
        'Object commands = {',
        '  /**',
        '   * @description Builds a label.',
        '   * @param name The displayed name.',
        '   * @param {string} count The repeat count.',
        '   * @returns {string} The label.',
        '   */',
        '  create(String name, Number count = 0) {',
        '    const Number total = count;',
        '    return name + total;',
        '  },',
        '  next(...String labels) {',
        '    const String first = labels[0];',
        '    return first;',
        '  }',
        '};',
        'Function transform = (Number size) => {',
        '  Number result = size + 1;',
        '  return result;',
        '};'
    ];

    /**
     * @description Creates a real TypeScript language service for the compiled JavaScript.
     * @param {string} code the JavaScript mirror text.
     * @returns {Object} the language service and its script path.
     */
    function createTypeService(code)
    {
        const fileName = '/lgd-hover-regression.js';
        const options = { allowJs: true, checkJs: true, target: typescript.ScriptTarget.ES2020 };
        const host = {
            getScriptFileNames: () => [fileName],
            getScriptVersion: () => '0',

            /**
             * @description Loads the mirror or a TypeScript standard-library snapshot.
             * @param {string} file the requested script path.
             * @returns {Object|undefined} the snapshot when available.
             */
            getScriptSnapshot: file =>
            {
                const text = file === fileName ? code : typescript.sys.readFile(file);
                return text === undefined ? undefined : typescript.ScriptSnapshot.fromString(text);
            },
            getCurrentDirectory: () => '/',
            getCompilationSettings: () => options,
            getDefaultLibFileName: settings => typescript.getDefaultLibFilePath(settings),
            fileExists: typescript.sys.fileExists,
            readFile: typescript.sys.readFile,
            readDirectory: typescript.sys.readDirectory
        };

        return { service: typescript.createLanguageService(host), fileName: fileName };
    }

    test.each([ '\n', '\r\n' ])('Keeps parameter, local, and usage ranges exact with %j line endings.', newline =>
    {
        const source = lines.join(newline);
        const result = LgdCompiler.create().compileToJs(source);
        const map = LgdSourceMap.create(result.mappings);
        const symbols = [ 'name,', 'count =', 'total =', 'total;', 'labels)', 'first =', 'first;', 'size)', 'result =', 'result;' ];
        expect(result.errors).toEqual([]);
        for(const symbol of symbols)
        {
            const start = source.indexOf(symbol);
            const name = symbol.match(/^\w+/)[0];
            const outputStart = map.toOutput(start);
            const outputEnd = map.toOutput(start + name.length);
            expect(result.code.slice(outputStart, outputEnd)).toBe(name);
            expect(map.toSource(outputStart)).toBe(start);
            expect(map.toSource(outputEnd)).toBe(start + name.length);
        }
    });

    test('Preserves method documentation while emitting each parameter type once.', () =>
    {
        const result = LgdCompiler.create().compileToJs(lines.join('\n'));
        expect(result.code).toContain('@description Builds a label.');
        expect(result.code).toContain('@param {string} name The displayed name.');
        expect(result.code).toContain('@param {number} count The repeat count.');
        expect(result.code).toContain('@returns {string} The label.');
        expect(result.code).toContain('@param {...string} labels');
        expect(result.code.match(/@param {number} count/g)).toHaveLength(1);
        expect(result.code).toContain('next(...labels)');
    });

    test('infers ordinary const hovers alongside annotated immutable bindings', () =>
    {
        const source = 'const Number total = 2;\nconst label = "ready";';
        const result = LgdCompiler.create().compileToJs(source);
        const map = LgdSourceMap.create(result.mappings);
        const { service, fileName } = createTypeService(result.code);
        try
        {
            expect(result.errors).toEqual([]);
            for(const [ name, expected ] of [ [ 'total', 'const total: number' ], [ 'label', 'const label: "ready"' ] ])
            {
                const info = service.getQuickInfoAtPosition(fileName, map.toOutput(source.indexOf(name)));
                expect(typescript.displayPartsToString(info.displayParts)).toBe(expected);
            }
        }
        finally
        {
            service.dispose();
        }
    });

    test('Resolves real TypeScript hover types through the adjusted source map.', () =>
    {
        const source = lines.join('\n');
        const result = LgdCompiler.create().compileToJs(source);
        const map = LgdSourceMap.create(result.mappings);
        const { service, fileName } = createTypeService(result.code);
        const expectations = [
            [ 'name,', '(parameter) name: string' ],
            [ 'count =', '(parameter) count: number' ],
            [ 'total =', 'const total: number' ],
            [ 'labels)', '(parameter) labels: string[]' ],
            [ 'first =', 'const first: string' ],
            [ 'result =', 'let result: number' ]
        ];
        try
        {
            for(const [ symbol, expected ] of expectations)
            {
                const offset = map.toOutput(source.indexOf(symbol));
                const info = service.getQuickInfoAtPosition(fileName, offset);
                expect(info).toBeDefined();
                expect(typescript.displayPartsToString(info.displayParts)).toBe(expected);
            }
        }
        finally
        {
            service.dispose();
        }
    });
});

describe('LGD module namespace inference.', () =>
{
    test('Leaves broad Object require imports inferable without changing ordinary Objects.', () =>
    {
        const source = [
            "const Object vscode = require('vscode');",
            '/** @description Loaded dependency. */',
            'Object dependency = require("dependency");',
            '/** @type {CustomShape} */',
            'Object explicit = require("dependency");',
            'Object record = {};'
        ].join('\n');
        const result = LgdCompiler.create().compileToJs(source);
        expect(result.code).toContain("const vscode = require('vscode');");
        expect(result.code).toContain('/** @description Loaded dependency. */\nlet dependency =');
        expect(result.code).toContain('/** @type {CustomShape} */\nlet explicit =');
        expect(result.code).toContain('/** @type {Object} */\nlet record = {};');
        expect(result.code.match(/@type {Object}/g)).toHaveLength(1);
    });
});
