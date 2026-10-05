const path = require('path');
const LgdClangFormat = require('../../../../src/Lgd/Formatting/LgdClangFormat');
const LgdEslintStyle = require('../../../../src/Lgd/Formatting/LgdEslintStyle');
const LgdFormattingSources = require('../../../../src/Lgd/Formatting/LgdFormattingSources');

/** @description Simulates snapshot-aware source discovery without accessing any real user configuration. */
async function resolve(files, sources)
{
    const snapshotsByPath = new Map();
    for(const [ filename, text ] of Object.entries(files))
    {
        snapshotsByPath.set(path.resolve(filename), text);
    }

    const readSnapshot = jest.fn(filename => Promise.resolve({ path: filename, realPath: filename, text: snapshotsByPath.get(filename) ?? null, version: null, open: false }));
    const result = await LgdFormattingSources.resolve({ filePath: path.resolve('/project/src/main.lgd'), workspaceRoot: path.resolve('/project'), readSnapshot: readSnapshot, sources: sources });
    return { ...result, readSnapshot: readSnapshot };
}

describe('data-only clang-format import', () =>
{
    test('maps the supplied relevant formatting preferences', () =>
    {
        const result = LgdClangFormat.parse('BasedOnStyle: LLVM\nColumnLimit: 180\nUseTab: ForIndentation\nTabWidth: 4\nIndentWidth: 4\nBreakBeforeBraces: Allman\nInsertBraces: true\nAllowShortFunctionsOnASingleLine: Empty\nSpaceInEmptyBraces: Block\nSpaceBeforeParens: Never\nBinPackArguments: false\nBinPackParameters: false\nBreakBeforeBinaryOperators: NonAssignment\nSeparateDefinitionBlocks: Always\nMaxEmptyLinesToKeep: 1');
        expect(result.options.braces.style).toBe('allman');
        expect(result.options.indentation).toEqual({ size: 4, style: 'tab', tabWidth: 4, tabUsage: 'indentation' });
        expect(result.options.wrapping).toMatchObject({ columnLimit: 180, arguments: 'onePerLine', parameters: 'onePerLine', binaryOperators: 'beforeNonAssignment' });
        expect(result.options.lineBreaks).toMatchObject({ shortFunctions: 'empty', separateDefinitions: 'always', maxEmptyLines: 1 });
        expect(result.options.bracesRequired.mode).toBe('always');
        expect(result.issues).toEqual([]);
    });

    test('ignores custom wrapping unless the Custom brace style was selected', () =>
    {
        expect(LgdClangFormat.parse('BreakBeforeBraces: Allman\nBraceWrapping:\n  AfterClass: false').options.braces.wrapping).toBeUndefined();
        const result = LgdClangFormat.parse('BreakBeforeBraces: Custom\nBraceWrapping:\n  AfterClass: true\n  AfterControlStatement: MultiLine\n  BeforeElse: false\n  IndentBraces: true');
        expect(result.options.braces.wrapping.classes).toBe('nextLineIndented');
        expect(result.options.braces.wrapping.controlBlocks).toBe('nextLineIfMultiline');
        expect(result.options.braces.beforeElse).toBe(false);
    });

    test('applies general and JavaScript documents but ignores foreign language sections', () =>
    {
        const result = LgdClangFormat.parse('IndentWidth: 2\n---\nLanguage: Cpp\nIndentWidth: 8\n---\nLanguage: JavaScript\nTabWidth: 4');
        expect(result.options.indentation).toEqual({ size: 2, tabWidth: 4 });
    });

    test.each([ '!!js/function >\n  function execute() {}', 'settings: &settings { Width: 2 }\nother: *settings', 'IndentWidth: [1, 2]', '__proto__: { polluted: true }', 'IndentWidth: 4\nIndentWidth: 2', 'hello' ])('rejects unsafe or unsupported YAML structure %s', text =>
    {
        const result = LgdClangFormat.parse(text);
        expect(result.disabled).toBe(true);
        expect(result.options).toEqual({});
        expect(result.issues.length).toBeGreaterThan(0);
        expect({}.polluted).toBeUndefined();
    });

    test('explains unsupported optimizer and foreign-language options', () =>
    {
        const result = LgdClangFormat.parse('PointerAlignment: Left\nPenaltyBreakAssignment: 1000\nFixNamespaceComments: true');
        expect(result.issues.join(' ')).toContain('PointerAlignment');
        expect(result.issues.join(' ')).toContain('PenaltyBreakAssignment');
        expect(result.issues.join(' ')).toContain('FixNamespaceComments');
    });
});

