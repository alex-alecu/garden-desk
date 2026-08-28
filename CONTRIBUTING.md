# Contributing To Garden Desk

Thank you for helping build Garden Desk. Contributions must preserve the project's local-first privacy model, evidence requirements, approval boundaries, and deliberately small implementation.

## Current Contribution Status

Garden Desk does not invite external implementation pull requests before its v1 launch. Beginning with M1, the repository owner develops each implementation stage on a short-lived branch and merges it through a pull request. External contributions open when v1 ships and the contribution workflow in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) is activated.

Until the v1 launch:

- Open an issue to propose an implementation, architecture change, or documentation correction.
- Do not submit application code, manifests, build configuration, scripts, generated assets, or dependency changes.
- Do not treat an unassigned milestone or roadmap item as authorization to implement it.

After the v1 launch, implementation issues will be advertised with the `ready-for-contribution` label. Work only from one of those issues or from an issue that a maintainer has explicitly accepted.

## Before Starting

1. Read [AGENTS.md](AGENTS.md), which is the authoritative repository instruction file.
2. Read the active milestone in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
3. Read [docs/DEVELOPMENT_WORKFLOW.md](docs/DEVELOPMENT_WORKFLOW.md) and the architecture decision records relevant to the change.
4. Confirm that the issue names the product contract, allowed scope, and acceptance evidence.
5. Search the repository and maintained dependencies before proposing new infrastructure.

Security or architecture boundary changes require issue discussion and an accepted or superseding architecture decision record before implementation. A pull request must not silently reopen an accepted boundary.

## Development Workflow

Use a short-lived, focused branch and open a pull request for every implementation stage. Do not push implementation commits directly to `main`. There is no required branch-name prefix, but the name should identify the change clearly.

Each implementation change follows this sequence:

1. Confirm the active milestone and allowed scope.
2. Inspect existing contracts and research maintained solutions using primary sources.
3. Implement the smallest clear change that passes the gate and apply the Test Rule in [AGENTS.md](AGENTS.md#test-rule): a bug fix starts with one failing reproduction test; anything else is implemented first and gets at most one focused test.
4. Run `pnpm lint && pnpm typecheck && pnpm test`; CI runs the full `pnpm verify`. Run a milestone gate only when closing that milestone.
5. Self-review the diff and record remaining risks or an explicit handoff.

## Commit Authorship And DCO

When contributions open at the v1 launch, every commit must be authored by the human contributor and certified under the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Add a matching sign-off with:

```text
git commit -s
```

The resulting commit message must include:

```text
Signed-off-by: Your Name <your-email@example.com>
```

Human co-authors may be credited. An AI assistant, model, coding agent, or tool must never be named as an author or co-author, and commit messages and pull request descriptions must not contain generator attribution such as `Generated with ...`.

Use Conventional Commit subjects such as `feat(core): ...`, `fix(parser): ...`, `test(policy): ...`, or `docs(workflow): ...`. Explain why the change is necessary in the body when the subject is not sufficient.

## AI-Assisted Contributions

AI assistance is permitted, but the human contributor remains responsible for every submitted line and claim. The contributor must:

- Understand the change and be able to explain it.
- Verify generated code, documentation, citations, licenses, and commands.
- Prevent customer documents, secrets, private prompts, hidden model reasoning, and employer-owned or proprietary material from entering the repository.
- Report exactly what was verified and what was not.
- Follow the same review and DCO requirements as any other contribution.

AI-generated output never supplies permission, authorship, provenance, or evidence by itself.

## Dependencies And External Material

New or changed dependencies require a written review of:

- Existing in-repository alternatives.
- Maintenance and release posture.
- License, redistribution, notices, and transitive dependencies.
- Offline behavior, telemetry, network requirements, and credential access.
- Package footprint, native components, supported platforms, and supply-chain risk.
- Fit behind the documented adapter boundary.

Use official documentation, registries, source repositories, and license files. Mark behavior or suitability as research-derived until Garden Desk validates it. Do not copy substantial external text or code without preserving the required license and notice.

Never contribute customer documents, confidential data, employer-owned work, private credentials, model files without approved redistribution status, or third-party fixtures without documented rights.

## Pull Requests

Keep each pull request tied to one accepted issue and one independently verifiable stage within the active milestone. Do not begin the next stage until the current pull request is merged or explicitly closed. The pull request body states:

- What changed and what was intentionally left out.
- The exact verification commands and their results, and what was not run and why.
- Product or security boundaries touched and dependency, licensing, or packaging impact, when any.

External pull requests require maintainer review. Pull requests use squash merging after required checks and review are complete. Review conversations must be resolved before merge.

## Security Reports

Do not publish vulnerability details in an issue. Follow [.github/SECURITY.md](.github/SECURITY.md) and use GitHub private vulnerability reporting once it is enabled.
