---
name: garden-desk-fix-bug
description: Fix a Garden Desk bug with one reproducing test first. Use for any defect, regression, or failing behavior report; this is the only case where Garden Desk uses test-driven development.
---

# Fix A Garden Desk Bug

1. Reproduce the bug. For agent-loop behavior, use the real-model reproduction in [the development workflow](../../../docs/DEVELOPMENT_WORKFLOW.md#real-model-reproduction); a fake inference run is not evidence.
2. Write one failing test that reproduces the bug in the existing test file for the module (create a file only if none exists). Run it and confirm it fails for the expected reason.
3. Make the smallest fix. Run the test again and confirm it passes.
4. Run `pnpm lint && pnpm typecheck && pnpm test`.
5. Add no further tests and do not edit unrelated tests.

Report the root cause, the fix, and the exact commands and results. Do not commit or push unless asked.