describe('ESLint preference import', () =>
{
    test('maps supported core and stylistic rule names without loading plugins', () =>
    {
        const result = LgdEslintStyle.parse(JSON.stringify({ plugins: ['@stylistic'], extends: 'some-executable-plugin', rules: { '@stylistic/brace-style': [ 'error', 'allman' ], 'comma-spacing': [ 'warn', { before: false, after: true } ], 'no-trailing-spaces': 'error' } }));
        expect(result.options.braces.style).toBe('allman');
        expect(result.options.spacing.afterComma).toBe(true);
        expect(result.rules['lgd.format.spacing.afterComma'].severity).toBe('warning');
        expect(result.issues[0]).toContain('not executed');
    });

    test('accepts comments and trailing commas without accepting executable expressions', () =>
    {
        const configured = LgdEslintStyle.parse('{ // preferences\n "rules": { "brace-style": ["warn", "allman"], }, }');
        expect(configured.options.braces.style).toBe('allman');
        expect(LgdEslintStyle.parse('{"rules": computeRules()}').disabled).toBe(true);
        expect(LgdEslintStyle.parse('{"__proto__": {}}').disabled).toBe(true);
    });

    test('off rules do not import enforcing option values', () =>
    {
        const result = LgdEslintStyle.parse('{"rules":{"curly":"off","space-infix-ops":"off"}}');
        expect(result.options).toEqual({});
        expect(result.rules['lgd.format.bracesRequired.mode'].severity).toBe('off');
    });

    test('keeps independently imported option severities separate', () =>
    {
        const result = LgdEslintStyle.parse('{"rules":{"comma-spacing":["warn",{"after":false}],"space-in-parens":["error","always"]}}');
        expect(result.rules['lgd.format.spacing.afterComma'].severity).toBe('warning');
        expect(result.rules['lgd.format.spacing.insideCallParens'].severity).toBe('error');
    });

    test('does not execute JavaScript configuration or invent fixes for arbitrary plugins', () =>
    {
        expect(LgdEslintStyle.parse('module.exports = getConfig()').disabled).toBe(true);
        const result = LgdEslintStyle.parse('{"rules":{"my-plugin/change-state":"error"}}');
        expect(result.options).toEqual({});
        expect(result.issues[0]).toContain('no supported LGD style mapping');
    });
});

