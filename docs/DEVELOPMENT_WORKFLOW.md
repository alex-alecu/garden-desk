# Development Workflow

Created: 2026-07-15

This is the implementation and contribution workflow for Garden Desk. [AGENTS.md](../AGENTS.md) is authoritative, followed by accepted ADRs, [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), and this document. M3 Offline Dev-Agent Desktop V1 is active; see [M3_STATUS.md](M3_STATUS.md) for current evidence.

## Operating Principles

- Work only inside the active milestone and accepted issue scope. Roadmap presence is not authorization.
- Search the repository and maintained dependencies before writing custom infrastructure.
- Prefer deterministic checks and primary-source evidence.
- Report commands and results exactly; never imply that an unrun check passed.
- Keep agent workflows in development tooling. They are not Garden Desk Core modules or shipped product behavior.

There is no coverage percentage, no test-driven development except for bug fixes, no proactive delegation, and no generic application architecture. The Test Rule in [AGENTS.md](../AGENTS.md) and the milestone gates define what is required.

## 1. Confirm The Scope

Before changing a file, read the current phase in [AGENTS.md](../AGENTS.md), find the active milestone gate in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), and read the ADRs and folder rules in [IMPLEMENTATION_STRUCTURE.md](IMPLEMENTATION_STRUCTURE.md) that the change touches. Stop if the work belongs to an inactive milestone and offer an issue, design note, or plan instead. The `garden-desk-plan-change` skill produces the short change brief.

## 2. Research First

Inspect the relevant source, tests, schemas, adapters, and recent history. Check whether the capability already exists. For a dependency decision use official documentation, package metadata, source, releases, advisories, and license files, and run the `garden-desk-review-dependency` skill; a popular package is not automatically acceptable. Mark unvalidated compatibility, performance, or packaging claims as research-derived.

## 3. Implement The Minimum Change

Create a short-lived branch and open a focused pull request for every stage. Do not start the next stage until the current pull request is merged or closed.

- Write only what the active gate consumes and keep security boundaries complete.
- Treat the no-network microVM and read-only `/source` mount as the primary containment for guest-authored commands and hostile files. Do not add security checks for command text, URLs, content, formats, or guest-only paths inside that boundary.
- Add validation only at a host authority crossing and only when an active product contract requires it.
- Handle named cases and return a typed unsupported outcome for the rest.
- Add an abstraction only for an ADR-mandated seam or a second real implementation.
- Keep policy separate from model output and adapters thin around dependencies.
- Apply the Test Rule: bug fixes start with one failing reproduction test (`garden-desk-fix-bug` skill); everything else is implemented first and gets at most one focused test.

If the gate demands disproportionate code, propose reducing the requirement before adding infrastructure around it.

## 4. Verify

For an ordinary pull request run:

```sh
pnpm lint && pnpm typecheck && pnpm test
```

plus the one targeted test the change added, if any. `pnpm verify` is the release check (source limits, lint, typecheck, native builds, Rust lint, and the `unit` and `native` Vitest projects) and runs in CI. The `platform` and `m2-native` projects are not in it: run `pnpm test:platform:gate` or `pnpm test:native:m2` when the change touches that boundary, and run `pnpm verify` locally only for native helper, build script, or packaged runtime changes. Run `pnpm test:gate --milestone <n>` and the platform, model, or package commands only when claiming that milestone's gate. Missing hardware, models, workers, or packages are reported as not run, never as passed.

The `garden-desk-verify-change` skill produces the verification report. Report `not ready` for a fixable incomplete change and `blocked` only when progress needs a decision, authority, platform, or asset that is unavailable.

## 5. Review And Hand Off

Review findings in this order: security, privacy, authority, and process boundaries; active milestone contract and scope; correctness, evidence, recovery, and user-visible behavior; minimum-code and dependency discipline; maintainability and documentation.

Severities:

- **P0**: data exposure, authority bypass, destructive behavior, or release-blocking security failure.
- **P1**: broken milestone contract, correctness, recovery, evidence, or approval invariant.
- **P2**: material test, scope, dependency, or maintainability gap to fix before merge.
- **P3**: low-risk clarity or documentation improvement.

The automated GitHub review follows [REVIEW.md](../REVIEW.md); its CRITICAL, WARNING, and SUGGESTION map to P0-P1, P2, and P3.

Use the `garden-desk-review-change` skill for a review and the `garden-desk-handoff` skill when work continues elsewhere. Never include secrets, customer content, raw sensitive outputs, or hidden model reasoning in a report.

