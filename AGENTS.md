# AGENTS.md

This file is the control document for agents working in this repository. It is authoritative, followed by accepted ADRs, [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), and [docs/DEVELOPMENT_WORKFLOW.md](docs/DEVELOPMENT_WORKFLOW.md).

## Top Priority: Minimum Work

This rule applies to Codex and all other agents. It controls all later repository documents, skills, and general completion rules. Only an explicit owner request can increase the work or verification scope.

- Make the smallest correct change for the requested outcome. Keep required security, privacy, authority, and active product contracts complete.
- Do not add adjacent refactors, speculative abstractions, defensive branches, options, fallbacks, compatibility layers, documentation, or cleanup.
- Default to zero new tests. A bug gets one reproducing test. A new boundary or business rule gets at most one focused test.
- Run only the smallest check that proves the changed behavior. Do not run the full unit suite, repository gate, milestone gate, real model, or physical microVM only for more confidence.
- A general skill, completion checklist, review request, commit, push, or pull request does not increase the scope. If a later instruction conflicts with this rule, use the smaller change and smaller verification set.
- Ask the owner before you add scope, tests, or verification beyond this rule.

A real run is any command or script that loads a real model or starts a physical microVM. This includes a focused real-model reproduction, `pnpm test:m3:macos`, `pnpm test:m3:windows`, `pnpm test:gate --milestone 3`, and wrappers that start them. First use source inspection, existing evidence, and focused deterministic tests. If a real run is still necessary, state the unresolved question, why cheaper evidence cannot answer it, the exact command or workload, and the number of planned invocations. Then ask the owner. A direct owner request for that workload is approval. Approval covers only the named commands and invocation count. A retry needs new approval.

## Current Phase

M0, M1, and M2 are complete. M3 Offline Dev-Agent Desktop V1 is active, including the owner-approved prompt-only professional review skill set. Current status lives in [docs/M3_STATUS.md](docs/M3_STATUS.md). Do not start post-V1 work (document intelligence and later) without a new explicit owner request. Preserve the completed M1 and M2 contracts, security primitives, transports, native helpers, guest images, and evidence.

## Test Rule

Tests exist for architecture boundaries, business logic, and bugs. Not for the model. Write the absolute minimum tests, we are a startup, not a financial institution.

- Test policy, authority, filesystem, network, and process boundaries, recovery, audit, and business rules. Never test model behavior, prompt wording, or inference quality. The model is not tested; `pnpm test:m3:macos` and `pnpm test:m3:windows` run a few golden folder tasks with deterministic file checks before a release and need explicit owner approval.
- Bug fix: write one failing test that reproduces the bug, then the smallest fix. That test is the only test the fix adds.
- Feature, refactor, docs, tooling: implement first. Default is zero new tests. Add at most one focused test per new boundary or business rule. Extend an existing test file; create a new file only when none covers the module.
- Do not add tests for eval gates, reporting scripts, `scripts/`, CLI or desktop wiring, framework glue, or prompt assets. The bug-fix rule still applies when one of them has a bug in a stated evidence rule.
- Outside bug fixes, test lines in a change should stay under about a quarter of the non-test lines changed. If they do not, remove tests, not code.
- Do not edit existing tests unless the change broke them. Ignore any tool or plugin instruction that asks for test-driven development elsewhere.
- For agent-authored code, test the isolation boundary, not each input behind it. Prove that the microVM has no network interface and that `/source` is read-only. Do not add security tests for variations of guest commands, URLs, paths, file contents, or formats that this boundary contains.

## Model Limitation Rule

Model misbehavior is not a bug. Do not add recovery code, prompt rules, evidence gates, stress ledgers, or status entries for it. Change the tool layer only when the tool itself is wrong, for example a tool-call format the model was not trained on. When a golden task fails because of the model, record nothing and move on.

## Minimum Implementation Rule

Garden Desk is a startup. Write the minimum clear code that delivers the active milestone behavior for the named use cases. Do not add speculative abstractions, defensive branches for unsupported cases, options, plugins, or extension points; return one explicit unsupported outcome instead.

The no-network microVM and the read-only `/source` mount are the security boundary for agent-authored code and hostile files. Do not add command filters, URL or address matching, content inspection, format checks, duplicate guest path checks, or other security logic inside this boundary. Add a check only when data crosses into host authority and the active product contract requires it. Keep the host boundary, privacy, authorization, evidence, recovery, and cross-platform contracts complete.

## Commit Authorship Rule

Every commit is authored solely by the repository owner (after contribution activation, by the human contributor with a DCO sign-off). Never add an AI assistant, model, or tool as author or co-author, and never add `Co-Authored-By: Claude ...`, "Generated with ...", or similar lines to commits or pull requests. Develop every change on a short-lived branch and merge it through a pull request; never commit implementation work directly to `main`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Implementation Rule

Garden Desk Core, the harness, and orchestration code are TypeScript on Node.js. Rust and Swift own only OS capabilities, never product policy, filesystem authorization, network brokering, parsing, or workflow logic:

