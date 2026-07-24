# Implementation Structure

Updated: 2026-07-24

This blueprint accompanies [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). M0, M1, and M2 source exists, and the M3 macOS implementation is complete. M3 remains active for its Windows product integration and cross-platform launch gate. Paths not yet present remain authority, not evidence of implementation.

## Startup Working Agreement

1. Write the minimum clear code that passes the active M3 gate.
2. Preserve the no-NIC, read-only-host, typed-IPC, current-user-RPC, audit, cancellation, and recovery boundaries completely.
3. Implement only the generic agent and desktop flows named by M3.
4. Return one typed unsupported result for cases outside the gate.
5. Add a second abstraction or option only when two current implementations require it.
6. Keep product logic in TypeScript/Node. Rust and Swift own only OS capabilities.
7. Do not create the post-V1 document-intelligence folders before that follow-up is activated.

## Dependency Direction

```text
desktop webview -> typed Tauri commands -> Vault Core daemon
Vault Core -> shared contracts + injected ports
worker clients -> shared contracts
native helpers -> OS capability only
guest entrypoint -> shared wire format generated or mirrored from the versioned schema
```

`@vault/shared` depends only on Zod. `@vault/core` never imports private worker files. Production adapter binding occurs in `core/compose.ts`. The desktop never imports Core or worker implementation code.

## Existing Repository

```text
packages/shared/   versioned M0-M2 contracts
packages/core/     workspace, audit, jobs, daemon, policy, inference supervision
packages/workers/  native inference, microVM launchers, guest image, helpers
packages/cli/      current daemon health client
packages/eval/     fixtures and milestone gates
```

Existing M0-M2 paths remain unless M3 replaces a provisional harness with product coverage.

## M3 Package Shape

### `packages/shared`

Add only:

```text
src/folders.ts       opaque grant identity and display metadata
src/sessions.ts      session, turn, draft, pagination, attachment metadata
src/agent.ts         task, observable event, completion request, result, artifact
src/desktop.ts       narrow desktop command/result contracts
```

The agent contract preserves the M1 probe at protocol v1 and uses agent protocol v3 for ordered execution frames. It bounds code, observations, stdout, stderr, typed VM diagnostics, artifacts, turns, and completion payloads.

### `packages/core`

Add only:

```text
src/folders/grants.ts        canonical folder grants and revocation
src/sessions/sessions.ts     sessions, newest-five query, cursor expansion, turns, drafts
src/sessions/attachments.ts  explicit-file staging for New chat
src/agent/loop.ts            bounded Core-owned agent orchestration
src/agent/guest.ts           CodeAgentPort consumed by the loop
src/agent/events.ts          observable event persistence and polling/streaming
src/diagnostics/             private read-only session snapshot adapter and process mode
workspace/migrations/        M3 folder/session/agent tables
```

Extend existing files:

```text
src/facade.ts          M3 programmatic commands and queries
src/compose.ts         production session and guest adapters
src/daemon/methods.ts  M3 JSON-RPC dispatch
src/daemon/main.ts     daemon startup plus the isolated packaged diagnostic mode
src/policy/policy.ts   folder/attachment/agent-run decisions
src/audit/log.ts       M3 observable security events
```

No generic repository, service locator, event bus, plugin registry, or workflow framework is added.

### `packages/workers`

Add only:

```text
src/microvm/agent/client.ts       host CodeAgentPort implementation
src/microvm/agent/frames.ts       typed agent frame codec
src/microvm/guest/agent.ts        guest task and completion loop
images/agent/                      reproducible image recipe and manifest
```

Extend the platform launchers to start an `agent` guest role in addition to the existing probe role. Platform helpers continue to own only VM lifecycle, fixed typed socket transport, the live read-only folder share, immutable attachments, bounded workspace resources, limits, and teardown.

The guest image contains Python, Node.js, `/bin/sh`, BusyBox commands, the reviewed fixed library set, and the guest entrypoint. It contains no runtime package installation or network configuration. Generated images remain ignored artifacts.

### `packages/desktop`

Create the product package when its reviewed dependencies are pinned:

```text
package.json
tsconfig.json
index.html
src/main.tsx
src/app.tsx
src/api.ts                 typed Tauri command adapter
src/desktop-actions.ts     narrow desktop workflow calls
src/state.ts               plain React reducer
src/styles.css
src/components/chat-header.tsx
src/components/sidebar.tsx
src/components/session-list.tsx
src/components/conversation.tsx
src/components/technical-details.tsx
src/components/composer.tsx
src/components/confirmation.tsx
src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/build.rs
src-tauri/tauri.conf.json
src-tauri/capabilities/default.json
src-tauri/src/main.rs      dialogs, exact sidecar, connection bootstrap only
src-tauri/src/diagnostics.rs fixed packaged-sidecar snapshot and reveal commands
```

