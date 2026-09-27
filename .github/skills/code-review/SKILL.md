---
name: code-review
description: Review pull requests in js-syntax-extension and give an explicit approval decision or concrete, actionable findings grounded in the changed behavior.
---

# Review this extension

Read `AGENTS.md`, the pull request's intended behavior, the current diff, and relevant callers and tests. Compare questionable behavior with the base revision so findings distinguish new regressions from existing limitations. Review the complete affected flow before submitting findings together.

## Actionable findings

- Report defects introduced or materially worsened by the change, and violations of the requested behavior or documented project conventions. Identify pre-existing problems separately; do not turn an unrelated cleanup into a condition for approving this change.
- Anchor each finding to a relevant file and line. Explain the concrete input or event sequence, the resulting incorrect behavior, and the smallest reasonable correction. Include a focused regression case when useful.
- Set severity from the observed impact. Verify assumptions against callers, platform behavior, and tests. State missing evidence or context explicitly instead of presenting a hypothetical failure as a confirmed defect.
- Keep optional improvements separate from approval-blocking findings. Avoid duplicate comments and subjective rewrites that do not improve correctness or an established readability requirement.
- During re-review, check the new code against earlier findings. Treat fixed findings as resolved; report a remaining or newly introduced problem only with current evidence.

## Project checks

- Preserve parser acceptance and generated declarations unless the pull request intentionally changes them. Pay attention to incomplete editing states, automatic semicolon insertion, and isolated diagnostics for concurrent compilations.
- LGD errors should remain visible through squiggles, Problems, status feedback, and Output. Check that error handling does not introduce popup notifications or silently discard diagnostics.
- For declaration-file changes, check collision handling, failure cleanup, and supported Windows/POSIX paths. Check that tests demonstrate behavior rather than mirror implementation details.
- Apply the readability, named-regex-capture, JSDoc, fixture, encoding, and line-ending conventions in `AGENTS.md`. Use `npm run lint` for the project's actual ESLint configuration when running checks; editor formatting is not a lint result.
- Account for Git line-ending normalization before reporting formatting defects. The Windows development checkout uses `core.autocrlf=true`: saved files are CRLF while Git stores normalized LF, including existing base-revision files. Check attributes, checkout configuration, and the base revision; LF in a Git blob, diff, or differently configured review checkout alone does not establish a regression or invalidate the developer's CRLF byte check.
- Use relevant existing tests and proportionate regression coverage. Report which checks were run, which results were supplied by CI, and any material verification gaps.

## Approval decision

End with a clear decision for the current head and base:

- **Approve** when there are no actionable approval-blocking findings and the available verification supports the change. Submit an approving GitHub review when that capability is enabled; do not manufacture findings to avoid approving.
- **Changes needed** when concrete blocking findings remain. List those actionable items and the verification needed to resolve them. If essential evidence is unavailable, identify exactly what is needed before approval.

An approval assessment in review text is not proof of an active GitHub approval. Check the actual review state when reporting merge readiness, including whether a new commit or base change dismissed an earlier approval. Explain a platform or repository approval restriction accurately; do not change branch protections as part of reviewing code.
