const LgdEditorConfig = require('../../../../src/Lgd/Formatting/LgdEditorConfig');

/** @description Test fixtures deliberately cover configuration resource limits. */
const limits = { adversarialPath: 200, oversizedPattern: 1025, oversizedPath: 8193, unsupported: 4, projectSpecific: 3 };

it('applies only matching sections and honors preamble root and later properties', () =>
{
    const parsed = LgdEditorConfig.parse('root = true\n[*.cs]\nindent_size = 8\n[*.lgd]\nindent_size = 2\n[*.lgd]\nindent_size = 4', '/work/.editorconfig');
    expect(parsed.root).toBe(true);
    expect(parsed.issues).toEqual([]);
    expect(LgdEditorConfig.apply(parsed, 'src/Command.lgd')).toEqual(Object.fromEntries([[ 'indent_size', '4' ]]));
    expect(LgdEditorConfig.apply(parsed, 'src/Command.js')).toEqual({});
});

it('reports misplaced root and preamble properties without applying them', () =>
{
    const parsed = LgdEditorConfig.parse('indent_size = 8\n[*.cs]\nroot = true\nindent_size = 2');
    expect(parsed.root).toBe(false);
    expect(parsed.issues).toHaveLength(2);
    expect(LgdEditorConfig.apply(parsed, 'Command.lgd')).toEqual({});
});

it('preserves inline comment characters and custom value capitalization', () =>
{
    const parsed = LgdEditorConfig.parse('\uFEFFROOT = TRUE\r\n# comment\r\n[*.lgd]\r\nINDENT_STYLE = SPACE\r\ncustom_name = MiXeD # literal ; literal\r\n');
    expect(parsed.root).toBe(true);
    expect(LgdEditorConfig.apply(parsed, 'one.lgd')).toEqual(Object.fromEntries([ [ 'indent_style', 'SPACE' ], [ 'custom_name', 'MiXeD # literal ; literal' ] ]));
    expect(LgdEditorConfig.map(Object.fromEntries([[ 'indent_style', 'space # not a comment' ]])).options).toEqual({});
});

it('resolves ancestors, unset, matching specificity and nested roots', () =>
{
    const root = LgdEditorConfig.parse('[*]\nindent_size = 8\nend_of_line = lf', '/work/.editorconfig');
    const nearest = LgdEditorConfig.parse('[*.lgd]\nindent_size = unset\nindent_style = tab', '/work/src/.editorconfig');
    const unrelated = LgdEditorConfig.parse('root = true\n[*]\nindent_size = 12', '/elsewhere/.editorconfig');
    expect(LgdEditorConfig.resolve([ root, unrelated, nearest ], { filePath: '/work/src/Command.lgd' }).properties).toEqual(Object.fromEntries([ [ 'end_of_line', 'lf' ], [ 'indent_style', 'tab' ] ]));
    nearest.root = true;
    expect(LgdEditorConfig.resolve([ root, nearest ], { filePath: '/work/src/Command.lgd' }).properties).toEqual(Object.fromEntries([[ 'indent_style', 'tab' ]]));
});

it('supports Windows directory paths without allowing cross-drive configuration', () =>
{
    const parsed = LgdEditorConfig.parse('[src/*.lgd]\nindent_size=2', 'C:\\work\\.editorconfig');
    expect(LgdEditorConfig.resolve([parsed], { filePath: 'C:\\work\\src\\one.lgd' }).properties).toEqual(Object.fromEntries([[ 'indent_size', '2' ]]));
    expect(LgdEditorConfig.resolve([parsed], { filePath: 'D:\\work\\src\\one.lgd' }).properties).toEqual({});
});

it.each([
    [ '*.lgd', 'nested/one.lgd', true ],
    [ '*.lgd', 'one.LGD', false ],
    [ 'src/*.lgd', 'src/deep/one.lgd', false ],
    [ '/src/*.lgd', 'src/one.lgd', true ],
    [ '/*.lgd', 'deep/one.lgd', false ],
    [ 'src/**/one.lgd', 'src/one.lgd', true ],
    [ 'src/**/one.lgd', 'src/a/b/one.lgd', true ],
    [ 'src/**one.lgd', 'src/a/b/one.lgd', true ],
    [ 'a**b.lgd', 'nested/a/deep/b.lgd', true ],
    [ '*.{lgd,js}', 'src/one.lgd', true ],
    [ '{src,{tests,spec}}/**/*.{lgd,js}', 'tests/unit/one.lgd', true ],
    [ '{src,{tests,spec}}/**/*.{lgd,js}', 'other/unit/one.lgd', false ],
    [ 'v{-2..4}/one.lgd', 'v-1/one.lgd', true ],
    [ 'v{-2..4}/one.lgd', 'v5/one.lgd', false ],
    [ 'v{1..100000000000000000000}/one.lgd', 'v100000000000000000000/one.lgd', true ],
    [ '[ab]?.lgd', 'a1.lgd', true ],
    [ '[!ab]?.lgd', 'a1.lgd', false ],
    [ '[!ab]?.lgd', 'c1.lgd', true ],
    [ 'literal\\*.lgd', 'literal*.lgd', true ],
    [ '{one}.lgd', '{one}.lgd', true ],
    [ 'folder/', 'folder/one.lgd', false ],
    [ 'v{5..1}.lgd', 'v3.lgd', false ]
])('matches EditorConfig glob %s against %s', (pattern, sourcePath, expected) =>
{
    expect(LgdEditorConfig.matches(pattern, sourcePath)).toBe(expected);
});