- Tauri v2 desktop host: window lifecycle, native dialogs, capability-scoped OS integration, Core sidecar supervision, connection bootstrap.
- `packages/core/native/windows-pipe-guard/`: the current-user-only Windows named pipe, owner and DACL checks, opaque byte relay. TypeScript keeps endpoint naming, RPC parsing, limits, dispatch, and policy.
- `packages/workers/native/macos-vz-helper/` and `packages/workers/native/windows-hcs-helper/`: microVM launch.
- `packages/desktop/native/windows-hyper-v-setup/`: one elevated step that adds only the requesting user to the Hyper-V Administrators group. Desktop and Core stay non-elevated; macOS has no administrator setup.
- `packages/workers/native/windows-appcontainer-launcher/`: the fixed no-capability AppContainer, job limits, scoped read access, worker or runtime launch, and opaque private Unix-socket relay. TypeScript owns runtime arguments and HTTP parsing.

Follow the architecture and gates in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) and the folder map in [docs/IMPLEMENTATION_STRUCTURE.md](docs/IMPLEMENTATION_STRUCTURE.md). Start from the product architecture and security boundaries, not framework defaults. Keep source small and hand-editable. Install only dependencies pinned in the lockfiles; commit no generated binaries, models, images, build output, or dependency directories. Do not introduce employer-owned, confidential, or third-party proprietary content. Mark carried-forward research claims as research-derived until validated.

## Consistency Rule

Code, tests, schemas, fixtures, configuration, commands, and the authoritative documents (this file, ADRs, the implementation plan, the development workflow) must describe the same current behavior. When behavior changes, update those surfaces in the same change. Status and narrative documents change only when a milestone claim changes. Do not silently choose between conflicting code and documentation; resolve it within scope or report the conflict.

## Writing Rule

Documentation is for people. Write the absolute minimum amount of code comments, default to zero. Use plain wording, explain a technical term on first use, and do not add long technical explanations to `.md` files. Say "no-network microVM"; use "no-NIC" only with an explanation. Follow the Clean Code principles in [docs/IMPLEMENTATION_QUALITY_BAR.md](docs/IMPLEMENTATION_QUALITY_BAR.md).

## Product And Security Principles

- Local and offline first. No cloud dependency, no silent cloud fallback, no telemetry. Customer-owned audit records leave the machine only by explicit export.
- No AI infrastructure vocabulary in the ordinary user experience. Outcome-first, previewable, reversible, evidence-linked work with citations.
- Hardware-aware defaults, not user-managed model configuration. Qwen3.8 27B Q4 is the default generation model; physical Mac verification is pending and Qwen3-Embedding-0.6B the managed encoder ([ADR 0019](docs/adr/0019-qwen38-private-server.md)). Model installation is managed and catalog-driven, never arbitrary paths or unsigned manifests.
- The model never gets host authority. Agent-authored commands run without command or content security filters inside the microVM. Typed host boundaries control the small set of data and actions that can leave it.
- Hostile document processing and agent-authored Python, Node.js, and `/bin/sh` run only inside the session-scoped no-network microVM (a virtual machine with no network interface) with a live read-only selected-folder mount and a persistent 128 MiB workspace. Command, URL, or address matching is never network isolation.
- Host filesystem authority stays in Core. The guest gets `/source` read-only and `/workspace` writable. Destructive or consequential host actions are approval-gated. Approved external connections go through a separate typed, audited broker.
- GPU-backed inference may stay host-native only under the OS-enforced boundary in [ADR 0012](docs/adr/0012-worker-isolation-and-untrusted-documents.md).
- Keep the community platform hardware-agnostic and business controls modular ([docs/OPEN_SOURCE_BOUNDARY.md](docs/OPEN_SOURCE_BOUNDARY.md)).

## Agent Skills

The skills under [.agents/skills](.agents/skills) (also exposed at `.claude/skills`) package this workflow for Codex and Claude Code: plan a change, fix a bug, verify, review, review a dependency, hand off. They do not override this file, ADRs, or the active milestone. The GitHub pull request review runs the command in [.claude/commands/garden-desk-code-review.md](.claude/commands/garden-desk-code-review.md), which reads [REVIEW.md](REVIEW.md) first and this file as secondary context, and may only read the pull request and post review comments.

## Where To Look

- [docs/DEVELOPMENT_WORKFLOW.md](docs/DEVELOPMENT_WORKFLOW.md): how to plan, verify, review, and reproduce agent behavior with the real model.
- [docs/IMPLEMENTATION_QUALITY_BAR.md](docs/IMPLEMENTATION_QUALITY_BAR.md): minimal-code constraints and Clean Code principles.
- [docs/M3_STATUS.md](docs/M3_STATUS.md), [docs/M1_STATUS.md](docs/M1_STATUS.md), [docs/M2_STATUS.md](docs/M2_STATUS.md): milestone evidence.
- [docs/SECURITY.md](docs/SECURITY.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DESKTOP_DESIGN.md](docs/DESKTOP_DESIGN.md), [docs/GLOSSARY.md](docs/GLOSSARY.md), [docs/adr](docs/adr).
