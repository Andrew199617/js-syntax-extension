# LGD autofix and quick-fix audit

## Scope and verified result

Inspected the complete registry and every native strategy from baseline fe56a9d. Code fix ad86ada was combined with readable-default spacing 7a06bec (local combined code 38a3583). The complete combined run passed 105 suites / 3,324 tests. Full project ESLint checked 297 files with zero errors and warnings. Webpack development build passed. All edited/new text files are UTF-8 without BOM and CRLF.

This is source and automated-test evidence. The new commits have not been exercised in the native editor by this audit task. Native screenshots, Undo interaction, and Andrew's acceptance must be recorded separately. A passing aggregate count does not establish every option/context/entry-point combination.

The machine-readable companion, lgd-autofix-rule-inventory.json, enumerates all 142 handlers / 140 rule IDs, every option/default, each native strategy source, test evidence, and current verification bounds. Its Andrew verification flags are unset.

## Changes verified in this batch

1. Shared local composition now settles permitted canonical whitespace findings inside a token-changing fix and its touching whitespace. Individual fixes, Fix All, and save actions reuse the same composition, analyzers, rule policies, guarded offset plan, and workspace-edit adapter. Original text is preserved elsewhere. There is no second formatter or string-rewrite algorithm for cleanup.
2. Block-start/end blank-line removal now carries emptyLinesAtBlockStart/End policy. Compact functions, lambdas, ifs, loops, preserved blocks, opening braces, and width fitting retain the option that governed the decision. Column limit and nested indentation dependencies are carried when they matter.
3. Case-content/label indentation carries indentation.size. Trailing-space removal by an earlier layout stage carries trimTrailingWhitespace; explicit preservation cannot be overridden by layout.
4. A constructor-spelling action that delegates to factory migration carries both class-constructor-name and object-inheritance. Batch eligibility checks native contributors independently. Canonical policy lookup excludes individual-only alternatives so ordinary object/parameter actions stay available.
5. Redundant braced or bare @extends/@augments tags now have an inheritance-documentation action when the attached tag's type exactly equals the explicit class colon base. Existing fence-aware tag scanning and documentation cleanup preserve descriptions, other tags, constructor documentation, colon inheritance, and base arguments. Legacy-only/conflicting types retain the migration path. The rule is certified automatic-safe but still requires save opt-in twice.
6. Default short-condition fitting remains enabled; the substantial Example fixture settles to if( first > 0 ) and return ( first + 1 );. Explicit style imports/native overrides remain authoritative, including compact parentheses and disabled return-keyword spacing.

## Complete native-action evidence inventory