describe('snapshot-aware style source precedence', () =>
{
    test('applies source list order and keeps missing-file snapshots', async () =>
    {
        const files = {
            '/project/.editorconfig': 'root=true\n[*.lgd]\nindent_size=2',
            '/project/.clang-format': 'IndentWidth: 6',
            '/project/.eslintrc.json': '{"rules":{"indent":["warn",4]}}'
        };
        const result = await resolve(files, [ 'editorconfig', 'clang-format', 'eslint' ]);
        expect(result.options.indentation).toMatchObject({ size: 4 });
        expect(result.snapshots.some(snapshot => snapshot.path === path.resolve('/project/src/.editorconfig') && snapshot.text === null)).toBe(true);
        const reordered = await resolve(files, [ 'eslint', 'clang-format', 'editorconfig' ]);
        expect(reordered.options.indentation.size).toBe(2);
    });

    test('does not apply a C# selector to LGD files', async () =>
    {
        const result = await resolve({ '/project/.editorconfig': 'root=true\n[*.cs]\nindent_size=8' }, ['editorconfig']);
        expect(result.options).toEqual({});
    });

    test('uses nearest clang config and supports explicit parent inheritance', async () =>
    {
        const files = { '/project/.clang-format': 'IndentWidth: 2\nColumnLimit: 180', '/project/src/.clang-format': 'IndentWidth: 8' };
        expect((await resolve(files, ['clang-format'])).options).toEqual({ indentation: { size: 8 } });
        files['/project/src/.clang-format'] = 'BasedOnStyle: InheritParentConfig\nIndentWidth: 8';
        expect((await resolve(files, ['clang-format'])).options).toEqual({ indentation: { size: 8 }, wrapping: { columnLimit: 180 } });
    });

    test('honors ESLint root and file overrides', async () =>
    {
        const result = await resolve({
            '/project/.eslintrc.json': '{"rules":{"indent":["warn",2]}}',
            '/project/src/.eslintrc.json': '{"root":true,"rules":{"indent":["warn",4]},"overrides":[{"files":["*.lgd"],"rules":{"indent":["error",8]}}]}'
        }, ['eslint']);
        expect(result.options.indentation).toMatchObject({ size: 8 });
        expect(result.readSnapshot.mock.calls.some(([filename]) => filename === path.resolve('/project/.eslintrc.json'))).toBe(false);
    });

    test('fails closed on malformed selected sources and invalid numeric values', async () =>
    {
        const malformed = await resolve({ '/project/.clang-format': 'IndentWidth: [4]' }, ['clang-format']);
        expect(malformed.disabled).toBe(true);
        const invalid = await resolve({ '/project/.clang-format': 'IndentWidth: -2' }, ['clang-format']);
        expect(invalid.disabled).toBe(true);
        expect(invalid.issues[0]).toMatchObject({ severity: 'error' });
    });

    test('never reads outside the workspace or sources not selected', async () =>
    {
        const result = await resolve({}, []);
        expect(result.readSnapshot).not.toHaveBeenCalled();
        expect(() => LgdFormattingSources.directories('/other/main.lgd', '/project')).toThrow('inside its workspace');
    });
});

it.each([
    [ 'Never', 'preserve' ], [ 'RespectPrecedence', 'respectPrecedence' ], [ 'OnePerLine', 'onePerLine' ]
])('imports the %s binary-expression layout mode', (external, native) =>
{
    const imported = LgdClangFormat.parse(`BreakBinaryOperations: ${external}`);
    expect(imported.options.wrapping.binaryOperations).toBe(native);
    expect(imported.issues).toHaveLength(0);
});

it.each([ [ 'None', 'preserve' ], [ 'All', 'nextLine' ], [ 'AllDefinitions', 'nextLine' ] ])('imports %s return type line style', (external, native) =>
{
    const imported = LgdClangFormat.parse(`AlwaysBreakAfterReturnType: ${external}`);
    expect(imported.options.wrapping.returnType).toBe(native);
    expect(imported.issues).toHaveLength(0);
});

test('explicit imported and native layout choices take precedence over readable defaults', () =>
{
    const formatter = require('../../../../src/Lgd/Formatting/LgdFormatter');

    const source = 'class Example\n{\n    Example() { }\n\n    Number add(Number first)\n    {\n        return first\n            + 1;\n    }\n}';
    const imported = LgdClangFormat.parse('SeparateDefinitionBlocks: Never\nBreakBinaryOperations: Never\nBreakBeforeBinaryOperators: NonAssignment');
    const preserved = formatter.format(source, { options: imported.options });
    expect(preserved).toContain('Example() { }\n    Number add');
    expect(preserved).toContain('return first\n');
    const rules = { 'lgd.format.wrapping': { options: { binaryOperations: 'fit' } }, 'lgd.format.lineBreaks': { options: { separateDefinitions: 'always' } } };
    const overridden = formatter.format(source, { options: imported.options, rules: rules });
    expect(overridden).toContain('Example() { }\n\n    Number add');
    expect(overridden).toContain('return first + 1;');
    expect(formatter.format(overridden, { options: imported.options, rules: rules })).toBe(overridden);
});