it('keeps bracket-set contents literal as required by the EditorConfig specification', () =>
{
    expect(LgdEditorConfig.matches('[a-z].lgd', '-.lgd')).toBe(true);
    expect(LgdEditorConfig.matches('[a-z].lgd', 'b.lgd')).toBe(false);
});

it('bounds adversarial glob work without regex backtracking or numeric range expansion', () =>
{
    expect(LgdEditorConfig.matches(`${'*a'.repeat(100)}b`, `${'a'.repeat(limits.adversarialPath)}c`)).toBe(false);
    expect(LgdEditorConfig.matches('a'.repeat(limits.oversizedPattern), 'a')).toBe(false);
    expect(LgdEditorConfig.matches('*', 'a'.repeat(limits.oversizedPath))).toBe(false);
});

it('treats prototype-like property names as inert data', () =>
{
    const parsed = LgdEditorConfig.parse('[*]\n__proto__ = value\nconstructor = text\nindent_style=space');
    const applied = LgdEditorConfig.apply(parsed, 'one.lgd');
    expect(Object.getPrototypeOf(applied)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(applied, '__proto__').value).toBe('value');
    const mapped = LgdEditorConfig.map(applied);
    expect(mapped.options).toEqual({ indentation: { style: 'space' } });
    expect(mapped.issues).toHaveLength(2);
});

it('maps core indentation and whitespace without depending on property order', () =>
{
    const mapped = LgdEditorConfig.map(Object.fromEntries([
        [ 'tab_width', '8' ],
        [ 'indent_size', 'tab' ],
        [ 'indent_style', 'TAB' ],
        [ 'end_of_line', 'CRLF' ],
        [ 'insert_final_newline', 'false' ],
        [ 'trim_trailing_whitespace', 'true' ]
    ]));
    expect(mapped.options).toEqual({ indentation: { style: 'tab', size: 8, tabWidth: 8 }, whitespace: { endOfLine: 'crlf', finalNewline: 'never', trimTrailingWhitespace: true } });
    expect(mapped.issues).toEqual([]);
    expect(LgdEditorConfig.map(Object.fromEntries([[ 'indent_size', '3' ]])).options).toEqual({ indentation: { size: 3, tabWidth: 3 } });
});

it('reports unsupported widths and unresolved editor tab width instead of guessing', () =>
{
    expect(LgdEditorConfig.map(Object.fromEntries([[ 'indent_size', 'tab' ]])).issues).toHaveLength(1);
    expect(LgdEditorConfig.map(Object.fromEntries([ [ 'indent_size', '100' ], [ 'tab_width', '0' ] ])).options).toEqual({});
});

it('maps independent C# parentheses, binary operator and inherited colon preferences', () =>
{
    const mapped = LgdEditorConfig.map(Object.fromEntries([
        [ 'csharp_space_between_parentheses', 'control_flow_statements, expressions' ],
        [ 'csharp_space_between_method_call_parameter_list_parentheses', 'false' ],
        [ 'csharp_space_between_method_declaration_parameter_list_parentheses', 'true' ],
        [ 'csharp_space_before_colon_in_inheritance_clause', 'false' ],
        [ 'csharp_space_around_binary_operators', 'none' ]
    ]));
    expect(mapped.options.spacing).toEqual({ insideCastParens: false, insideControlParens: true, insideOtherParens: true, insideCallParens: false, insideDeclarationParens: true, beforeInheritanceColon: false, binaryOperators: 'none' });
    expect(mapped.issues).toEqual([]);
});

it('maps only declared C# brace locations and leaves destructuring unforced', () =>
{
    const mapped = LgdEditorConfig.map(Object.fromEntries([ [ 'csharp_new_line_before_open_brace', 'methods, control_blocks' ], [ 'csharp_new_line_before_else', 'false' ] ]));
    expect(mapped.options.braces.wrapping).toMatchObject({ methods: 'nextLine', constructors: 'nextLine', controlBlocks: 'nextLine', classes: 'sameLine', objectLiterals: 'sameLine' });
    expect(mapped.options.braces.wrapping.objectPatterns).toBeUndefined();
    expect(mapped.options.braces.beforeElse).toBe(false);
    expect(LgdEditorConfig.map(Object.fromEntries([[ 'csharp_new_line_before_open_brace', 'events' ]])).options).toEqual({});
});

