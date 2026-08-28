---
name: vault-verify-change
description: Verify a Garden Desk change before claiming completion. Use after edits, before a pull request, or when an exact pass, fail, and not-run report is needed.
---

# Verify A Garden Desk Change

1. Inspect the complete diff and changed-file list, including unrelated pre-existing changes.
2. Run `pnpm lint && pnpm typecheck && pnpm test` plus the one targeted test the change added, if any.
3. Run `pnpm verify` only when the change touches a native helper, build script, or packaged runtime. Run `pnpm test:gate --milestone <n>` only when claiming that milestone.
4. Record exact commands and outcomes. Never report a skipped or unavailable check as a pass.

Produce:

```markdown
## Verification Report

- Changed surfaces:
- Commands passed:
- Commands failed:
- Not run and why:
- Conclusion: ready | not ready | blocked
```

Do not fix failures unless the user asked for a fix.
