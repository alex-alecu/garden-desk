# Development Workflow

Created: 2026-07-15

This document is the canonical implementation and contribution workflow for Vault Desk. M0, M1, and M2 are complete; M3 Offline Dev-Agent Desktop V1 is active and its macOS stage is complete. [AGENTS.md](../AGENTS.md) remains authoritative, followed by accepted architecture decision records, [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), and this workflow.

## Operating Principles

- Work only inside the active milestone and accepted issue scope.
- Define acceptance evidence before implementation.
- Search the repository and maintained dependencies before writing custom infrastructure.
- Prefer deterministic checks and primary-source evidence.
- Protect security, privacy, evidence, recovery, and approval invariants with focused tests.
- Report commands and results exactly; never imply that an unrun check passed.
- Keep agent workflows in development tooling. They are not Vault Core modules or shipped product behavior.

The repository does not require a universal test-coverage percentage, test-driven development for every edit, proactive delegation, blanket immutability, or a generic application architecture. The milestone gates and the risk-based test policy define what is required.

## 1. Confirm The Active Milestone

Before changing a file:

1. Read the current phase rules in [AGENTS.md](../AGENTS.md).
2. Find the active milestone and its gate in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
3. Identify the product contract, adapter boundary, or documentation responsibility the issue exercises.
4. Read the relevant ADRs and the folder ownership rules in [IMPLEMENTATION_STRUCTURE.md](IMPLEMENTATION_STRUCTURE.md).
5. Stop if the requested implementation belongs to an inactive milestone.

Roadmap presence is not authorization. The owner activated M3 on 2026-07-20. The post-V1 document-intelligence follow-up and all later work require a new explicit owner request. Implementation outside the active scope must be converted into an issue, design note, or plan rather than code.

### Change Brief

Record this before implementation:

```markdown
## Change Brief

- Goal:
- Active milestone and issue:
- Allowed scope:
- Product contracts and boundaries:
- Risks:
- Acceptance evidence:
- Dependencies affected:
- Explicitly not doing:
```

## 2. Inspect And Research First

Search locally before searching externally:

1. Inspect the relevant source, tests, schemas, adapters, and recent history.
2. Check whether the capability already exists or can be expressed through a current contract.
3. For a dependency decision, use official documentation, package metadata, source, releases, security advisories, and license files.
4. Compare adopt, wrap, benchmark, and build-minimally options.
5. Mark unvalidated compatibility, performance, or packaging claims as research-derived.

Dependency decisions must evaluate maintenance, license and redistribution, transitive dependencies, offline operation, telemetry and network behavior, credentials, package size, native components, platform support, security posture, and adapter fit. A popular package is not automatically acceptable.

## 3. Define Acceptance Evidence

Select tests from the failure being prevented. Ask whether the change can:

- Leak data or create an undeclared network path.
- Bypass policy, approval, workspace scope, or a process boundary.
- Lose evidence, citations, audit history, authoritative state, or recovery state.
- Add a purpose-built document subsystem before post-V1 measurements justify it.
- Corrupt an export, package, migration, or platform lifecycle.
- Break a user-visible milestone behavior.

If yes, name the focused test or gate before implementation. If no, prefer the smallest relevant test and avoid broad snapshots or mock-heavy coverage.

## 4. Implement The Minimum Change

Beginning with M1, create a short-lived branch and open a focused pull request for every implementation stage. Do not commit implementation work directly to `main`, and do not begin the next stage until the current stage's pull request is merged or explicitly closed. A milestone may use multiple stage pull requests when its accepted issue scope is divided into independently verifiable responsibilities.

Follow the startup working agreement in [IMPLEMENTATION_STRUCTURE.md](IMPLEMENTATION_STRUCTURE.md):

- Write only what the active gate consumes.
- Keep security boundaries complete even when product breadth is minimal.
- Handle named cases and return a typed unsupported outcome for the rest.
- Add abstractions only for an ADR-mandated seam or a second real implementation.
- Keep policy separate from model output and adapters thin around dependencies.
- Do not add speculative options, plugins, frameworks, or extension points.

If the gate demands disproportionate code, propose reducing the requirement before adding infrastructure around it.

## 5. Verify With Evidence

For an ordinary implementation pull request:

1. Inspect the complete diff and changed-file list.
2. Run the smallest targeted tests that prove the named behavior or invariant.
3. Run `pnpm verify` once M0 creates it.
4. Run additional integration, platform, model, package, or benchmark commands only when the affected boundary requires them.

Run `pnpm test:gate --milestone <n>` only when claiming that milestone's gate is complete. Missing required hardware, models, workers, or packages must be reported as failures or not-run prerequisites, never silent skips.

Windows desktop authority changes require separate standard-user evidence for development and the staged production application: the main executable must remain `asInvoker`, only the fixed setup helper may request UAC, a different credentialed administrator must still add the requesting account, a new sign-in must activate HCS access, and tampered setup bytes must be rejected. macOS evidence must independently prove that no Windows helper, administrator prompt, or elevated launch was introduced.

