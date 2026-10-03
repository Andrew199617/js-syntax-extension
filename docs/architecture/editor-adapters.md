# Editor adapter boundary

LGD's new fix and formatting components separate language policy from editor integration. The shipped extension currently supplies a VS Code adapter. Packaging for other IDEs remains future work.

## Shared language components

- `src/Lgd/Formatting/` owns the formatting option catalog, token/AST-aware analysis, and declarative preference adapters. The source resolver receives `readSnapshot(path)` from its host instead of importing an editor SDK or opening files itself
- `src/Lgd/Fixes/LgdFixSettings.js` parses and validates native JSON configuration and merges ordered rule layers
- `LgdFormattingPolicy.js` resolves family and option-level severity/fix settings
- `LgdFormattingRules.js` creates stable diagnostics and exact replacement metadata
- `LgdFixEngine.js` accepts a registry and a context factory from the host. It does not import VS Code
- `LgdFixPlan.js` deduplicates proposals, rejects conflicting atomic edits, creates before/after previews, and checks source snapshots. It does not apply editor edits or save files

A source buffer supplies a stable identity through `uri.toString()`, its current `version`, `isClosed`, and `getText()`. The existing URI-shaped identity is a host protocol, not a dependency on the VS Code URI implementation. Proposals contain original-source offsets, expected text, and snapshots of every relevant source. The host supplies the compilation runtime and source context factory; editor SDK objects stay outside the shared engine.

## VS Code adapter

`src/Editors/VSCode/` owns the new fix/formatting integration:

- `LgdFixConfiguration.js`: workspace boundaries, filesystem snapshots, open configuration buffers, import diagnostics and change listeners
- `LgdFixRuntime.js`: binds the existing VS Code source/dependency context and registry to the shared engine
- `LgdFixEdits.js`: converts offsets to VS Code ranges and applies a single `WorkspaceEdit`
- `LgdFixService.js`: commands, Fix All scopes, progress/cancellation, save actions, and native diff previews
- `LgdFormattingDiagnostics.js`: optional style diagnostics, deliberately separate from blocking compiler errors

The surrounding legacy extension services and existing diagnostic-specific fixes are not comprehensively reorganized in this increment. Some existing strategies still use the VS Code source context; a future adapter must provide equivalent guarded document access when porting those strategies. New policy and formatting code must remain independent of those editor imports.

## Adding another host

Reuse the option catalog, strict settings parser, formatter, diagnostics and offset plan. Supply the host's buffer/workspace/configuration readers, compilation runtime, cancellation, preview/consent UI, version-checked atomic edit application and diagnostic presentation. Keep the host-specific entry point and packaging in its own adapter directory; do not add an SDK dependency to the shared language modules.

VS Code's `source.fixAll.lgd` and `editor.codeActionsOnSave` are adapter capabilities. Another editor should map its equivalent commands and save mechanism to the same policy and guarded plan. The core never installs save watchers, saves documents, or edits a file on its own.

## Verification

`LgdFixCore.test.js` rejects any attempted import of `vscode` while exercising configuration merging, formatter diagnostics, and the engine with a plain custom-host buffer. Adapter tests separately cover VS Code diagnostics, workspace edits, scopes, stale configuration, cancellation and automatic-fix opt-in.
