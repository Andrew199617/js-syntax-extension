# LGD diagnostic quick-fix architecture

## Responsibilities

- `LgdCodeActionProvider`: match stable diagnostic codes to exact current source spans, route registered handlers, deduplicate equivalent edits, retain bounded opaque proposal IDs, apply WorkspaceEdits and refresh diagnostics
- `DiagnosticQuickFix`: shared strategy base; capture source snapshots, validate integer ranges and exact edit provenance, check source/dependency versions and text, and require synchronous contract guards to return true
- `QuickFixContext`: per-request source and imported-contract context, including editable base-method resolution; no global mutable request state
- `QuickFixRegistry`: one registration point for isolated handlers
- `AddOverrideFix`, `MakeBaseVirtualFix`, `RemoveExtraBaseArgumentsFix`, `ChangeParameterTypeFix`: diagnostic-specific applicability and minimal source edits

All four native LGD diagnostic strategies extend `DiagnosticQuickFix`. The existing JavaScript/React actions already extend their separate `QuickFixAction` base. They keep their existing integration; this change does not silently migrate their legacy diagnostic behavior into the LGD language service.

Commands carry only serializable numeric proposal IDs. Source documents and callbacks remain private in the provider; they do not cross the editor command transport. The implementation uses APIs available in the declared VS Code 1.44 API surface. A public WorkspaceEdit has no expected-version field: the last source/contract guard and edit dispatch are contiguous, with no intervening await, but this is not a claim of a fully transactional multi-document API.

## Parameter suggestion contract

The compiler supplies `lgd.assignment.typeMismatch` and optional fix metadata with the actual Babel binding and original parser annotation offsets. The strategy rechecks that metadata against a fresh compile, replaces only the exact `Number` token, and compiles a preview before offering `String`.

Supported first case: an isolated, unreferenced local Function, Object method or class method with one plain Number parameter and only direct String writes in its own function. Both OLOO and native-class output are tested. The title discloses a signature change, and any existing diagnostics that remain. The action is nonpreferred, is not a Fix All action, and never updates a return annotation or caller.

Withhold for exports or escapes, known dependents/callers, inherited/interface/override/virtual/constructor contracts, defaults/rest/destructuring, captured or unknown/conflicting writes, reflection/indirect recursion, erased owner-type references, source JSDoc owner-type references, or preview-introduced diagnostics. Unknown external callers are not evidence of safety. A newly discovered consumer invalidates a retained action even if the original source is unchanged.

The screenshot's Number-return method illustrates a residual diagnostic: changing Number parameter to String repairs its String assignment, but `return value` still violates its Number return contract. This fix reports that remaining error rather than changing programmer intent.

## Extending deliberately

1. Give the compiler diagnostic a stable code and precise original-source spans
2. Add a single handler class extending `DiagnosticQuickFix`
3. Resolve the real binding/declaration; do not search-and-replace by name
4. Return a minimal edit proposal with title, target snapshot, all relevant snapshots, integer offsets, replacement text and optional synchronous current contract guard
5. Register the handler, test source preservation/unsafe blocks/stale application, and validate the real editor flow

Potential next handlers need distinct applicability rules:

- Local-variable annotation mismatch: preserve readonly semantics, lexical shadowing, nullability, defaults and all later writes
- Return annotation mismatch: treat the return type as a public contract; validate every return branch and known consumers before suggesting a change
- Destructuring/default parameters: map the exact typed binding and validate projections/default evaluation; never infer a replacement from an unrelated same-name variable
- Multi-document interface/base changes: use explicit preview and authorized scope; a future batch-edit proposal must validate every target and reject overlapping edits before dispatch
- Nullable values: distinguish assignment nullability from nonnullable return rules rather than applying one generic type conversion
- Missing syntax expressions: offer actionable diagnostics; do not guess a literal or insert code without evidence of intent

## Regression coverage

The tests cover original override/base/literal-removal behavior, comments and effectful expressions, exact LF/CRLF annotation edits, sibling bindings/shadowing, residual returns, repeated writes/deduplication, cancellation, stale/closed sources, changed imports/transitive contracts, new consumers, and rejected asynchronous contract guards. Compiler-focused tests cover caller/contract/annotation/reflection exclusions and both output models. Real Extension Host evidence is packaged separately with build identities and unmodified native screenshots.