Plain React state is sufficient. Do not add a router, component library, CSS framework, state-management package, webview filesystem plugin, shell permission, HTTP plugin, updater, analytics, or crash reporter for V1. The Rust host may use the reviewed shell plugin only for fixed supervision of the exact packaged Core sidecar.

### `packages/cli`

Retain only the existing daemon health client:

```text
vault status --workspace <directory> [--json]
```

The CLI does not create session snapshots. The private Core diagnostic adapter is available to the installed desktop only through the exact packaged sidecar; the webview supplies a session ID and cannot supply a catalog or reveal path.

### `packages/eval`

Add behavior-level gates:

```text
src/gates/m3-sessions.test.ts
src/gates/m3-agent.test.ts
src/gates/m3-desktop.test.ts
src/gates/m3-package.test.ts
src/gates/m3-platform.ts
src/fixtures/agent-tasks.ts
```

Deterministic fakes cover UI and state. The M3 gate uses the real daemon, inference worker, guest image, platform microVM, and packaged app.

## Persistence Ownership

The existing workspace catalog remains the one authoritative database. M3 adds normalized records for:

- Folder grants.
- Sessions and folder/global membership.
- Turns and drafts.
- Attachment identities and immutable staged bytes.
- Agent runs, terminal state, observable events, and bounded numeric response-performance evidence.
- Normalized execution attempts with identity, ordering, source or command, terminal evidence, 1 MB stdout, 1 MB stderr, 256 KiB allowlisted VM diagnostics, truncation flags, and recovery timestamps. Catalog migration v7 backfills historical execution events.
- Versioned inference turns linked to runs, with prompt, schema, and pre-parse structured-result content hashes; worker request metadata; decision outcomes; execution links; and recovery timestamps. Catalog migration v8 leaves historical runs explicitly unrecorded.
- Generated artifact metadata and immutable bytes accepted from guest scratch.
- Session-scoped content-addressed workspace manifests stored under the private `.vault` state root.

The newest-five sidebar query is ordered by last activity plus stable ID. Expansion uses an opaque stable cursor. Removing a grant does not delete session history or host files.

## Guest Library Manifest

One machine-readable manifest records each guest runtime/library name, exact version, source, license, notice obligation, hash, and reason. The first set should be limited to the smallest reviewed combination that covers text, JSON, CSV, SQLite, PDF, DOCX, XLSX, and common image inspection.

The library manifest, generated executable capabilities manifest, guest build recipe, compliance inventory, package resources, and Technical details language change together. Libraries are not added because they might be useful.

## Source Limits

The existing source-limit gate remains authoritative. Prefer files below 300 lines, functions below 40 lines, cognitive complexity at or below 10, and four or fewer parameters. Generated bindings and lockfiles are excluded; native capability code is reviewed manually even where the TypeScript tripwire does not apply.

## What M3 Does Not Create

- Canonical document schemas or parser adapters.
- OCR, layout, retrieval, vector index, citation, or verifier modules.
- Vertical workflow state machines.
- A generic host shell or terminal.
- Host write or export authority for the guest.
- Network broker or external integrations.
- Runtime package installation.
- OpenCode or another agent framework dependency without a separate review.
- Model download, updater, or alternate model runtime.
- Knowledge Bundle import.
- Multi-user or office administration.

## Revision History

| Date | Change |
|---|---|
| 2026-07-13 | Created the original milestone-to-folder blueprint. |
| 2026-07-20 | Replaced the former pre-product blueprint with the M3 generic offline dev-agent desktop structure. |
| 2026-07-23 | Added protocol-v3 live execution frames, catalog-v7 normalized execution records, and Overview-first Technical details logs. |
| 2026-07-24 | Added catalog-v8 content-addressed inference-turn traces and the Core-only read diagnostic. |
| 2026-07-24 | Added the read-only local session debug snapshot over existing catalog and content-addressed stores. |
| 2026-07-22 | Added the model header and persisted response-performance evidence surfaces. |
| 2026-07-23 | Added the session-scoped guest lifecycle, live read-only source share, and persistent workspace boundary. |
| 2026-07-24 | Moved the debug snapshot adapter into Core and limited installed-app creation and reveal to fixed Tauri commands. |
