---
name: vault-review-dependency
description: Evaluate a proposed Garden Desk library, tool, native component, or GitHub integration before adoption. Use when adding or replacing a dependency or comparing build-versus-adopt options.
---

# Review A Garden Desk Dependency

1. Define the exact capability needed and the active milestone that consumes it.
2. Search the repository and the standard library for an existing solution.
3. Use primary sources: official documentation, registry metadata, source, releases, advisories, license files.
4. Evaluate maintenance, license and redistribution, transitive dependencies, offline behavior, telemetry, network and credential access, footprint, native code, platforms, security posture, and adapter fit.
5. Mark untested platform, performance, or packaging claims as research-derived.

Produce:

```markdown
## Dependency Review

- Capability and milestone:
- Existing alternative:
- Candidate and pinned version:
- License and redistribution:
- Offline, telemetry, network, and credential behavior:
- Footprint, native code, and platforms:
- Security and maintenance:
- Adapter fit:
- Decision: adopt | benchmark | defer | reject
```

Do not install the candidate unless implementation was requested and the active milestone authorizes it.