Windows `desktop:dev` keeps Vite frontend hot reload but passes `--no-watch` to Tauri because NTFS access notifications can otherwise be misclassified as Rust source edits and cause a rebuild loop. Restart the development command after changing Rust desktop-host code. macOS retains Tauri's normal Rust watcher.

Windows development signing uses the disposable current-user identity. A public production build sets `VAULT_WINDOWS_SIGNING_MODE=production` and `VAULT_WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT` to an owner-controlled code-signing certificate in the current-user certificate store; an optional `VAULT_WINDOWS_SIGNING_TIMESTAMP_URL` enables the configured timestamp service. Production mode fails closed when the certificate is missing, lacks its private key, or does not match the requested thumbprint. The recorded signing mode includes that public thumbprint.

### Verification Report

```markdown
## Verification Report

- Changed surfaces:
- Commands passed:
- Commands failed:
- Required checks not run and why:
- Manual checks:
- Remaining risks:
- Conclusion: ready | not ready | blocked
```

Use `not ready` for a fixable incomplete change. Use `blocked` only when progress requires a decision, authority, platform, asset, or external state that is unavailable.

## 6. Self-Review And Handoff

Review findings in this order:

1. Security, privacy, authority, and process boundaries.
2. Active milestone contract and scope.
3. Correctness, evidence, recovery, and user-visible behavior.
4. Minimum-code and dependency discipline.
5. Maintainability and documentation.

Use severities consistently:

- **P0**: immediate data exposure, authority bypass, destructive behavior, or release-blocking security failure.
- **P1**: milestone contract, correctness, recovery, evidence, or approval invariant is broken.
- **P2**: material test, scope, dependency, or maintainability gap that should be fixed before merge.
- **P3**: low-risk clarity or documentation improvement.

When work continues in another session or contributor's branch, produce a handoff:

```markdown
## Handoff

- Objective and current state:
- Changed paths:
- Decisions and source links:
- Commands run and results:
- Failures and attempted fixes:
- Open risks or questions:
- Next concrete action:
```

Do not include secrets, customer content, raw sensitive outputs, private credentials, or hidden model reasoning. Record decisions and evidence, not internal thought processes.

## Pull Request Gate

A pull request is ready for maintainer review only when:

- It links an accepted issue and active milestone.
- The diff contains no unrelated cleanup or speculative scaffolding.
- Required product and security boundaries are preserved.
- Tests and verification results are stated exactly.
- Dependency and redistribution impacts are documented.
- Documentation and audit contracts are updated when behavior changes.
- Unresolved risks and unrun checks are visible.
- Every commit is authored only by its human owner.
- The stage was developed on a short-lived branch and will merge through this pull request, never by a direct implementation push to `main`.

There is no fixed line limit or coverage percentage. Reviewers may ask for a split when a pull request spans unrelated responsibilities or cannot be verified coherently.

## Repository-Local Agent Skills

The optional skills under `.agents/skills/` package this workflow for compatible coding agents:

- `vault-plan-change`
- `vault-review-dependency`
- `vault-verify-change`
- `vault-review-change`
- `vault-handoff`

They are on-demand instructions, not executable hooks. They cannot install dependencies, add network services, mutate external systems, require subagents, broaden permissions, or override [AGENTS.md](../AGENTS.md).

## ECC-Derived Workflow Review

The development-workflow review was informed by [Everything Claude Code](https://github.com/affaan-m/ECC), particularly its research-before-code, explicit verification, reusable-skill, review, and handoff patterns. Vault Desk adopts those ideas in original project-specific wording.

Vault Desk explicitly does not adopt ECC's package, installers, global Codex synchronization, hooks, MCP baseline, memory database, autonomous learning, worktree services, blanket coverage rules, generic architecture defaults, model routing, inference guidance, or runtime components. If substantial ECC material is copied in the future, its MIT license and required notice must accompany the copied material.

## V1 Contribution Activation

External implementation contributions remain closed through the M3 V1 launch unless the owner separately activates them. Beginning with M1, the repository owner develops every stage on a short-lived branch, opens a pull request, keeps each commit small, and leaves the active milestone gate green. Pull-request CI runs when a pull request is opened, reopened, or updated with pushed commits; direct pushes to `main` do not run it. Contribution activation is described in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md#v1-launch-and-contribution-activation).

AI assistants, models, coding agents, and tools are never authors or co-authors. Private vulnerability reporting may be enabled before v1 because it does not open implementation contributions or change milestone scope.

## Revision History

| Date | Change |
|---|---|
| 2026-07-15 | Added the milestone-scoped, research-first, risk-gated implementation and contribution workflow. |
| 2026-07-16 | Activated the M0 workflow and aligned contribution activation with the original v1 gate. |
| 2026-07-20 | Activated M3 Desktop V1, moved document intelligence after launch, and decoupled contribution activation from product certification. |
| 2026-07-17 | Required a branch and pull request for every remaining implementation stage and moved CI from direct pushes to pull-request activity. |
