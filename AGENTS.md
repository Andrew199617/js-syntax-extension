# Code readability

## README audience

- `README.md` is displayed to users of the VS Code extension. Keep it focused on extension features and usage; do not add developer setup, linting, testing, build instructions, or internal implementation details.
- Put developer and agent guidance in `AGENTS.md` or separate developer documentation.

## Parser regression fixtures

- Preserve `tests/mocks/`, including expected `.d.ts` outputs, during linting and formatting cleanup. Edit or regenerate fixtures only when intentionally changing the tested behavior.
- Do not change parser acceptance, generated output, or parser-test `tabSize` to accommodate linting or formatting changes.
- Keep `tests/mocks/`, `tests/__mocks__/`, and generated `.d.ts` files excluded from ESLint and autofix.

## File encoding and line endings

- Save new text files with CRLF line endings and UTF-8 encoding without a BOM. Preserve an existing file's encoding and BOM when editing it.
- Keep edited text files in CRLF; do not leave LF-only or mixed line endings after applying patches. Check the final bytes before finishing so saving in the editor does not rewrite the entire file.

## General guidelines
- Use one module style per file: standalone functions, one class, or one OLOO object. Do not mix module-level functions with class or OLOO definitions, or put multiple classes/OLOO objects in one file.
- Prefer adding related functions as methods of the existing OLOO object. If a module exports standalone functions, keep the whole module in that style instead of intermingling it with class or OLOO definitions.
- Imports, constants, plain configuration objects, and local callbacks or helpers inside methods are allowed alongside the chosen module style.
- Configuration objects may contain arrow callbacks. The module-style rule treats object methods, accessors, and function-expression properties as OLOO behavior; arrow callback properties alone do not define an OLOO object.
- Prefer straightforward code that can be read once over compact code that saves lines.
- For small, fixed sets of commands or actions, prefer explicit registration calls over building arrays of command/callback tuples and immediately iterating over them.
- Extract repeated error handling and disposal into a named helper. Give substantial callbacks and configuration objects meaningful names before passing them to another function.
- Use ordinary conditionals instead of nested ternaries. Keep distinct operations on separate lines and use explicit object properties when mapping a small, fixed set of settings.
- Do not address a readability complaint by only wrapping the same dense expression across more lines. Simplify the structure.
- Use named regex captures and `match.groups`; use `(?:...)` for non-capturing groups.
- Preserve descriptive named captures when they improve regex readability, even if their values are not used. Do not replace them with non-capturing groups solely because they are unused.
- When applying `unicorn/prefer-number-properties`, verify semantic equivalence in context before accepting a fix. In particular, global `isNaN` and `isFinite` coerce their arguments, while `Number.isNaN` and `Number.isFinite` do not; check the caller's possible input types and preserve intended behavior.

## JSDoc formatting

- Document every public class or object method (including constructors, accessors, and function-valued fields) with a nonempty `@description`. Include matching `@param` tags for every parameter or omit them entirely. `@returns` is optional; its type is useful and its description is optional. Private methods (`#private`, underscore-prefixed, `@private`, or `@protected`) are exempt.
- Use top-level JSDoc `@import` declarations for types from other modules; do not use inline `import()` types or imported `@typedef` aliases.
- Keep short JSDoc with at most one `@` tag on one line, including typedef aliases. With multiple tags, put `/**`, each tag, and `*/` on separate lines, with no blank lines between tags.

## ESLint verification after edits

- After creating or editing any JavaScript file, run ESLint on that file. Repeat the check after subsequent edits and autofixes; the final saved version must be checked before reporting completion.
- Use the project's full ESLint configuration in `.vscode/.eslintrc.json`, the custom rules in `.vscode/eslint-rules`, and the `espree` parser with `ecmaVersion: "latest"` as configured in `.vscode/settings.json`. Resolve configuration and rule paths in the workspace being edited, including isolated feature workspaces.
- Review both errors and warnings. Fix violations introduced by your changes, including restricted identifiers such as `data` and `foo` (`id-blacklist`); choose descriptive names and update their references without changing external API field names.
- Do not disable rules or add suppression comments to avoid fixing violations. Report any remaining pre-existing diagnostics or blocked checks explicitly; do not claim ESLint passed when it did not.
- Editor format-on-save and passing tests do not replace an explicit ESLint check. In the final response, state which edited files were checked and whether any diagnostics remain.

## Testing

- Keep testing proportional to the change. Prefer extending existing tests.
- Add tests for meaningful behavior, important edge cases, and bug regressions.
- Avoid redundant tests, assertions coupled to implementation details, and
elaborate test infrastructure for small changes. run broader checks when warranted or required by the project.
- Stop expanding coverage once the relevant behavior is sufficiently verified.

## Pull request review workflow

- Address Copilot feedback with follow-up commits on the original pull request branch. Keep the work in one pull request; do not create replacement or follow-up pull requests or request a separate review for each fix you do for copilot.
- Commit and push fixes so Copilot can recheck the existing pull request.
