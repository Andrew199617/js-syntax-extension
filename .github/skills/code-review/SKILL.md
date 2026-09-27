---
name: code-review
description: Review changes for bugs, regressions, and project-rule violations.
---

# Code review

- Follow AGENTS.md.
- Review the diff and relevant surrounding code and tests.
- Report verified, actionable issues caused or exposed by the changes. Skip speculation and unrelated cleanup.
- For each finding, give severity, location, trigger, impact, and the smallest reasonable fix.
- Use existing CI results or focused checks. State what was verified and what remains uncertain.
- If there are no actionable findings, say so.
- Do not modify files unless asked.


## Actionable findings

- Report defects introduced or materially worsened by the change, and violations of the requested behavior or documented project conventions. Identify pre-existing problems separately; do not turn an unrelated cleanup into a condition for approving this change.
- Anchor each finding to a relevant file and line. Explain the concrete input or event sequence, the resulting incorrect behavior, and the smallest reasonable correction. Include a focused regression case when useful.
- Set severity from the observed impact. Verify assumptions against callers, platform behavior, and tests. State missing evidence or context explicitly instead of presenting a hypothetical failure as a confirmed defect.
- Keep optional improvements separate from approval-blocking findings. Avoid duplicate comments and subjective rewrites that do not improve correctness or an established readability requirement.
- During re-review, check the new code against earlier findings. Treat fixed findings as resolved; report a remaining or newly introduced problem only with current evidence.

## Approval decision

End with a clear decision for the current head and base:

- **Approve** when there are no actionable approval-blocking findings and the available verification supports the change. Submit an approving GitHub review when that capability is enabled; do not manufacture findings to avoid approving.
- **Changes needed** when concrete blocking findings remain. List those actionable items and the verification needed to resolve them. If essential evidence is unavailable, identify exactly what is needed before approval.

An approval assessment in review text is not proof of an active GitHub approval. Check the actual review state when reporting merge readiness, including whether a new commit or base change dismissed an earlier approval. Explain a platform or repository approval restriction accurately; do not change branch protections as part of reviewing code.