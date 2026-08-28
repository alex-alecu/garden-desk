---
name: vault-plan-change
description: Plan a Garden Desk change against the active milestone before editing. Use when starting non-trivial work, checking whether a request is authorized in the current phase, or deciding what stays out of scope.
---

# Plan A Garden Desk Change

1. Read the current phase and Test Rule in [AGENTS.md](../../../AGENTS.md) and the active gate in [the implementation plan](../../../docs/IMPLEMENTATION_PLAN.md).
2. Stop if the work belongs to an inactive milestone; offer an issue, design note, or plan instead.
3. Search for an existing repository capability before proposing new code.
4. Name the boundary or business rule the change touches and the one test it may need.
5. List what you will explicitly not do.

Produce:

```markdown
## Change Brief

- Goal:
- Scope and milestone:
- Boundaries touched:
- Test to add (per Test Rule, or none):
- Explicitly not doing:
```

Do not install tools, create scaffolding, or broaden permissions. Ask for a maintainer decision when the change would reopen an accepted architecture or security boundary.