it('maps IDE0055 only to style severities and never authorizes fixes', () =>
{
    const mapped = LgdEditorConfig.map(Object.fromEntries([ [ 'dotnet_diagnostic.IDE0055.severity', 'error' ], [ 'csharp_prefer_braces', 'true:warning' ] ]));
    expect(mapped.rules['lgd.format.spacing']).toEqual({ severity: 'error' });
    expect(mapped.rules['lgd.format.bracesRequired.mode']).toEqual({ severity: 'warning' });
    expect(mapped.options.bracesRequired).toEqual({ mode: 'always' });
    expect(Object.values(mapped.rules).some(rule => Object.hasOwn(rule, 'fix'))).toBe(false);
});

it('reports lossy severities and foreign analyzers without disabling compatible styles', () =>
{
    const mapped = LgdEditorConfig.map(Object.fromEntries([
        [ 'csharp_prefer_braces', 'when_multiline:suggestion' ],
        [ 'dotnet_diagnostic.IDE0055.severity', 'silent' ],
        [ 'dotnet_diagnostic.UNT0039.severity', 'warning' ],
        [ 'csharp_style_prefer_readonly_struct', 'true:warning' ]
    ]));
    expect(mapped.options).toEqual({ bracesRequired: { mode: 'multiLine' } });
    expect(mapped.rules).toEqual({});
    expect(mapped.issues).toHaveLength(limits.unsupported);
});

it('does not import project-specific naming or arbitrary analyzer settings as language defaults', () =>
{
    const mapped = LgdEditorConfig.map({ 'dotnet_naming_style.project_style.required_prefix': 'm_', 'dotnet_code_quality.HN0001.prefix_int': 'n', 'dotnet_diagnostic.rcs1007.severity': 'warning' });
    expect(mapped.options).toEqual({});
    expect(mapped.rules).toEqual({});
    expect(mapped.issues).toHaveLength(limits.projectSpecific);
});

it('does not treat severity suffixes as valid values for standard EditorConfig keys', () =>
{
    const mapped = LgdEditorConfig.map(Object.fromEntries([ [ 'indent_style', 'space:warning' ], [ 'insert_final_newline', 'true:error' ] ]));
    expect(mapped.options).toEqual({});
    expect(mapped.rules).toEqual({});
    expect(mapped.issues).toHaveLength(2);
});

it('imports independent experimental blank-line rules with their severities', () =>
{
    const imported = LgdEditorConfig.map(Object.fromEntries([
        [ 'csharp_style_allow_blank_lines_between_consecutive_braces_experimental', 'false:warning' ],
        [ 'dotnet_style_allow_statement_immediately_after_block_experimental', 'false:error' ],
        [ 'csharp_style_allow_blank_line_after_colon_in_constructor_initializer_experimental', 'false:warning' ],
        [ 'csharp_style_allow_blank_line_after_token_in_conditional_expression_experimental', 'false:warning' ],
        [ 'csharp_style_allow_blank_line_after_arrow_expression_clause_experimental', 'false:warning' ]
    ]));

    expect(imported.options.lineBreaks).toEqual({ blankLinesBetweenClosingBraces: false, statementImmediatelyAfterBlock: false,
        blankLineAfterConstructorColon: false, blankLineAfterConditionalToken: false, blankLineAfterArrow: false });
    expect(imported.rules['lgd.format.lineBreaks.statementImmediatelyAfterBlock'].severity).toBe('error');
    expect(imported.issues).toHaveLength(0);
});

it('maps explicit declaration, embedded-statement, import-group and header preferences', () =>
{
    const imported = LgdEditorConfig.map(Object.fromEntries([
        [ 'csharp_space_around_declaration_statements', 'ignore' ],
        [ 'csharp_style_allow_embedded_statements_on_same_line_experimental', 'false:warning' ],
        [ 'dotnet_separate_import_directive_groups', 'true' ],
        [ 'file_header_template', 'My Project\\nCopyright 2026' ],
        [ 'dotnet_diagnostic.IDE0073.severity', 'warning' ]
    ]));
    expect(imported.options.spacing.declarations).toBe('preserve');
    expect(imported.options.lineBreaks).toEqual({ embeddedStatementsSameLine: false, importGroups: 'origin' });
    expect(imported.options.whitespace.fileHeader).toBe('My Project\nCopyright 2026');
    expect(imported.rules['lgd.format.whitespace.fileHeader'].severity).toBe('warning');
    expect(imported.issues).toHaveLength(0);
});

it('imports cast-head and post-cast spacing independently', () =>
{
    const imported = LgdEditorConfig.map(Object.fromEntries([
        [ 'csharp_space_after_cast', 'true' ],
        [ 'csharp_space_between_parentheses', 'type_casts, expressions' ]
    ]));
    expect(imported.options.spacing).toMatchObject({ afterCast: true, insideCastParens: true, insideOtherParens: true, insideControlParens: false });
    expect(imported.issues).toHaveLength(0);
});