## Pull Request Gate

A pull request is ready for review when it links the active milestone and issue, contains no unrelated cleanup or speculative scaffolding, preserves product and security boundaries, states verification results exactly, documents dependency and redistribution impact, updates contracts and authoritative documentation when behavior changes, and is authored only by its human owner. Reviewers may ask for a split when a pull request spans unrelated responsibilities.

## Real-Model Reproduction

Use the real Gemma worker and no-network guest when diagnosing agent-loop behavior; a fake inference test or desktop-only reproduction is not sufficient evidence. Raw development inference diagnostics are private and must not enter reports, product records, debug snapshots, user-interface data, or Git.

During `pnpm desktop:dev`, the terminal shows WebView console output, unhandled WebView errors, and Garden Desk Core process output. This development-only stream is not stored and must not include prompts, messages, tool payloads, hidden reasoning, or file contents.

- Run `pnpm test:m3:macos` on physical Apple silicon for the canonical headless M3 gate. It verifies the pinned Gemma 4 model, real multi-step Python tasks, artifacts, guest isolation, timeout, and output limits without the desktop UI; guest Node.js coverage is the direct-source probe only.
- For a task-specific daemon reproduction, create an ignored script under `packages/eval/.generated/`. Use `createGardenDeskCore` with `packages/eval/.generated/models`, the generated macOS helper, and `packages/workers/images`; start the real current-user server with `startDaemon`; then call it through `packages/cli/src/client.ts` using `folders.add`, `sessions.create`, `agent.start`, and repeated `agent.get` requests until the run is terminal.
- Put the ephemeral workspace directly under `/tmp` so the macOS Unix-socket path stays within its length limit. If the restricted shell returns `listen EPERM` or denies Virtualization.framework, rerun the same command outside the restricted shell; that sandbox denial is not a product failure.
- Capture the terminal run state, error, response, and complete ordered events, including generated code, stdout, stderr, and termination. Reproduce once before editing and rerun the identical fixture and task after the fix.
- Keep models, generated helpers, guest images, reproduction scripts, fixtures, and workspaces uncommitted. After the focused reproduction passes, run `pnpm test:m3:macos` and `pnpm verify`; report Windows evidence separately and never infer it from macOS.
- After a real golden-task run, report the pass count (`golden: N/4 passed`) to the owner.

Development inference diagnostics live in [packages/eval/src/gates/development-inference.ts](../packages/eval/src/gates/development-inference.ts).

## Platform Notes

- Windows desktop authority changes need separate standard-user evidence for development and the staged production application: the main executable stays `asInvoker`, only the fixed setup helper may request UAC, a different credentialed administrator must add the requesting account, a new sign-in activates HCS access, and tampered setup bytes are rejected. macOS evidence must independently show that no Windows helper, administrator prompt, or elevated launch was introduced.
- Windows `desktop:dev` keeps Vite hot reload but passes `--no-watch` to Tauri because NTFS access notifications can be misread as Rust source edits and cause a rebuild loop. Restart the development command after changing Rust desktop-host code. macOS keeps Tauri's normal Rust watcher.
- Windows development signing uses the disposable current-user identity. A public production build sets `GARDEN_DESK_WINDOWS_SIGNING_MODE=production` and `GARDEN_DESK_WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT` to an owner-controlled code-signing certificate in the current-user store; optional `GARDEN_DESK_WINDOWS_SIGNING_TIMESTAMP_URL` enables a timestamp service. Production mode fails closed when the certificate is missing, lacks its private key, or does not match the thumbprint.

## Agent Skills

The skills under [.agents/skills](../.agents/skills) package this workflow for Codex and Claude Code. See [.agents/skills/README.md](../.agents/skills/README.md).

## Attribution

The workflow review was informed by [Everything Claude Code](https://github.com/affaan-m/ECC) (research-before-code, explicit verification, reusable skills, review, and handoff). Garden Desk uses original wording and does not include ECC's package, installers, hooks, MCP baseline, memory database, autonomous learning, worktree services, coverage rules, model routing, or runtime components. If substantial ECC material is ever copied, its MIT license and notice must accompany it.

## Contribution Activation

External implementation contributions stay closed through the M3 V1 launch unless the owner activates them separately. Pull-request CI runs on pull request activity; direct pushes to `main` do not run it. Activation is described in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md#v1-launch-and-contribution-activation). Private vulnerability reporting may be enabled before v1.
