# LGD formatting and style compatibility ledger

This catalog describes the built-in LGD formatter, its supported external preferences and known limits. It does not imply compatibility with every upstream formatter or analyzer.

## Reading the status

- **Supported**: the named external property/value has a documented adapter and an implemented LGD formatting operation. Support is limited to the stated values and source constructs; it does not promise all capabilities of the originating formatter.
- **Partial**: the imported option has a useful, implemented LGD subset, but some upstream behaviors or variants cannot be represented exactly. The row identifies the limit.
- **Unsupported**: no compatible importer or proven safe transformation is implemented. The reason is stated explicitly; this is not a promise that a broad upstream analyzer will run.
- **Not applicable**: the setting relies on a foreign language/runtime or is project-specific analyzer/naming policy explicitly excluded from language defaults.

Implementation status is tracked separately from applicability. Supported rows reflect the implemented importer/formatter subset; Unsupported rows remain unavailable even when a related native safe subset exists. This audit uses the current LGD branch, including public/private/protected/internal accessibility support. Native syntax errors, including invalid LGD inheritance, reserved constructor spellings and prohibited constructor returns, remain compiler checks, not suppressible formatting preferences.

## Design choice and tradeoffs

A native LGD rule registry with narrow configuration adapters is the best fit:

1. **Run clang-format, Roslyn or ESLint directly over LGD:** broad upstream functionality, but those tools do not parse the entire LGD grammar or share its type/runtime model. Executing an ESLint JavaScript configuration also executes project code. Not selected as the built-in architecture.
2. **Format generated JavaScript and reverse-map it:** useful for delegated language-service features, but generated constructors, types, field initialization and erased interfaces do not round-trip into source formatting. Not selected for edits.
3. **Format parsed LGD source with guarded edits:** preserves language-specific declarations, allows per-rule controls and supports a safe subset of external preferences. Selected. Unsupported external rules must be explained rather than silently reported as enforced.

Native settings use the groups `braces`, `indentation`, `spacing`, `lineBreaks`, `wrapping`, `whitespace`, `bracesRequired`, `declarations`, `expressions` and `cleanup`. The native rule identifiers are `lgd.format.<group>` under `rules`. Each group and its catalogued option-level rule IDs can independently select `fix: off | manual | automatic` and diagnostic `severity: off | warning | error`. Style choices live in the group `options`; a preset is refined by explicit per-location choices. For example, `lgd.format.braces.methods` and `lgd.format.spacing.afterComma` have separate policies. General defaults must be neutral language choices; project-specific naming conventions and third-party analyzer switches are excluded from universal defaults.

- `off`: no fix from this rule
- `manual`: eligible for an explicitly chosen formatting/quick-fix action, not automatic save/fix-all
- `automatic`: eligible for automatic formatting as well as manual actions
- Diagnostic severity does not imply permission to fix, and disabling a fix does not silence a diagnostic

## Configuration correctness