| Rule / action | Batch policy | Meaningful evidence |
| --- | --- | --- |
| unnecessary-reference-cast / removeRedundantCast | Safe; manual default; save opt-in | Compiler redundancy proof, exact metadata, stale source/dependency, cast/type safety: LgdRedundantCasts.test.js, LgdCastEditor.test.js |
| class-constructor-name / renameClassConstructor | Semantic review; explicit batch opt-in | Reserved spelling, duplicates/unsupported constructors, validated preview, factory fallback dual-policy: LgdPartialClassMigration.test.js, LgdFixAudit.test.js |
| constructor-return-value / replaceConstructorReturnThis | Safe; manual default; save opt-in | Terminal removal versus early exit, effectful/ambiguous refusals, LF/CRLF, repeat: LgdConstructorReturns.test.js, LgdReturnDocFix.test.js, LgdFixService.test.js |
| readonly-variable-declaration / replaceReadonlyLocal | Safe; manual default; save opt-in | Parser-proven local token, class members preserved, stale modifier, automatic policy: LgdCodeActionProvider.test.js, LgdFixService.test.js |
| return-type-documentation / removeReturnDocType | Safe; manual default; save opt-in | Typed methods/constructors, nested documentation types, descriptions/other tags, empty docs, stale action: LgdReturnDocFix.test.js |
| inheritance-documentation / removeInheritanceDoc | Safe; manual default; save opt-in | User's braced/bare forms, complete inheritance/base call retained, fences/other docs, conflicting/legacy refusals, off/manual/automatic/stale: LgdFixAudit.test.js |
| virtual-documentation / moveVirtualModifier | Safe; manual default; save opt-in | Supported methods, existing modifiers, tag deduplication, prose/fences/tabs/CRLF, stale modifier: LgdVirtualDocChecker.test.js, LgdCodeActionProvider.test.js |
| object-inheritance / convertObjectInheritance | Semantic review; explicit batch opt-in | Proven OLOO factory lifecycle, known local/imported bases, documented aliases, companion base preparation, compilation/contract refusals: LgdObjectInheritanceFix.test.js, LgdPartialClassMigration.test.js |
| object-inheritance / prepareObjectInheritance | Individual only | Explicit base-only alternative, guarded companion contracts/imports, excluded from Fix All: LgdObjectInheritanceFix.test.js, LgdPartialClassMigration.test.js |
| missing-override / addOverride | Semantic review; explicit batch opt-in | Inherited contract and exact virtual replacement/insertion: LgdOverrideChecker.test.js, LgdCodeActionProvider.test.js |
| nonvirtual-base / makeBaseVirtual | Semantic review; explicit batch opt-in | Explicit child override, nearest lexical/imported base, transitive snapshots, unknown/implicit refusal: LgdCodeActionProvider.test.js, LgdFixService.test.js |
| extra-base-arguments / removeExtraBaseArguments | Semantic review; explicit batch opt-in | Literal suffix only, signed number/BigInt, retained required argument/comment, call/spread/template/effect refusal: LgdCodeActionProvider.test.js |
| parameter-type / changeParameterType | Semantic review; explicit batch opt-in | Isolated lexical contract, source metadata, Number-to-String proof, newly introduced return error disclosed, consumer/export/dynamic-scope refusals: LgdParameterTypeFix.test.js, LgdCodeActionProvider.test.js |
| parameter-type / changeParameterAndReturnType | Individual only | Atomic complete contract change, all reachable String returns, inherited/global/mixed/unknown refusal, newly discovered consumer: LgdReturnTypeFix.test.js, LgdCodeActionProvider.test.js |
| return-type / changeReturnType | Semantic review; explicit batch opt-in | Exact return metadata, isolated contract, String proof, follow-up after parameter choice: LgdReturnTypeFix.test.js, LgdCodeActionProvider.test.js |
| static-member-receiver / useStaticTypeReceiver | Semantic review; explicit batch opt-in | Pure this/local receiver, accessible type reference, lexical shadowing/imported ancestry, optional/effectful/unknown receiver refusal: LgdStaticReceiverFix.test.js |

Native strategies are available individually unless explicitly disabled. Certification never makes semantic migrations automatic. Broader or semantic plans require review and leave files unsaved.

## Complete formatting inventory and coverage bounds

The companion enumerates all 10 families and 116 leaves, including the new afterReturnKeyword leaf. Every family and leaf has a registered FormattingFix strategy. Findings normally name leaf rules; family IDs are policy/option controls, not standalone family diagnostics.

- braces: location-aware presets and explicit class/constructor/method/accessor overrides, continuation preferences, multiline controls. Tests: LgdFormatter.test.js, LgdFormatterSafety.test.js.
- indentation: spaces/tabs/widths, continuation, constructor initializer, labels/case groups. Tests: same formatter suites; new size-policy regression in LgdFixAudit.test.js.
- spacing: control/declaration/call/cast/grouping and empty-parentheses categories, operators, separators, heritage, squares, object/declaration whitespace, return keyword. Tests: formatter/default-spacing tests, safety tests, source adapter tests.
- lineBreaks: block/function/lambda/if/loop/case compactness, preservation, definitions/import/object groups, blank-line boundaries and limits. Tests: formatter suites; six relevant compact/boundary policy regressions are recorded in the audit test.
- wrapping: arguments/parameters, alignment/next-line policy, binary position and fitting/precedence, return types and constructor initializer. Tests: formatter suites; column-limit policy regression.
- whitespace: header, EOL, final newline, trailing whitespace. Tests: formatter suites; LgdFixEdits.test.js exercises native EOL metadata/protected spans/staleness; audit verifies trailing-space policy.
- bracesRequired: AST-proven scope-preserving statement wrapping. Safety suite refuses Annex-B/functions and unsupported scopes.
- expressions: lambda bodies, nullish/null propagation/delegate calls, Boolean/compound/member/conditional/interpolation styles and four parentheses groups. Tests: LgdExpressionStyles.test.js and LgdArrowStyles.test.js, including runtime/evaluation-count and unsafe-form refusals; service tests prove registered batch/save routes.
- declarations: known modifier order, accessibility, primitive const type spelling. Tests: LgdDeclarationStyles.test.js, including comments/exports/mutability/nominal shadow refusals; service tests prove imported policy and scoped batch integration.
- cleanup: only proven unused primitive function-local consts and unreachable same-block expressions. Tests: LgdCleanupStyles.test.js; service tests prove opt-in and safe mixed-file scope. Destructive imports/parameter/member cleanup is not implemented or aliased.

