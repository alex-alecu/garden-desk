# Review instructions

Vault Desk is a local, offline-first desktop agent: a Tauri v2 and React frontend,
a Node.js Vault Core backend, a no-NIC microVM for agent-authored code, and a
confined native inference worker. The model is untrusted for execution decisions.
Reviews must protect those boundaries first and code quality second.

## Review lenses

Split the review into four independent lenses. Every finding agent adopts exactly
one lens, reviews the whole diff through it, and tags each finding with the lens
name in the first line of the comment (`[security]`, `[business-logic]`,
`[performance]`, `[clean-code]`). Do not let one lens absorb another's findings;
if a finding fits two lenses, report it once under the more severe one.

### Security lens

Goal: prove the diff does not weaken an isolation, authorization, privacy, or
evidence boundary.

- Any path where model output, guest output, or document content reaches a host
  shell, an unscoped filesystem operation, a network call, or an unvalidated RPC
  argument is Important. Command, URL, domain, or path string matching is never
  isolation; only the typed adapters and the no-NIC microVM are.
- Actions must stay validated, authorized, previewed, executed, logged, and
  reversible through typed tool boundaries. A new tool or RPC that skips
  validation, audit, or approval gating for destructive actions is Important.
- Native helpers under `packages/core/native/`, `packages/workers/native/`, and
  `packages/desktop/native/` may own only their named OS capability, lifecycle,
  limits, scoped attachment access, typed transport, and teardown. Product
  policy, filesystem authorization, network brokering, parsing, or workflow
  logic moved into Rust or Swift is Important.
- Raw native-helper stderr, raw inference diagnostics, prompts, or customer
  document content entering reports, debug snapshots, UI data, logs, or
  committed files is Important.
- Any telemetry, cloud call, silent cloud fallback, or unpinned download is
  Important, even behind a flag.
- Audit records and persisted state must keep stable, hash-chained, replayable
  shapes; a change that breaks chain verification or recovery is Important.

### Business-logic lens

Goal: confirm the agent loop, session, workspace, and evidence contracts still
do what the product promises.

- Verify the agent run state machine: every run must reach a terminal state,
  cancellation must reach a live guest execution, and interrupted runs must
  recover after a Core restart.
- Check shared contracts in `packages/shared` against every consumer (Core, CLI,
  desktop, eval). A schema, event, or RPC change with an unupdated consumer,
  fixture, or test is Important.
- Check milestone scope: M0-M2 contracts are frozen and M3 is the active
  milestone. Work that starts post-V1 scope or changes a completed-milestone
  contract without the diff saying so is Important.
- Check documentation consistency: when behavior, defaults, commands, or
  contracts change, the matching text in `AGENTS.md`, `docs/IMPLEMENTATION_PLAN.md`,
  `docs/M3_STATUS.md`, and other authoritative docs must change in the same PR.
  A statement in those files that the diff makes false is a Nit; a claim of
  platform evidence that the diff cannot support is Important.
- Platform evidence is never inferred across platforms. A macOS result stated
  as Windows evidence, or a fake-inference test presented as real-model
  evidence, is Important.

### Performance lens

Goal: catch regressions in inference budget, guest resource use, and UI
responsiveness on 12-16 GB consumer hardware.

- Flag unbounded growth: prompt or context assembly without a token budget,
  event or message arrays that never compact, unbounded stdout/stderr capture,
  or workspace writes that ignore the 128 MiB guest limit.
- Flag work on the hot path of a model turn or streaming update that is
  synchronous, blocking, quadratic, or re-reads files it already holds.
- Flag guest or worker lifecycle changes that leak a VM, process, socket, or
  capacity lease, or that bypass the RAM-derived LRU pool.
- Flag React renders that re-render the full conversation on every stream
  chunk, or persistence writes on every keystroke.
- Only report a performance finding when you can point to the specific loop,
  allocation, or await that regresses; do not speculate from names.

### Clean-code lens

Goal: keep new source small, hand-editable, and inside the repository limits.

- Files above 300 lines, functions above 40 lines, cognitive complexity above
  10, or more than four parameters in new or changed TypeScript are Nits;
  `pnpm check:source` enforces the tripwire, but review native Rust and Swift by
  hand against the same limits.
- Flag speculative abstractions, unused extension points, boolean flag
  arguments that hide two behaviors, mixed command and query functions, and
  duplicated logic that should be removed rather than parameterized.
- Flag new or changed tests that assert private implementation details,
  framework wiring, or unsupported scenarios instead of behavior and
  invariants. Missing focused tests for a security, authorization, evidence,
  recovery, or cross-platform invariant is Important, not a Nit.
- Flag comments that restate code or stale names left after a rename.

## What Important means here

Reserve Important for findings that break an isolation or authorization
boundary, leak private data, corrupt audit or persisted state, break recovery,
misstate platform evidence, or break a shared contract for a consumer. Style,
naming, size limits, and refactoring suggestions are Nit at most.

## Verification bar

Every finding cites `file:line` in the diff or surrounding source. Behavior
claims about the agent loop, policy, or guest transport must be traced through
the actual call path, not inferred from names. Do not report a violation of a
rule you cannot quote from this file, `AGENTS.md`, or an accepted ADR.

## Cap the nits

Report at most six Nits per review, preferring clean-code and documentation
consistency findings. Say "plus N similar items" in the summary for the rest.

## Do not report

- Anything `pnpm verify` already enforces: Biome lint and formatting, TypeScript
  errors, Rust clippy and rustfmt, and source-limit failures that CI will fail.
- Lockfiles, `.generated/` content, `dist/`, `target/`, Tauri `gen/` or
  `binaries/`, and pinned dependency or toolchain version bumps.
- Prose-only edits in `docs/research/`, `docs/strategy/`, and `site/`, unless
  they claim current behavior or evidence that the code does not support.
- Test-only code that intentionally violates production rules, and
  intentionally minimal implementations that return an explicit unsupported
  outcome instead of handling a hypothetical case.
- Missing AI attribution in commits; it is prohibited by policy.

## Re-review convergence

After the first review of a PR, post Important findings only unless the new
push adds a new file or a new public contract.

## Summary shape

Open the review body with one line per lens, for example
`security 0, business-logic 1 important, performance 0, clean-code 3 nits`.
If nothing is Important, lead with "No blocking issues."