test.each([ false, true ])('honors imported %s parenthesis padding and explicit native precedence', padding =>
{
    const formatter = require('../../../../src/Lgd/Formatting/LgdFormatter');
    const editorConfig = require('../../../../src/Lgd/Formatting/LgdEditorConfig');

    const source = 'function choose(value, fallback){if(value){read(value);}return(value ?? (fallback));}';
    const edge = padding ? ' ' : '';
    const editor = editorConfig.map(Object.fromEntries([
        [ 'csharp_space_between_parentheses', padding ? 'control_flow_statements,expressions' : 'false' ],
        [ 'csharp_space_between_method_declaration_parameter_list_parentheses', String(padding) ],
        [ 'csharp_space_between_method_call_parameter_list_parentheses', String(padding) ]
    ]));
    const clang = LgdClangFormat.parse(`SpacesInParentheses: ${padding}`);
    const eslint = LgdEslintStyle.parse(JSON.stringify({ rules: { 'space-in-parens': [ 'error', padding ? 'always' : 'never' ], 'keyword-spacing': [ 'error', { after: false } ] } }));
    for(const imported of [ editor, clang, eslint ])
    {
        expect(imported.issues).toHaveLength(0);
        const configuration = { options: imported.options, rules: imported.rules };
        const formatted = formatter.format(source, configuration);
        expect(formatted).toContain(`function choose(${edge}value, fallback${edge})`);
        expect(formatted).toContain(`if(${edge}value${edge})`);
        expect(formatted).toContain(`read(${edge}value${edge});`);
        expect(formatted).toContain(`(${edge}value ?? (${edge}fallback${edge})${edge});`);
        expect(formatter.format(formatted, configuration)).toBe(formatted);
        const override = { insideDeclarationParens: !padding, insideControlParens: !padding, insideCallParens: !padding, insideOtherParens: !padding };
        const native = formatter.format(source, { ...configuration, rules: { ...configuration.rules, 'lgd.format.spacing': { options: override } } });
        const nativeEdge = padding ? '' : ' ';
        expect(native).toContain(`function choose(${nativeEdge}value, fallback${nativeEdge})`);
        expect(native).toContain(`if(${nativeEdge}value${nativeEdge})`);
        expect(native).toContain(`read(${nativeEdge}value${nativeEdge});`);
        expect(native).toContain(`(${nativeEdge}value ?? (${nativeEdge}fallback${nativeEdge})${nativeEdge});`);
    }

    expect(formatter.format(source, { options: eslint.options })).toContain(`return(${edge}value ?? (${edge}fallback${edge})${edge});`);
});

test('imports a return keyword override without changing the control keyword preference', () =>
{
    const formatter = require('../../../../src/Lgd/Formatting/LgdFormatter');

    const imported = LgdEslintStyle.parse('{"rules":{"keyword-spacing":["warn",{"after":false,"overrides":{"return":{"after":true}}}]}}');
    expect(imported.options.spacing).toEqual({ afterControlKeywords: false, afterReturnKeyword: true });
    expect(imported.rules['lgd.format.spacing.afterReturnKeyword']).toEqual({ severity: 'warning' });
    expect(formatter.format('function run(value){if(value){return(value);}}', { options: imported.options })).toContain('return (value);');
    const native = { options: { afterReturnKeyword: false, insideOtherParens: false } };
    expect(formatter.format('function run(value){return(value);}', { options: imported.options, rules: { 'lgd.format.spacing': native } })).toContain('return(value);');
});
