# Safe cleanup integration

`LgdCleanupStyles.analyze(source, { options, rules })` returns standard exact-text
findings independently of whitespace AST-identity validation. Register
`LgdCleanupStyleOptions.catalog` beside the other formatting families and generate
its leaf rules through the existing catalog mechanism. Merge analyzer findings in
the shared formatting rules adapter after layout has settled; retain normal fix
policy handling in the existing planner. Do not pass these token-changing edits
through the whitespace formatter's AST identity check.

## Independent native controls

- `formatting.options.cleanup.unusedLocals`: `preserve` (default) or `remove`.
- `formatting.options.cleanup.unreachableStatements`: `preserve` (default) or `remove`.
- `lgd.format.cleanup.unusedLocals` and
  `lgd.format.cleanup.unreachableStatements`: independent severity and fix policy.
- Parent `lgd.format.cleanup` accepts both options and inherited policy.

`diagnosticAliases.IDE0035` is the supported diagnostic severity alias for
`unreachableStatements`. Importing its severity alone must not enable removal;
retain the native opt-in and independent automatic/manual/off setting.
`editorConfig` is intentionally empty. IDE0059's discard-assignment preference is
not implemented by removing a never-used declaration, and IDE0060 is not safe to
translate into parameter deletion. Do not silently alias either to unusedLocals.

## Proof limits

The analyzer reuses the LGD compiler/model and Babel bindings. It requires the
entire containing block AND each edit to be contiguous unchanged source text,
allowing e.g. typed LGD method signatures around an unchanged method body. It
refuses lowered/generated bodies rather than inventing native reference mappings.

Unused cleanup requires one `const` binding with a primitive literal initializer
inside a function-local block, no references (including closures, shorthand and
JSX members), no writes, no comments attached/inside the declaration, and no
string expression that could become a directive after deletion. Dynamic eval or
with anywhere disables cleanup. Top-level variables, exports, parameters,
private members, imports, destructuring, multiple declarators, let/var, getter
reads, arbitrary expressions and effectful initializers are deliberately retained.

Unreachable cleanup removes only expression statements after an immediate
return/throw/break/continue in the same unchanged block. It leaves labels, all
declarations, nested control statements, function/class expressions, yield,
await and comments intact. No control-flow inference across branches is made.
Formatting-off source is conservatively declined.

## Reproducible compact demonstration

Input: `class Entry { Number run() { const unused = 1; return 2; work(); } }`

With both native preferences `remove`, the cleanup-only result is:
`class Entry { Number run() {  return 2;  } }`

The normal layout formatter may subsequently normalize whitespace. Both findings
carry exact original offsets and expected text; a second cleanup pass is empty.

## Verification

Focused suite: `tests/src/Lgd/Formatting/LgdCleanupStyles.test.js` (34 tests).
All three added JavaScript files checked with workspace ESLint configuration,
custom rules and espree latest: zero errors and zero warnings. Full aggregate
verification belongs to the integration owner; it has not been run here.