EditorConfig applies through matching sections and ancestor files. An `[*.cs]` section does **not** apply to `.lgd`; use an intentional `[*.lgd]` or shared matching section. `root = true` belongs before all sections. Later matching properties override earlier ones, `unset` cancels an inherited property, and unknown values must not invent behavior. The standard filename is `.editorconfig`. These rules come from the [EditorConfig documentation](https://editorconfig.org/) and [specification](https://spec.editorconfig.org/).

Source precedence, file matching and individual-rule overrides must be deterministic and inspectable. A style source is not a plugin runtime: importing selected known preferences from `.clang-format`, `.editorconfig` or supported ESLint configuration does not mean every analyzer or plugin executes. ESLint configuration can contain executable code; support must clearly identify statically read forms and must not evaluate JavaScript merely to discover formatting preferences. See [ESLint configuration files](https://eslint.org/docs/latest/use/configure/configuration-files).

Important semantic distinctions:

- IDE0280 concerns `nameof`, not LINQ
- IDE0301 through IDE0306 concern collection expressions; IDE0380 is the unnecessary `unsafe` rule
- Modern .NET naming rules are selected by specificity, not arbitrary first occurrence. `!static` is not a documented `required_modifiers` selector. A more-specific static rule is used when excluding static members

These details are documented in the [.NET style-rule index](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/style-rules/), [IDE0280 reference](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/style-rules/ide0280) and [naming-rule reference](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/style-rules/naming-rules). A .NET diagnostic severity alone does not implement its analyzer in LGD.

## Brace and bracket policy

Curly-brace placement, brace insertion, parentheses and square-bracket spacing are separate choices. A setting called “Allman” must not also imply removal of parentheses or automatic wrapping of every object literal.

### Applicable LGD locations

A granular brace model should distinguish:

- Class, interface and enum declarations, including abstract classes
- Same-name constructor bodies, ordinary methods, getters/setters, standalone and local functions
- Arrow/callback bodies, object methods and static initialization blocks when the parser supports them
- `if`, `else`, `for`, `for-in`, `for-of`, `while`, `do`, `switch`, explicit case blocks, `try`, `catch`, `finally` and standalone blocks
- Object-literal braces independently from block braces; destructuring and named import/export braces independently from object literals
- Closing-brace continuations: `else`, `catch`, `finally` and the `while` in `do ... while`
- Empty bodies separately from nonempty one-line bodies, and body indentation separately from brace indentation

Declaration lists, call arguments, grouping/control parentheses, arrays, indexing and destructuring each need their own spacing/wrapping policy. Class inheritance colons, constructor `: base(...)`, object-property colons, labels and conditional colons must not share a token-wide rule.

### Preset compatibility targets

These native presets are implemented for supported LGD locations. Foreign-language constructs and full upstream preset defaults are outside this projection:

| Preset | LGD interpretation and implementation condition |
| --- | --- |
| Allman | Opening block/declaration braces on the following line; object literals still require expression-safe handling |
| Attach / K&R / 1TBS | Attach opening braces; continuation placement and whether braces are required remain separate settings |
| Stroustrup | Split function-definition braces and else/catch continuations; attach other compatible braces |
| Linux | Split class/function definitions; attach compatible controls; namespaces are absent |
| Mozilla | Split enum/class/function definitions; attach compatible controls |
| WebKit | Split function-definition braces; attach other compatible braces |
| GNU | Requires its distinct control-brace indentation, not just Allman placement |
| Whitesmiths | Requires indented braces and corresponding content alignment; must not be aliased to Allman |
| Custom | Per-location policy; raw clang `BraceWrapping` is active only with `BreakBeforeBraces: Custom` |

An LGD location override may refine its chosen native preset. The external preset importer exposes the compatible core as a partial projection and reports unsupported individual options. Precise raw-clang behaviors and version-specific option forms are in the [clang-format option reference](https://clang.llvm.org/docs/ClangFormatStyleOptions.html). C# location labels likewise need a compatibility map, described by the [C# formatting reference](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/style-rules/csharp-formatting-options).

### Safety requirements

- Formatting must preserve LGD contracts, lexical bindings, evaluation order and literal values
- Moving an object literal after `return` or `throw`, separating `async` from a function/arrow, or moving postfix increments across line breaks can change meaning through automatic semicolon insertion
- Tagged-template raw text, template literal content, regexes, strings, JSX text and comments are not ordinary whitespace
- Adding braces requires syntax-aware statement spans, dangling-else protection and checks for scope-sensitive function declarations. Removing braces requires stronger checks still
- Import/require ordering can change initialization effects. “Sort” must not be applied just because entries look unused
- Semantic preferences use separate opt-in guarded analyzers; they are not blanket whitespace rewrites. See the supported subsets and explicit unsupported cases below
- Never guess a class base, constructor argument, switch arm, return expression, user naming prefix or omitted initializer
- Compare valid parsed/compiled structure before and after proposed formatting, ignoring source locations but retaining semantic content; token equality alone does not detect all line-sensitive changes
- Run idempotence, comments/literals/JSX, source-version, undo, mixed-line-ending, file-scope and conflict tests before declaring a setting supported

## Native option catalog

These are the actual native style choices. Values are under `formatting.options`; option-level fix/severity IDs are under `rules` and begin `lgd.format.`. Explicit native overrides take precedence over imported preferences. Imports are applied in configured source order, low to high; the default order is EditorConfig, clang-format, then ESLint.

| Native option | Accepted values | Native default |
| --- | --- | --- |
| `braces.style` | `attach`, `allman`, `stroustrup`, `linux`, `mozilla`, `webkit`, `gnu`, `whitesmiths`, `custom` | `"allman"` |
| `braces.wrapping.classes` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.interfaces` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.enums` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.constructors` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.methods` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.accessors` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.functions` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.lambdas` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.controlBlocks` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.switchBlocks` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.caseBlocks` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.tryBlocks` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.elseBlocks` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.catchBlocks` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.finallyBlocks` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.objectLiterals` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.wrapping.objectPatterns` | `inherit`, `sameLine`, `nextLine`, `nextLineIndented`, `nextLineIfMultiline` | `"inherit"` |
| `braces.beforeElse` | `true`, `false` | `true` |
| `braces.beforeCatch` | `true`, `false` | `true` |
| `braces.beforeFinally` | `true`, `false` | `true` |
| `braces.beforeWhile` | `true`, `false` | `false` |
| `indentation.style` | `space`, `tab` | `"space"` |
| `indentation.size` | integer 1–16 | `4` |
| `indentation.tabWidth` | integer 1–16 | `4` |
| `indentation.continuation` | integer 0–32 | `4` |
| `indentation.constructorInitializer` | integer 0–32 | `4` |
| `indentation.tabUsage` | `indentation`, `continuation`, `always` | `"always"` |
| `indentation.caseLabels` | `true`, `false` | `true` |
| `indentation.caseContents` | `true`, `false` | `true` |
| `indentation.caseBlocks` | `true`, `false` | `true` |
| `indentation.labels` | `preserve`, `flushLeft`, `oneLess` | `"preserve"` |
| `spacing.afterControlKeywords` | `true`, `false` | `false` |
| `spacing.beforeFunctionParen` | `true`, `false` | `false` |
| `spacing.beforeMethodParen` | `true`, `false` | `false` |
| `spacing.beforeCallParen` | `true`, `false` | `false` |
| `spacing.afterCast` | `true`, `false` | `false` |
| `spacing.insideCastParens` | `true`, `false` | `false` |
| `spacing.insideControlParens` | `true`, `false` | `false` |
| `spacing.insideDeclarationParens` | `true`, `false` | `false` |
| `spacing.insideCallParens` | `true`, `false` | `false` |
| `spacing.insideOtherParens` | `true`, `false` | `false` |
| `spacing.insideEmptyDeclarationParens` | `true`, `false` | `false` |
| `spacing.insideEmptyCallParens` | `true`, `false` | `false` |
| `spacing.beforeInheritanceColon` | `true`, `false` | `true` |
| `spacing.afterInheritanceColon` | `true`, `false` | `true` |
| `spacing.binaryOperators` | `both`, `none`, `preserve` | `"both"` |
| `spacing.beforeAssignment` | `true`, `false` | `true` |
| `spacing.afterAssignment` | `true`, `false` | `true` |
| `spacing.beforeComma` | `true`, `false` | `false` |
| `spacing.afterComma` | `true`, `false` | `true` |
| `spacing.beforeDot` | `true`, `false` | `false` |
| `spacing.afterDot` | `true`, `false` | `false` |
| `spacing.beforeForSemicolon` | `true`, `false` | `false` |
| `spacing.afterForSemicolon` | `true`, `false` | `true` |
| `spacing.beforeSquareBracket` | `true`, `false` | `false` |
| `spacing.insideSquareBrackets` | `true`, `false` | `false` |
| `spacing.insideEmptySquareBrackets` | `true`, `false` | `false` |
| `spacing.declarations` | `normalize`, `preserve` | `"normalize"` |
| `spacing.insideObjectBraces` | `true`, `false` | `true` |
| `spacing.insideEmptyBlockBraces` | `true`, `false` | `true` |
| `spacing.insideEmptyObjectBraces` | `true`, `false` | `false` |
| `lineBreaks.shortBlocks` | `preserve`, `never`, `empty`, `always` | `"never"` |
| `lineBreaks.shortFunctions` | `preserve`, `never`, `empty`, `inline`, `all` | `"empty"` |
| `lineBreaks.shortLambdas` | `preserve`, `never`, `empty`, `inline`, `all` | `"never"` |
| `lineBreaks.shortIfs` | `preserve`, `never`, `withoutElse`, `all` | `"never"` |
| `lineBreaks.shortLoops` | `true`, `false` | `false` |
| `lineBreaks.shortCases` | `true`, `false` | `false` |
| `lineBreaks.embeddedStatementsSameLine` | `true`, `false` | `true` |
| `lineBreaks.preserveSingleLineBlocks` | `true`, `false` | `false` |
| `lineBreaks.preserveSingleLineStatements` | `true`, `false` | `false` |
| `lineBreaks.importGroups` | `preserve`, `origin`, `none` | `"preserve"` |
| `lineBreaks.objectMembers` | `preserve`, `onePerLine`, `singleLine` | `"preserve"` |
| `lineBreaks.separateDefinitions` | `preserve`, `always`, `never` | `"preserve"` |
| `lineBreaks.blankLinesBetweenClosingBraces` | `true`, `false` | `false` |
| `lineBreaks.statementImmediatelyAfterBlock` | `true`, `false` | `true` |
| `lineBreaks.blankLineAfterConstructorColon` | `true`, `false` | `true` |
| `lineBreaks.blankLineAfterConditionalToken` | `true`, `false` | `true` |
| `lineBreaks.blankLineAfterArrow` | `true`, `false` | `true` |
| `lineBreaks.maxEmptyLines` | integer 0–10 | `1` |
| `lineBreaks.emptyLinesAtBlockStart` | `true`, `false` | `false` |
| `lineBreaks.emptyLinesAtBlockEnd` | `true`, `false` | `false` |
| `wrapping.columnLimit` | integer 0–1000 | `120` |
| `wrapping.arguments` | `preserve`, `binPack`, `onePerLine` | `"preserve"` |
| `wrapping.parameters` | `preserve`, `binPack`, `onePerLine` | `"preserve"` |
| `wrapping.alignAfterOpenBracket` | `true`, `false` | `false` |
| `wrapping.allowAllArgumentsOnNextLine` | `true`, `false` | `false` |
| `wrapping.allowAllParametersOnNextLine` | `true`, `false` | `false` |
| `wrapping.binaryOperators` | `preserve`, `before`, `after`, `beforeNonAssignment` | `"preserve"` |
| `wrapping.binaryOperations` | `preserve`, `respectPrecedence`, `onePerLine` | `"preserve"` |
| `wrapping.returnType` | `preserve`, `sameLine`, `nextLine` | `"preserve"` |
| `wrapping.constructorInitializer` | `preserve`, `beforeColon`, `afterColon` | `"preserve"` |
| `whitespace.fileHeader` | text, at most 4096 characters | `""` |
| `whitespace.endOfLine` | `preserve`, `lf`, `crlf`, `cr` | `"preserve"` |
| `whitespace.finalNewline` | `preserve`, `always`, `never` | `"preserve"` |
| `whitespace.trimTrailingWhitespace` | `true`, `false` | `true` |
| `bracesRequired.mode` | `preserve`, `always`, `multiLine` | `"preserve"` |
| `expressions.lambdaBodies` | `preserve`, `always`, `when_on_single_line`, `never` | `"preserve"` |
| `expressions.coalesce` | `preserve`, `prefer` | `"preserve"` |
| `expressions.nullPropagation` | `preserve`, `prefer` | `"preserve"` |
| `expressions.conditionalCall` | `preserve`, `prefer` | `"preserve"` |
| `expressions.booleanSimplification` | `preserve`, `prefer` | `"preserve"` |
| `expressions.compoundAssignment` | `preserve`, `prefer` | `"preserve"` |
| `expressions.inferredMemberNames` | `preserve`, `prefer` | `"preserve"` |
| `expressions.conditionalReturn` | `preserve`, `prefer` | `"preserve"` |
| `expressions.conditionalAssignment` | `preserve`, `prefer` | `"preserve"` |
| `expressions.interpolation` | `preserve`, `prefer` | `"preserve"` |
| `expressions.parenthesesArithmetic` | `preserve`, `always_for_clarity`, `never_if_unnecessary` | `"preserve"` |
| `expressions.parenthesesRelational` | `preserve`, `always_for_clarity`, `never_if_unnecessary` | `"preserve"` |
| `expressions.parenthesesOtherBinary` | `preserve`, `always_for_clarity`, `never_if_unnecessary` | `"preserve"` |
| `expressions.parenthesesOther` | `preserve`, `always_for_clarity`, `never_if_unnecessary` | `"preserve"` |
| `declarations.modifierOrder` | object mapping supported modifiers to integer ranks 0–100 | `{}` |
| `declarations.accessibility` | `preserve`, `always`, `for_non_interface_members` | `"preserve"` |
| `declarations.localTypes` | `preserve`, `explicit`, `inferred` | `"preserve"` |
| `cleanup.unusedLocals` | `preserve`, `remove` | `"preserve"` |
| `cleanup.unreachableStatements` | `preserve`, `remove` | `"preserve"` |

A brace-location override uses policy ID `lgd.format.braces.<location>`; other option IDs use `lgd.format.<group>.<option>`. `inherit` uses the selected preset. `nextLineIfMultiline` responds to a multiline header. Function/loop/lambda compaction, empty-body spacing and brace placement remain separate choices; the explicit preserve-single-line umbrella retains existing compact bodies without forcing multiline bodies to collapse.

Width and indentation settings are bounded intentionally. A documented limit does not permit token changes, comment reflow, literal rewriting, or conversion of unsupported grammar. Native `indentation.tabUsage` selects leading-indent/continuation behavior; it is not a full clang cost-model/alignment implementation.

## Guarded semantic styles and limits

The registered declaration and expression preferences are opt-in. Each family and
leaf rule uses the same independent severity and off/manual/automatic fix policy as
layout. Importing a style preference never grants automatic-edit permission.

- Declaration support: explicit modifier ordering, public default insertion on class
  members, and explicit/inferred types on immutable primitive-literal const bindings
- Expression support: the narrowly guarded null/coalescing, optional access/call,
  Boolean coercion, local compound/conditional assignment, conditional return,
  object shorthand, primitive interpolation and parentheses transformations described
  in [Guarded expression styles](lgd-expression-styles.md)
- Arrow bodies: reversible single-value-return/concise expression conversion with
  comments, directives, compiler diagnostics and type contracts preserved
- Cleanup support: explicit opt-in removal of an unused primitive-literal const
  in a function-local block, or an unreachable expression after an immediate
  same-block terminator; declarations, comments and dynamic-scope cases stay intact
- Redundant casts: a separate native quick fix for exact same-type local const
  reference assertions; numeric conversions are never removed by this rule

Unsupported cases are deliberate proof limits, not hidden blanket implementations:

- No private-member/field deletion, parameter deletion, cross-file renaming,
  import/type qualification or guessed switch-case bodies
- No readonly-field inference or this/member qualification without complete writes,
  shadowing, receiver and dynamic-access proof
- No mutable/object/nonliteral general type elision, typed lambda parameter erasure,
  or declaration reshaping that changes a static contract
- No local-function or method-group conversion that could change hoisting, lexical
  this/arguments, wrapper arity, function identity or capture time
- No tuple/destructuring swap or object-initializer synthesis that could alter
  iterators, getters/setters, object identity or evaluation order
- No C#-only syntax, engine-specific analyzer execution, arbitrary ESLint plugins,
  or optimizer-penalty emulation

VS Code EOL changes use a native atomic document operation, not ordinary text replacements. They are withheld when protected text or a partial approved plan prevents exact global conversion. A supported option can intentionally produce no edit for an unsafe source form.
The compatibility table describes both the imported key and its implemented subset;
a related native action does not imply every foreign diagnostic alias is supported.

## External option compatibility

For compatible C#/dotnet-style properties, a suffix such as `:warning` is severity metadata. Such suffixes are not valid on standard EditorConfig properties such as indent_style. Some upstream values have changed across releases; the adapter must state its accepted versioned subset and reject unsupported shapes conservatively.

### EditorConfig scope and universal properties

| Property | Status | Mapping and limitations |
| --- | --- | --- |
| `root` | Supported | Supported discovery boundary when in the preamble. A root setting inside a section is reported and ignored; place it before all sections. |
| `tab_width` | Supported | Maps to indentation.tabWidth; supported widths 1–16. Integer indent_size supplies the default when tab_width is absent. |
| `indent_size` | Supported | Maps to indentation.size, with inherited tab_width or explicit integer resolution. Supported widths 1–16; indent_size=tab needs tab_width supplied to this importer, otherwise it reports the unresolved editor fallback. |
| `indent_style` | Supported | Maps space/tab to indentation.style. Tab conversion respects tabWidth and fills a partial final tab stop with spaces. |
| `end_of_line` | Partial | Core supports lf/crlf/cr in editable whitespace. VS Code changes document EOL only for LF/CRLF and only when global normalization exactly equals the approved complete preview. Protected multiline text or partial-rule edits can prevent conversion; the adapter does not silently rewrite them. |
| `insert_final_newline` | Supported | Maps true/false to whitespace.finalNewline=always/never. Empty files remain empty; disabled regions and line-sensitive syntax remain protected. |

### Explicit .NET diagnostic severities

| Property | Status | Mapping and limitations |
| --- | --- | --- |
| `dotnet_diagnostic.IDE0055.severity` | Supported | Maps warning/error/none/off to native formatting group severities; never authorizes fixes or changes compiler diagnostics. suggestion/silent are reported unsupported instead of silently escalated. |
| `dotnet_diagnostic.IDE0001.severity` | Unsupported | Type-name qualification simplification requires resolved identities and shadowing checks. |
| `dotnet_diagnostic.IDE0002.severity` | Unsupported | Member-name qualification simplification requires binding and receiver proof. |
| `dotnet_diagnostic.IDE0004.severity` | Partial | Severity maps only to the checker-proven redundant-reference-cast style warning. Native unnecessary-reference-cast severity overrides it; none/off suppresses this finding, warning/error changes presentation. The exact same-type local const assertion fix remains manual by default with separate automatic opt-in. Numeric conversion and incompatible-cast errors are unaffected. |
| `dotnet_diagnostic.IDE1006.severity` | Unsupported | Project naming conventions are not imported as universal defaults. Cross-file or dynamic-reference renaming needs an explicit naming policy and complete binding/reference proof. |
| `dotnet_diagnostic.IDE0010.severity` | Unsupported | Exhaustive-enum diagnostics and safe fixes are not implemented. The assistant cannot invent missing case bodies, default behavior or exception policy. |
| `dotnet_diagnostic.IDE0035.severity` | Partial | Maps severity only to cleanup.unreachableStatements; removal still requires explicit native remove preference and independent fix permission. Handles only original-source expression statements after immediate same-block return/throw/break/continue, excluding declarations, labels, comments, nested structures and await/yield/function/class-sensitive expressions. |
| `dotnet_diagnostic.IDE0049.severity` | Not applicable | C# predefined-type aliases do not map to LGD Number/String/Boolean identities. |
| `dotnet_diagnostic.IDE0029.severity` | Unsupported | Null-check/coalescing rewrite needs LGD null/undefined and evaluation-count proof. |
| `dotnet_diagnostic.IDE0030.severity` | Unsupported | Null-check/coalescing rewrite needs LGD null/undefined and evaluation-count proof. |
| `dotnet_diagnostic.IDE0270.severity` | Unsupported | A further null-check simplification; same LGD semantic constraints as IDE0029/IDE0030. |
| `dotnet_diagnostic.IDE0090.severity` | Not applicable | C# target-typed new(...) is not LGD construction syntax. |
| `dotnet_diagnostic.IDE0005.severity` | Not applicable | C# using directives are absent. Removing LGD imports/requires is a separate effect-aware analysis. |
| `dotnet_diagnostic.IDE0003.severity` | Unsupported | Removing this qualification needs LGD binding/shadowing proof. |
| `dotnet_diagnostic.IDE0009.severity` | Unsupported | Adding this qualification needs LGD receiver/static-member proof. |
| `dotnet_diagnostic.IDE0059.severity` | Unsupported | Unused assignment removal must preserve initializer effects and lexical declarations. |
| `dotnet_diagnostic.IDE0051.severity` | Unsupported | LGD private members are supported; unused-member removal still requires resolved references, contract analysis and protection against dynamic callers. |
| `dotnet_diagnostic.IDE0052.severity` | Unsupported | LGD private fields are supported; unread-member removal needs complete read/write and initializer-effect analysis, including aliases. |
| `dotnet_diagnostic.IDE0050.severity` | Not applicable | C# anonymous-type-to-tuple transformation; LGD does not model those C# type forms. |
| `dotnet_diagnostic.IDE0054.severity` | Unsupported | Compound assignments can change getter/setter calls and computed-key evaluations. |
| `dotnet_diagnostic.IDE0074.severity` | Unsupported | Null-coalescing assignment changes evaluation and must distinguish null from undefined correctly. |
| `dotnet_diagnostic.IDE0060.severity` | Unsupported | Unused-parameter diagnostics are plausible; signature edits require caller/default/contract proof. Existing explicit parameter actions are not this adapter. |
| `dotnet_diagnostic.IDE0079.severity` | Not applicable | Roslyn suppression cleanup does not control LGD or ESLint suppression directives. |
| `dotnet_diagnostic.IDE0080.severity` | Not applicable | C# null-forgiving postfix ! is absent; LGD logical negation must never be treated as suppression. |
| `dotnet_diagnostic.IDE0082.severity` | Not applicable | C# typeof-to-nameof transformation; LGD JavaScript typeof has different meaning and no nameof counterpart. |
| `dotnet_diagnostic.IDE0070.severity` | Not applicable | System.HashCode.Combine is a .NET-specific API and transformation. |
| `dotnet_diagnostic.IDE0072.severity` | Not applicable | C# switch expressions are not LGD switch statements. |
| `dotnet_diagnostic.IDE0073.severity` | Partial | Maps to whitespace.fileHeader severity. A header is inserted only when explicit native fileHeader text or file_header_template is configured; never invents project/legal text. Existing license comments remain intact. A silent severity has no exact warning/error/off counterpart and is reported. |
| `dotnet_diagnostic.IDE0076.severity` | Not applicable | C# SuppressMessageAttribute validation requires Roslyn attributes and assembly metadata. |
| `dotnet_diagnostic.IDE0077.severity` | Not applicable | C# global SuppressMessageAttribute target migration has no LGD equivalent. |
| `dotnet_diagnostic.IDE0100.severity` | Unsupported | Boolean-comparison reduction requires a proven Boolean; JavaScript truthiness is not equivalent. |
| `dotnet_diagnostic.IDE0110.severity` | Not applicable | C# discard removal; underscore is an ordinary JavaScript/LGD binding unless explicitly declared otherwise. |
| `dotnet_diagnostic.IDE0120.severity` | Not applicable | LINQ-specific rewriting needs .NET extension-method semantics absent from LGD. |
| `dotnet_diagnostic.IDE0121.severity` | Not applicable | LINQ type-filter/cast rewriting is .NET-specific. |
| `dotnet_diagnostic.IDE0280.severity` | Not applicable | This is a nameof rule, not the LINQ rule described in the pasted comment; LGD has no nameof construct. |
| `dotnet_diagnostic.IDE0301.severity` | Not applicable | C# collection-expression replacement for empty collections; not unsafe-modifier removal. |
| `dotnet_diagnostic.IDE0302.severity` | Not applicable | C# collection-expression replacement for stackalloc; not unsafe-modifier removal. |
| `dotnet_diagnostic.IDE0303.severity` | Not applicable | C# collection-expression replacement for Create calls; not unsafe-modifier removal. |
| `dotnet_diagnostic.IDE0304.severity` | Not applicable | C# collection-expression replacement for builders; not unsafe-modifier removal. |
| `dotnet_diagnostic.IDE0305.severity` | Not applicable | C# collection-expression replacement for fluent construction; not unsafe-modifier removal. |
| `dotnet_diagnostic.IDE0306.severity` | Not applicable | C# collection-expression replacement for new; not unsafe-modifier removal. |
| `dotnet_diagnostic.IDE0380.severity` | Not applicable | This is the unnecessary unsafe-modifier rule; LGD has no unsafe modifier. |

| `dotnet_style_coalesce_expression` | Partial | Maps to expressions.coalesce. Collapses a conditional checking the same lexical local against both null and void 0. Rejects loose/single-null checks, globals, repeated property getters and dynamic lookup. |
| `csharp_style_implicit_object_creation_when_type_is_apparent` | Not applicable | C# target-typed new(...) has no equivalent LGD syntax; do not remove the explicit constructor identity. |
| `dotnet_style_qualification_for_property` | Unsupported | Adding this requires a resolved instance member and shadowing/static-receiver proof. |
| `dotnet_style_qualification_for_event` | Not applicable | C# event declarations are not LGD syntax; ordinary callback properties are not events. |
| `dotnet_style_qualification_for_field` | Unsupported | Removing this requires binding and shadowing proof; it can change JavaScript identifier lookup. |
| `dotnet_style_qualification_for_method` | Unsupported | Removing this can alter receiver binding and lookup; requires resolved method-call semantics. |

### Using-directive preferences

| Property | Status | Mapping and limitations |
| --- | --- | --- |
| `dotnet_sort_system_directives_first` | Not applicable | No C# using/System directive ordering in LGD. Reordering require/import evaluation can have effects. |
| `dotnet_separate_import_directive_groups` | Partial | Maps true to lineBreaks.importGroups=origin and false to none. Adds/removes blank lines between adjacent top-level ESM imports or literal require statements as relative/external groups without reordering. Does not synthesize C# System/using grouping. |
| `csharp_using_directive_placement` | Not applicable | LGD has no C# namespaces or using-directive placement. |

### Spacing preferences

| Property | Status | Mapping and limitations |
| --- | --- | --- |
| `csharp_space_after_keywords_in_control_flow_statements` | Supported | Whitespace before a control-flow opening parenthesis; true/false can map to LGD control spacing. |
| `csharp_space_after_cast` | Supported | Maps to spacing.afterCast using compiler-recognized C-style LGD casts; numeric conversion and reference assertion semantics remain unchanged. |
| `csharp_space_between_parentheses` | Supported | Maps false or a comma list of control_flow_statements/expressions/type_casts to independent LGD spacing contexts. Calls and declarations remain separate. |
| `csharp_space_before_colon_in_inheritance_clause` | Supported | Whitespace before a class/interface base-list colon; do not apply to object properties, labels or ternaries. |
| `csharp_space_after_colon_in_inheritance_clause` | Supported | Whitespace after a class/interface base-list colon, independently configurable. |
| `csharp_space_around_binary_operators` | Supported | Choices before_and_after/none/ignore for LGD binary operators; preserve required lexical separators and distinguish unary operators. |
| `csharp_space_between_method_declaration_parameter_list_parentheses` | Supported | Nonempty declaration parameter delimiters; independent of calls and empty declarations. |
| `csharp_space_between_method_declaration_empty_parameter_list_parentheses` | Supported | Empty declaration parameter delimiters only. |
| `csharp_space_between_method_declaration_name_and_open_parenthesis` | Supported | Declaration name-to-parenthesis spacing; include LGD same-name constructors. |
| `csharp_space_between_method_call_parameter_list_parentheses` | Supported | Nonempty call argument delimiters; preserve nested expressions. |
| `csharp_space_between_method_call_empty_parameter_list_parentheses` | Supported | Empty call argument delimiters only. |
| `csharp_space_between_method_call_name_and_open_parenthesis` | Supported | Call name-to-parenthesis spacing; handle optional calls and new expressions conservatively. |
| `csharp_space_after_comma` | Supported | Comma spacing in syntax-recognized lists; never string/regex/template content. |
| `csharp_space_before_comma` | Supported | Whitespace preceding list commas; comment/newline ownership must be preserved. |
| `csharp_space_after_dot` | Supported | Member-access token spacing; preserve numeric literal and optional-chain tokenization. |
| `csharp_space_before_dot` | Supported | Member-access token spacing; not decimal points or spread tokens. |
| `csharp_space_after_semicolon_in_for_statement` | Supported | Only for-loop header separator spacing; not statement line breaks. |
| `csharp_space_before_semicolon_in_for_statement` | Supported | Only for-loop header separator spacing; independent from normal statement semicolons. |
| `csharp_space_around_declaration_statements` | Supported | false normalizes exact parsed const/type, type/name, plain binding/name and field type/name boundaries plus supported assignment/comma gaps; ignore preserves alignment. Newline/indentation/comment boundaries and type punctuation remain intact; invalid or unsupported type spellings are not rewritten. |
| `csharp_space_before_open_square_brackets` | Supported | Maps to LGD beforeSquareBracket spacing. Required token boundaries are retained; this does not introduce C# array/rank syntax. |
| `csharp_space_between_empty_square_brackets` | Supported | Empty LGD array/type brackets where syntax allows; preserve literal values and distinguish destructuring. |
| `csharp_space_between_square_brackets` | Supported | Nonempty bracket padding; distinguish indexing, arrays and destructuring. |

### Line breaks, indentation, wrapping, modifiers and braces

| Property | Status | Mapping and limitations |
| --- | --- | --- |
| `csharp_new_line_before_open_brace` | Supported | Maps all/none or supported location lists to native per-location wrapping. Supported list tokens: types, methods, local_functions, accessors, lambdas, anonymous_methods, control_blocks, object_collection_array_initializers. Destructuring is not forced; unsupported C# locations are reported. |
| `csharp_new_line_before_else` | Supported | Independent placement of else after a closing brace. |
| `csharp_new_line_before_catch` | Supported | Independent placement of catch after a closing brace. |
| `csharp_new_line_before_finally` | Supported | Independent placement of finally after a closing brace. |
| `csharp_new_line_before_members_in_object_initializers` | Supported | Maps true/false to LGD object-literal member layout onePerLine/singleLine. This controls existing LGD literals; it does not add C# object-initializer syntax. |
| `csharp_new_line_before_members_in_anonymous_types` | Not applicable | LGD has object literals, not C# anonymous-type constructions; do not alias two distinct upstream constructs silently. |
| `csharp_indent_labels` | Supported | Maps no_change/flush_left/one_less_than_current to preserve/flushLeft/oneLess. Preserve retains existing indentation bytes, including hard tabs. |
| `csharp_indent_case_contents` | Supported | Switch case statement indentation, separate from label and brace indentation. |
| `csharp_indent_case_contents_when_block` | Supported | Indentation of explicit case blocks independently from unbraced case contents. |
| `csharp_preserve_single_line_statements` | Supported | Maps to lineBreaks.preserveSingleLineStatements. The formatter distinguishes statement separators from for-header semicolons and preserves line-sensitive syntax. |
| `csharp_preserve_single_line_blocks` | Supported | Maps to lineBreaks.preserveSingleLineBlocks. Existing single-line blocks are preserved when true; this does not authorize compacting all multiline blocks. |
| `csharp_preferred_modifier_order` | Partial | Maps supported LGD modifier names to declarations.modifierOrder ranks. Reorders only complete contiguous lists; comments and unspecified modifiers are barriers. Foreign modifiers are never inserted. |
| `csharp_prefer_braces` | Supported | Maps true/false/when_multiline to always/preserve/multiLine, with independent severity. Insertion is limited to proven safe expression/return/throw/break/continue/empty bodies; declaration/Annex-B/scope-sensitive bodies are withheld. false does not remove braces. |

### Type and expression preferences

| Property | Status | Mapping and limitations |
| --- | --- | --- |
| `csharp_style_var_for_locals` | Not applicable | This key is not a standard documented C# var preference. LGD uses explicit typed declarations; do not guess an alias. |
| `csharp_style_var_when_type_is_apparent` | Unsupported | An LGD explicit/inferred-type preference is possible only with stable inferred type/nullable contracts; C# var is not JavaScript var. |
| `csharp_style_var_elsewhere` | Unsupported | Requires a dedicated LGD typed-declaration policy; never change block-scoped bindings into JavaScript var. |
| `csharp_style_var_for_built_in_types` | Partial | Maps to declarations.localTypes explicit/inferred for immutable primitive-literal const bindings only. Rejects mutable/nonliteral/object/exported declarations, authored type comments and shadowed primitive names; never introduces JavaScript var. |
| `csharp_style_deconstructed_variable_declaration` | Unsupported | Destructuring may be available but C# tuple deconstruction is not identical; evaluate iteration, getters and binding scope. |
| `dotnet_style_readonly_field` | Unsupported | LGD readonly fields exist; conversion needs verified writes across constructors, aliases and dynamic code. |
| `csharp_style_throw_expression` | Not applicable | LGD/JavaScript has throw statements, not C# throw expressions. |
| `csharp_style_inlined_variable_declaration` | Not applicable | C# out-variable declaration syntax does not exist in LGD. |
| `csharp_style_prefer_local_over_anonymous_function` | Unsupported | Function declarations versus expressions affect hoisting, capture, this and recursion; no mechanical style rewrite. |
| `csharp_prefer_simple_default_expression` | Not applicable | C# default(T)/target-typed default expressions do not exist in LGD. |
| `dotnet_style_prefer_collection_expression` | Not applicable | LGD arrays are not C# collection-expression target conversions; the configured C# type-match option is not an LGD rule. |
| `dotnet_style_object_initializer` | Unsupported | LGD literal or constructor-assignment rewrites require getter/setter, allocation, evaluation-order and escape proof; C# object-initializer syntax itself is absent. |
| `dotnet_style_explicit_tuple_names` | Not applicable | LGD does not have C# named tuple element metadata. |
| `dotnet_style_null_propagation` | Partial | Maps to expressions.nullPropagation. Exact dual null/void-0 checks of a local with undefined fallback become optional property/index access; a value-producing sequence preserves receiver/delete semantics. No getter duplication or null fallback change. |
| `dotnet_style_predefined_type_for_locals_parameters_members` | Not applicable | C# built-in keyword aliases are not LGD capitalized type identities. |
| `dotnet_style_predefined_type_for_member_access` | Not applicable | C# alias member access has no compatible LGD type-alias transformation. |
| `dotnet_style_prefer_auto_properties` | Not applicable | LGD contract accessors are not C# runtime auto-properties and must not be converted into them. |
| `dotnet_style_prefer_inferred_tuple_names` | Not applicable | LGD does not model C# tuple names. |
| `dotnet_style_prefer_inferred_anonymous_type_member_names` | Partial | Maps to expressions.inferredMemberNames for plain object-literal name:name shorthand. Excludes destructuring, computed keys and __proto__; no C# anonymous-type syntax is created. |
| `dotnet_style_prefer_is_null_check_over_reference_equality_method` | Not applicable | C# is-null patterns and ReferenceEquals are not LGD primitives; no replacement of arbitrary equality helpers. |
| `dotnet_style_prefer_conditional_expression_over_assignment` | Partial | Maps to expressions.conditionalAssignment for plain assignments to the same lexical local. Rejects member targets, dynamic lookup and anonymous values with assignment-inferred names. |
| `dotnet_style_prefer_conditional_expression_over_return` | Partial | Maps to expressions.conditionalReturn for two single value-return branches, preserving evaluation order. Comments, declarations and extra statements are barriers. |
| `dotnet_style_parentheses_in_arithmetic_binary_operators` | Partial | Maps to expressions.parenthesesArithmetic. Adds clarity around mixed nested operators; removal requires complete normalized AST identity, preserving precedence and directives. |
| `dotnet_style_parentheses_in_relational_binary_operators` | Partial | Maps to expressions.parenthesesRelational with separate comparison/equality grouping. Removal must preserve the complete parsed semantics. |
| `dotnet_style_parentheses_in_other_binary_operators` | Partial | Maps to expressions.parenthesesOtherBinary for logical/bitwise operators. Required nullish/logical grouping and optional-chain boundaries remain protected. |
| `dotnet_style_parentheses_in_other_operators` | Partial | Maps to expressions.parenthesesOther. Unnecessary grouping is removed only with identical parsed semantics; atomic expressions are not arbitrarily parenthesized. |
| `dotnet_style_require_accessibility_modifiers` | Partial | always/for_non_interface_members map to explicit public defaults on class members only. Does not remove visibility, change interface contracts, or infer C# defaults. |
| `dotnet_style_prefer_compound_assignment` | Partial | Maps to expressions.compoundAssignment for stable local identifiers only. Nullish assignment additionally requires a writable binding and no anonymous fallback name-inference change. Member/computed targets remain unchanged. |
| `dotnet_style_prefer_simplified_interpolation` | Partial | Maps to expressions.interpolation for primitive literal substitutions in untagged templates, with template syntax escaped. Tagged templates, custom conversion calls and nonliteral substitutions remain unchanged. |
| `dotnet_style_prefer_simplified_boolean_expressions` | Partial | Maps to expressions.booleanSimplification. Opposite Boolean-literal ternary branches become explicit Boolean coercion, preserving JavaScript truthiness. General Boolean identities are not inferred. |
| `dotnet_style_namespace_match_folder` | Not applicable | LGD has no C# namespace declarations. |
| `dotnet_style_prefer_foreach_explicit_cast_in_source` | Not applicable | C# foreach casts are not LGD for-of semantics. |
| `csharp_style_unused_value_expression_statement_preference` | Unsupported | Effectful expressions cannot be discarded mechanically; C# discard_variable must not synthesize an LGD underscore variable. |
| `csharp_style_unused_value_assignment_preference` | Unsupported | Preserve right-hand effects and evaluation order; C# discard is not an LGD built-in. |
| `csharp_style_prefer_index_operator` | Not applicable | C# from-end ^ indexing differs from JavaScript/LGD bitwise XOR and array access. |
| `csharp_style_prefer_range_operator` | Not applicable | C# range operator is not LGD syntax; array slicing is not an automatic substitute. |
| `csharp_style_prefer_tuple_swap` | Unsupported | JavaScript destructuring swap can differ for getters/computed lvalues and iteration; only proven local targets could be eligible.  |
| `csharp_style_prefer_method_group_conversion` | Unsupported | The last matching property value wins. Removing wrapper callbacks changes this binding and arity; no C# delegate conversion assumption. |
| `csharp_style_prefer_utf8_string_literals` | Not applicable | C# u8 literals are byte spans; LGD strings are JavaScript strings and not a substitute. |
| `csharp_style_prefer_primary_constructors` | Not applicable | LGD uses class-name constructors and has no C# primary-constructor form. |
| `csharp_prefer_system_threading_lock` | Not applicable | System.Threading.Lock/C# lock have no LGD runtime equivalent. |
| `csharp_style_prefer_implicitly_typed_lambda_expression` | Unsupported | Parameter type removal can change LGD checking; confirm supported arrow syntax and inferred contracts before offering a semantic fix. |
| `csharp_style_prefer_simple_property_accessors` | Not applicable | C# simple/field-backed property accessors are not LGD contract or JavaScript accessor syntax. |
| `csharp_style_conditional_delegate_call` | Partial | Maps to expressions.conditionalCall for a local delegate call guarded against both null and void 0. Member receivers, globals and loose checks remain unchanged. |
| `csharp_style_prefer_readonly_struct` | Not applicable | LGD has no struct declaration/value semantics. |
| `csharp_style_prefer_readonly_struct_member` | Not applicable | LGD has no C# struct member readonly semantics. |
| `csharp_prefer_static_anonymous_function` | Not applicable | C# static anonymous functions are not JavaScript/LGD functions. |
| `csharp_prefer_static_local_function` | Not applicable | C# static local-function syntax is not LGD syntax. |
| `csharp_prefer_simple_using_statement` | Not applicable | C# resource-using statements are absent; do not approximate resource lifetime. |
| `csharp_style_prefer_switch_expression` | Not applicable | C# switch expressions are not part of LGD. |
| `csharp_style_namespace_declarations` | Not applicable | No LGD namespace declaration, block-scoped or file-scoped. |
| `csharp_style_prefer_null_check_over_type_check` | Unsupported | An LGD guard simplification requires proven operand types and null/undefined semantics; do not import C# pattern syntax. |
| `csharp_style_prefer_top_level_statements` | Not applicable | LGD already permits top-level statements and has no C# Program.Main conversion. |

### Experimental whitespace preferences

| Property | Status | Mapping and limitations |
| --- | --- | --- |
| `dotnet_style_allow_multiple_blank_lines_experimental` | Supported | A false value maps to maxEmptyLines=1. true/unlimited is not represented by the bounded native option and is reported unsupported. |
| `csharp_style_allow_embedded_statements_on_same_line_experimental` | Supported | Maps to lineBreaks.embeddedStatementsSameLine. false separates and indents parsed unbraced controls even when a short-if/loop policy otherwise permits compaction; true permits those independent short-body policies. |
| `csharp_style_allow_blank_lines_between_consecutive_braces_experimental` | Supported | Maps to lineBreaks.blankLinesBetweenClosingBraces. Preserves or removes existing blank lines only between recognized closing code blocks, leaving comments untouched. |
| `dotnet_style_allow_statement_immediately_after_block_experimental` | Supported | Maps to lineBreaks.statementImmediatelyAfterBlock. false requires a blank line before the next parsed statement, excluding actual else/catch/finally/do-while continuations. |
| `csharp_style_allow_blank_line_after_colon_in_constructor_initializer_experimental` | Supported | Maps to lineBreaks.blankLineAfterConstructorColon for LGD : base(...). false limits a pure whitespace gap after the parsed constructor colon to one newline. |
| `csharp_style_allow_blank_line_after_token_in_conditional_expression_experimental` | Supported | Maps to lineBreaks.blankLineAfterConditionalToken. false removes extra blank lines after parsed conditional ? and : tokens; object keys and nullable type markers are untouched. |
| `csharp_style_allow_blank_line_after_arrow_expression_clause_experimental` | Partial | Maps to lineBreaks.blankLineAfterArrow for LGD/JavaScript =>. false removes extra blank lines after the arrow token. No C# expression-bodied member syntax is synthesized. |

### Pattern-matching preferences

| Property | Status | Mapping and limitations |
| --- | --- | --- |
| `csharp_style_prefer_pattern_matching` | Not applicable | C# pattern matching is not LGD syntax. |
| `csharp_style_prefer_not_pattern` | Not applicable | C# not patterns are not LGD syntax. |
| `csharp_style_prefer_extended_property_pattern` | Not applicable | C# property patterns are not LGD object destructuring. |
| `csharp_style_pattern_matching_over_as_with_null_check` | Not applicable | C# as casts and associated patterns are absent. |
| `csharp_style_pattern_matching_over_is_with_cast_check` | Not applicable | C# is-pattern cast transformation is absent. |

### Expression-bodied member preferences

| Property | Status | Mapping and limitations |
| --- | --- | --- |
| `csharp_style_expression_bodied_lambdas` | Partial | Maps true/false/when_on_single_line to expressions.lambdaBodies always/never/when_on_single_line. Converts exact mapped arrows between a concise expression and one value-return block. Rejects directives/comments, extra statements, missing values, compiler errors and unmapped typed arrow ranges. Whole runtime AST and declared contracts must remain equivalent. |
| `csharp_style_expression_bodied_local_functions` | Not applicable | C# expression-bodied local-function syntax is not LGD function syntax. |
| `csharp_style_expression_bodied_methods` | Not applicable | LGD methods do not use C# expression-bodied member clauses. |
| `csharp_style_expression_bodied_indexers` | Not applicable | LGD has no C# indexer declaration syntax. |
| `csharp_style_expression_bodied_properties` | Not applicable | LGD properties/contracts do not use C# expression bodies. |
| `csharp_style_expression_bodied_accessors` | Not applicable | LGD accessors use method-style bodies, not C# accessor expression clauses. |
| `csharp_style_expression_bodied_operators` | Not applicable | LGD has no C# operator-overload declarations. |
| `csharp_style_expression_bodied_constructors` | Not applicable | LGD constructors require their supported block syntax and cannot return; no C# expression-bodied constructor form. |

### Code-quality preferences

| Property | Status | Mapping and limitations |
| --- | --- | --- |
| `dotnet_code_quality_unused_parameters` | Unsupported | all/non_public intent needs an LGD visibility/call-graph policy. Removing parameters can alter contracts/default effects. |
| `dotnet_diagnostic.CA1851.severity` | Not applicable | .NET IEnumerable multi-enumeration analysis depends on .NET APIs absent from LGD. |
| `dotnet_diagnostic.CS8765.severity` | Not applicable | A C# compiler nullable-override diagnostic ID, not an LGD diagnostic selector. LGD contract diagnostics keep their own IDs. |

### Project-specific configuration

Project-defined naming styles, naming-rule identifiers, engine-specific analyzers and third-party diagnostic selectors are not language defaults. They are intentionally excluded from this compatibility catalog; the importer does not execute foreign analyzers or apply project-specific naming conventions.

### clang-format

| Property | Status | Mapping and limitations |
| --- | --- | --- |
| `BasedOnStyle` | Partial | Partial preset projection: LLVM/Google/Chromium/Mozilla/WebKit/Microsoft/GNU provide native indentation, soft width, brace style and control-parenthesis defaults. Remaining settings retain LGD defaults; this is not a complete clang preset. InheritParentConfig is supported for source layering. |
| `ColumnLimit` | Partial | Supported 0–1000 as a soft layout limit for argument/parameter wrapping, configured binary-expression wrapping and short-body eligibility; 0 removes new width-driven breaks. Does not reflow arbitrary strings/comments or guarantee every line fits. |
| `UseTab` | Partial | ForIndentation maps to tab indentation with space-based continuations/alignment. Never, ForContinuationAndIndentation, AlignWithSpaces and Always are accepted projections onto native tabUsage choices. Their full upstream intra-line/leading-alignment distinctions are not all reproduced; use explicit native controls for the supported subset. |
| `TabWidth` | Supported | Display columns per tab, independent from IndentWidth. |
| `IndentWidth` | Supported | LGD block indentation columns. |
| `ContinuationIndentWidth` | Supported | Continuation indentation, independent of nesting and parameter alignment. |
| `AlignAfterOpenBracket` | Partial | Align/DontAlign map to alignment of supported parenthesized continuations. Other clang layout modes and every non-parenthesis bracket context are not implemented. |
| `NamespaceIndentation` | Not applicable | LGD has no namespace block syntax. |
| `AccessModifierOffset` | Not applicable | C++ access-label indentation has no LGD counterpart. LGD inline public/private/protected/internal modifiers are not C++ public: sections. |
| `IndentCaseLabels` | Supported | Switch case-label indentation; independent from case bodies. |
| `IndentPPDirectives` | Not applicable | LGD has no C/C++ preprocessor directive grammar. |
| `BreakBeforeBraces` | Supported | Maps Attach/Allman/Stroustrup/Linux/Mozilla/WebKit/GNU/Whitesmiths/Custom to native LGD brace locations. Literal/ASI protection and explicit location overrides still apply. C++ namespaces/records not in LGD are not created. |
| `InsertBraces` | Supported | Maps true/false to native always/preserve. Only proven safe statement bodies are wrapped; comments, lexical declarations, Annex-B functions and unsupported source spans remain unchanged. |
| `AllowShortBlocksOnASingleLine` | Supported | Maps Never/Empty/Always to native shortBlocks; function/lambda/if/loop options remain separately selectable. No automatic brace removal. |
| `AllowShortIfStatementsOnASingleLine` | Supported | Maps Never/WithoutElse/AllIfsAndElse to native conditional layout. OnlyFirstIf is not aliased to WithoutElse and is reported unsupported. |
| `AllowShortLoopsOnASingleLine` | Supported | Loop compaction with comments and lexical-scope safety preserved. |
| `AllowShortLambdasOnASingleLine` | Supported | Maps None/Empty/Inline/All to native arrow/callback block policy; Inline is limited to AST-recognized argument contexts. Literals/comments and scope remain intact. |
| `AllowShortCaseLabelsOnASingleLine` | Supported | Case-label/body line placement, not adding or removing switch cases. |
| `AllowShortFunctionsOnASingleLine` | Supported | Maps None/Empty/Inline/All to the implemented LGD function/method policy. InlineOnly is not represented; C++ in-class/header distinctions are not assumed. |
| `SpaceInEmptyBraces` | Supported | Always/Block/Never policies; distinguish declaration/control bodies from object literals and destructuring. |
| `SpaceBeforeParens` | Supported | Parenthesis spacing policy; declaration, call, control and anonymous function cases need separate settings. |
| `SpacesInParentheses` | Supported | Legacy clang spelling; map only compatible LGD parentheses and retain independent empty/call/declaration controls. |
| `SpaceBeforeAssignmentOperators` | Supported | Whitespace before assignment tokens; does not by itself specify the whitespace after them. |
| `DerivePointerAlignment` | Not applicable | LGD has no pointer declarator grammar. |
| `PointerAlignment` | Not applicable | LGD has no C++ pointer declarations; do not treat multiplication as a pointer. |
| `ReferenceAlignment` | Not applicable | LGD has no C++ reference declarators; do not treat bitwise/logical operators as references. |
| `BinPackArguments` | Supported | One argument per wrapped line, independently from declarations; preserve comments and spreads. |
| `BinPackParameters` | Supported | One parameter per wrapped line, independently from call arguments and typed syntax. |
| `AllowAllArgumentsOnNextLine` | Supported | Wrapped call layout policy; distinct from BinPackArguments. |
| `AllowAllParametersOfDeclarationOnNextLine` | Supported | Wrapped declaration layout policy; distinct from BinPackParameters. |
| `PackConstructorInitializers` | Not applicable | C++ multiple field/base initializer lists do not exist in LGD; LGD has at most its supported : base(...) initializer. |
| `BreakConstructorInitializers` | Supported | Maps BeforeColon/AfterColon onto LGD : base(...) line placement. C++ comma-separated member-initializer lists and BeforeComma are not implemented. |
| `ConstructorInitializerIndentWidth` | Supported | Maps to indentation.constructorInitializer for LGD : base(...) continuation indentation, independently from ordinary continuation width. Supported range 0–32; no C++ member-initializer list is synthesized. |
| `BreakBeforeBinaryOperators` | Supported | None/NonAssignment/All choose after/beforeNonAssignment/before for existing and explicitly enabled binary-expression wrapping. Independent BreakBinaryOperations controls whether new expression breaks are introduced. |
| `BreakBinaryOperations` | Partial | RespectPrecedence wraps long or already-multiline parsed expression groups at the root precedence; OnePerLine may wrap every binary node; Never preserves existing breaks. Uses native soft column limit and operator-side preference with continuation indentation. It is not the complete clang layout optimizer. |
| `PenaltyBreakAssignment` | Unsupported | Upstream layout optimizer cost has no native cost-model equivalent; it cannot truthfully map to a Boolean or hard line-break requirement. |
| `AlwaysBreakAfterReturnType` | Partial | None projects to preserving current typed LGD method return layout; All/AllDefinitions project to nextLine. TopLevel/TopLevelDefinitions preserve because typed return signatures are members. Native wrapping.returnType also offers sameLine. No optimizer-based decisions are inferred. |
| `PenaltyReturnTypeOnItsOwnLine` | Unsupported | Upstream optimizer cost is not implemented. Native return-type line placement is an independent explicit style choice. |
| `SeparateDefinitionBlocks` | Supported | Blank separation of compatible LGD type/function definitions; not every brace block. |
| `MaxEmptyLinesToKeep` | Supported | Upper bound for syntactic blank lines, preserving literal/JSX/comment content. |
| `KeepEmptyLinesAtTheStartOfBlocks` | Supported | Legacy spelling; controls blank lines directly after code-block opening braces, not every literal opening brace. |
| `WrapNamespaceBodyWithEmptyLines` | Not applicable | No LGD namespace blocks. |
| `SortIncludes` | Not applicable | LGD has no #include syntax. The importer recognizes false as preserve-order intent without sorting any LGD imports; other C/C++ include behavior is not applicable. |
| `SortUsingDeclarations` | Not applicable | C++ using declarations are absent from LGD. |
| `ReflowComments` | Supported | A false value is honored by preserving existing comment/JSDoc text. true reflow is not implemented and is reported unsupported. |
| `FixNamespaceComments` | Not applicable | No LGD namespace-closing comments to synthesize. |

## Additional core and ESLint coverage

This catalog does not exhaust EditorConfig or ESLint. Core `trim_trailing_whitespace` is implemented as the native whitespace preference. `spelling_language` is editor spell-check metadata, not a source auto-fix. `charset` concerns file encoding rather than a text edit; changing an editor document's characters does not prove the on-disk encoding changed. Standard glob/root/precedence handling still applies to both. Additional keys need explicit catalog entries and tests before being advertised.

The ESLint importer reads `.eslintrc.json` as data, respects supported scoped overrides, and recognizes the base and compatible `@stylistic/` spellings. It does not execute flat JavaScript configuration, `extends`, plugins or arbitrary analyzer code. Supported intent is limited to the entries below; unsupported options are not an invitation to run upstream code.

| ESLint rule | Imported LGD subset and limitations |
| --- | --- |
| `brace-style` | `1tbs`, `allman`, `stroustrup`; compatible single-line-block allowance, with native safety guards |
| `curly` | `all` or `multi-line`; insertion-only safe statement subset; no automatic brace removal |
| `indent` | Tab or bounded numeric indentation; supported switch-label subset, not every ESLint node override |
| `space-in-parens` | Basic always/never padding; context exceptions are not a complete ESLint implementation |
| `array-bracket-spacing` | Basic array/index bracket padding; upstream object/array exceptions need separate support |
| `object-curly-spacing` | Basic object-brace padding; named import/export and every upstream exception are not guaranteed |
| `space-infix-ops` | Compatible binary/assignment spacing; LGD syntax and mandatory lexical separators are retained |
| `no-trailing-spaces` | Editable whitespace gaps; protected literals/comments/disabled regions stay exact |
| `eol-last` | Final newline presence/absence, excluding empty-file insertion and protected trailing regions |
| `linebreak-style` | Unix/Windows endings in editable gaps; literal/comment bodies are not rewritten |
| `no-multiple-empty-lines` | Native max-empty-line cap; distinct BOF/EOF maxima are not fully represented |
| `operator-linebreak` | Before/after position for already-wrapped binary operators; arbitrary overrides/none are not a full mapping |
| `comma-spacing` | Boolean before/after comma spacing in supported lists |
| `keyword-spacing` | Control-keyword `after` preference; before/keyword-specific override policies are not complete |
| `space-before-function-paren` | Basic always/never; named-versus-anonymous object forms require distinct parser context and must not be assumed equivalent |

Off ESLint rules do not import an active style preference. Imported severities are attached to the corresponding native option-level rules where representable; separate native fix permissions remain authoritative. Files using only unsupported linter rules receive a compatibility report, not a claim of enforcement.

The [ESLint rule reference](https://eslint.org/docs/latest/rules/) distinguishes rules and their fixability. A rule's upstream “fixable” flag is not proof that its fix is valid against LGD syntax. Recommended native behavior is conservative formatting with explicit per-rule policy and an explainable compatibility report, not a promise to execute every linter suggestion.

