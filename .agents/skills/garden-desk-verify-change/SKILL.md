---
name: garden-desk-verify-change
description: Verify a Garden Desk change before claiming completion. Use after edits, before a pull request, or when an exact pass, fail, and not-run report is needed.
---

# Verify A Garden Desk Change

Top priority: run the smallest complete command set that proves the changed behavior. A general instruction to run a full command does not mean the largest repository gate.

1. Inspect the complete diff and changed-file list, including unrelated pre-existing changes.
2. For documentation or instructions only, inspect links and command names and run `git diff --check`. Run no product tests.
3. For a focused source change, run `pnpm lint`, `pnpm typecheck`, and the one focused test required by the Test Rule, if any. For a platform boundary, use `pnpm test:platform:gate`. For an M2 native boundary, use `pnpm test:native:m2`.
4. Run `pnpm verify` only for a native helper, build script, or packaged runtime. Do not duplicate commands that it includes. Leave the full `pnpm test` suite to CI unless the owner explicitly requests a local run.
5. Run a real model, physical microVM, golden task, or milestone gate only as a last resort and only with explicit owner approval under [AGENTS.md](../../../AGENTS.md). A retry needs new approval.
6. Record exact commands and outcomes. Never report a skipped, unavailable, or unapproved check as a pass.

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
