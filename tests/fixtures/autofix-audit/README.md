# Native editor proof fixtures

Use the final integrated extension build. Keep these proofs distinct from unit-test evidence. Copy lgd.json to the proof workspace's .vscode/lgd.json. Do not change the user's real project configuration for a demonstration.

1. inheritance-braced.lgd and inheritance-bare.lgd: at the @extends warning, show the LGD diagnostic and preferred Remove redundant inheritance documentation action. Apply it. The class description, constructor documentation, colon base, both base arguments, readonly command field, override and base dispatch must remain. Repeat request should show no redundant-tag action. Undo should restore the exact original source and diagnostic. Capture before/menu/after/Undo.
2. affected-range.lgd: request the Boolean simplification action on choose. Apply it once. It should become return !!(value); under the default compact parentheses. The substantial AuditExample class, unrelated compact function, and comment stay byte-for-byte unchanged. Capture the specific action and a source diff. Undo should restore the original expression and diagnostic.
3. short-condition.lgd: run document Fix All with formatting enabled. Show if(first > 0) on one line, return (first + 1); and unpadded non-empty declaration parentheses, including Number add(Number first). The readonly field, constructor assignment and readCount method remain. Repeat Fix All should make no changes.
4. Repeat the above with formatting.enabled:false for semantic documentation actions; the tag cleanup must still work and unrelated styling must remain. For style actions with enabled formatting, repeat off/manual/automatic/save-leaf policy cases without silently changing shared configuration.
5. Native Cancel and repeated/Undo flows still require actual host checks. The audit's source and automated tests do not mark those UI proofs complete.

Both inheritance fixtures currently compile with exactly the intended redundant inheritance documentation warning. The other fixtures compile without errors. All fixture bytes are CRLF/UTF-8 without BOM.