The existing scalar-value matrix checks every declared Boolean/enum/integer choice against mixed LGD syntax for a fixed point and preserved compiler signature. It does not establish that every sample triggers its selected option. Object-valued brace-location/modifier-order settings and string headers require their dedicated tests. The new nine-case policy matrix proves fix:off, severity:off, and leaf manual-over-automatic behavior for the confirmed overlapping-transform bugs, while an independent enabled assignment-spacing fix still proceeds. Other exhaustive pairwise/all-context leaf-policy combinations remain unproven.

## Entry-point and settings matrix

| Dimension | Verified automated behavior | Evidence |
| --- | --- | --- |
| Individual native Quick Fix | Transported LGD diagnostic matched to fresh internal identity; exact source/dependency/contract policy guards; consumed IDs cannot apply twice | LgdCodeActionProvider.test.js, DiagnosticQuickFix.test.js, LgdFixAudit.test.js |
| Document/File Fix All | Open/unsaved buffer, conflict-free plan, safe-only settling, iteration/cycle/cancellation bound | LgdFixService.test.js, LgdFixPlan.test.js |
| Project/Solution | Discovery excludes generated/vendor/parser mocks; nearest config project boundaries; multi-root scope; review/cancel; one invalid project does not block independent valid projects | LgdFixService.test.js, LgdFixConfiguration.test.js |
| Save | source.fixAll.lgd source action, global autoFix plus effective fix:automatic plus certified-safe handler; manual/off leaf wins | LgdFixService.test.js, LgdFixAudit.test.js |
| Formatting gate | Disabled by default; additional canonical cleanup requires formatting.enabled; disabled styles do not cause a full document rewrite | LgdFixConfiguration.test.js, LgdFixComposition.test.js |
| Config precedence | Parents in order, then local config and matching overrides; enabled imports in configured order; native options then per-family options; leaf mode/severity over family | LgdFixConfiguration.test.js, LgdFormattingSources.test.js |
| Async freshness | Source versions/text, dirty/config-file snapshots, missing nearer config, imported buffers/contracts, manifest/project/output identity, cancellation, trust | LgdFixService.test.js, LgdFixConfiguration.test.js, LgdCodeActionProvider.test.js |
| Protected syntax | Comments, strings/regex/templates/JSX, formatting-off regions, ASI/increment/word/operator/numeric/comment boundaries, signature proof | LgdFormatterSafety.test.js, LgdFixEdits.test.js, LgdFixComposition.test.js |
| Atomic application / Undo | One workspace edit per plan; local follow-on cleanup is included in the requested action's same source edit; touching/overlapping atomic edits are rejected/deduplicated | LgdFixPlan.test.js, LgdFixAudit.test.js. Actual native Undo remains pending; iterative Fix All can produce more than one undoable pass |
| EOL | LF/CRLF document metadata changes only when entire authorized preview supports normalization; protected bytes prevent global EOL change; local composition preserves LF/CRLF/CR | LgdFixEdits.test.js, LgdFixComposition.test.js |

The formatter is reused behind diagnostics and LGD source actions. This audit did not add a standalone native Format Document provider or new save listener. Native editor format-on-save is separate from the explicitly enabled LGD source action.

## Intentional limits and review requirements

- Semantic changes to contracts, factory allocation/inheritance, base virtual methods, extra arguments and receiver/type annotations retain explicit manual review. Individual-only alternatives never enter Fix All.
- Additional composition performs whitespace cleanup only. It does not silently introduce an unrelated expression/declaration/cleanup/header transform. Explicitly requested Fix All still evaluates its enabled rules across the selected scope.
- A raw requested migration may remove its consumed statement/tag line as part of the native action even with formatting disabled. Additional canonical style cleanup remains gated.
- Project/semantic plans apply the reviewed conflict-free pass. Overlapping proposals can be deferred; later unreviewed semantic changes are not automatically introduced. Safe document/save cascades have a ten-pass/cycle bound.
- Native editor verification of every registered leaf, every import/config combination, all cancellation/Undo flows, and every native action is not complete. Record screenshots and Andrew acceptance per action/rule without replacing or treating unit-test counts as those proofs.
- Unknown/unsupported foreign rules produce diagnostics or remain unsupported; no claim of an entire ESLint/EditorConfig/clang-format compatibility universe.

## Native fixture plan

See tests/fixtures/autofix-audit/README.md. Fixtures contain real LGD classes with fields, constructors, inheritance/base calls and methods. Their source compiler checks passed: both inheritance fixtures have only the expected redundant-tag warning; affected-range and short-condition fixtures have no compiler errors. The short-condition fixture is formatter-idempotent.
