---
name: garden-desk-review-change
description: Review a Garden Desk diff or pull request for actionable defects. Use for self-review, maintainer review, or security-sensitive changes where findings must be ordered by severity and grounded in exact evidence.
---

# Review A Garden Desk Change

Top priority: apply the Minimum Work and Test Rules in [AGENTS.md](../../../AGENTS.md) to every review. Treat unnecessary production code and unnecessary tests as P2 defects. Never request a test beyond the Test Rule.

Use [AGENTS.md](../../../AGENTS.md), accepted ADRs, and the active milestone as the baseline. Review in the order and with the P0-P3 severities in [the development workflow](../../../docs/DEVELOPMENT_WORKFLOW.md#5-review-and-hand-off).

For each finding give a concise title, severity, exact path and line, the failure scenario, and the smallest valid remedy. Do not report style preferences as defects.

Lead with findings. If there are none, say so and state the remaining verification limits. Review only; do not edit, approve, merge, or publish unless separately asked.
