# Architecture

Updated: 2026-08-04

Vault Desk V1 is a local desktop application with three isolated layers: a thin Tauri interface, an authoritative Node.js control plane, and session-scoped no-NIC agent microVMs plus a narrow host-native inference worker.

## System Shape

```text
┌───────────────────────────────────────────────────────────────┐
│ Tauri v2 desktop                                              │
│ React webview + minimal Rust host + native dialogs            │
└──────────────────────────┬────────────────────────────────────┘
                           │ typed commands / local RPC
┌──────────────────────────▼────────────────────────────────────┐
│ Vault Core                                                   │
│ grants · sessions · jobs · policy · audit · model mediation  │
│ limits · recovery · worker supervision                       │
└───────────────┬──────────────────────────────┬────────────────┘
                │ typed inference IPC          │ typed VM IPC
┌───────────────▼──────────────┐  ┌────────────▼────────────────┐
│ Native inference worker     │  │ Session agent microVM       │
│ approved model only         │  │ zero NICs · immutable root  │
│ no tools/workspace/network  │  │ live read-only /source     │
└──────────────────────────────┘  │ durable /workspace · shell │
                                  └─────────────────────────────┘
```

## Desktop Plane

The first desktop uses Tauri v2 with React and TypeScript. The Rust host owns only window lifecycle, native dialogs and granted-folder opening, exact Vault Core sidecar startup, and connection bootstrap.

The webview receives no generic shell, process launcher, environment reader, network client, local-endpoint selector, or unrestricted filesystem API. It works with opaque folder, session, attachment, job, and artifact identifiers through narrow typed commands.

The sidebar's Chats section begins with New chat and then recent global sessions. Its Folders section begins with Add folder and then folder groups. Each folder group exposes its newest five sessions, cursor-based expansion, and a folder icon that asks the native shell to open the active Core-resolved grant in Finder or Explorer. The main pane restores conversation and observable agent activity. Its header exposes the approved model's human-readable identity, residency state, and manual unload control. The composer remains anchored at the bottom.

## Vault Core

Vault Core is a separate Node.js/TypeScript process and the sole product authority. It owns:

- Current-user-only local RPC and version negotiation.
- Folder grants and explicit attachments.
- Session, turn, draft, job, and artifact state.
- Canonical folder grants, live read-only mount authority, and immutable attachment staging.
- Policy, audit, cancellation, timeouts, and recovery.
- Model selection, memory scheduling, and inference mediation.
- Agent-loop orchestration and worker teardown.
- Validation of guest messages and results.

Unit tests may use the programmatic facade, but every desktop capability also crosses the daemon protocol. macOS uses a Unix domain socket; Windows uses the protected current-user named pipe. Desktop mode has no TCP listener.

The desktop and Vault Core run without administrator privileges on both platforms. Windows HCS requires either an administrator or Hyper-V Administrators account, so a signed Windows-only setup helper may elevate once, identify the requesting account from the non-elevated desktop process token, and add only that account to the built-in Hyper-V Administrators group. After the next Windows sign-in, the ordinary desktop token owns HCS lifecycle and the fixed Hyper-V socket admits that group. macOS retains its existing current-user Virtualization.framework path and has no administrator setup helper or prompt.

## Agent MicroVM

Each agent session starts or reuses one microVM under ADR 0012. Only one execution runs at a time per conversation, while independent conversations may overlap within the hardware-derived VM capacity. The VM configuration contains no virtual network adapter, DNS, route, NAT, bridge, or generic host proxy.

The guest receives:

- An immutable verified root image.
- The selected folder mounted live and read-only at `/source`, without Core enumeration or copy limits.
- Immutable explicit attachments under `/run/attachments`.
- A 128 MiB writable `/workspace` committed as an atomic content-addressed manifest and rehydrated after eviction or restart.
- One fixed typed host/guest socket.
- A typed task and bounded completion mediation.
- Fixed Python, Node.js, `/bin/sh`, BusyBox tools, and reviewed offline libraries.

The guest does not receive credentials, user home, writable host mounts, arbitrary host paths, a host shell, package installation, an external broker, a generic Vault Core API, approval authority, export authority, or a generic model endpoint.

Vault Core treats only verified regular files created or changed by successful guest executions as candidate session-owned deliverables. At finalization it selects the latest observed bytes, excludes internal tool state and intermediate code, and validates path, size, bytes, hash, and protocol before persistence. It never lets the guest commit authoritative state or write the selected host folder.

## Agent Loop

Vault Core owns the loop; the guest owns execution.

1. Core resolves the session, canonical folder grant, attachments, and durable history.
2. Core starts or reuses the guest and hydrates `/workspace`.
3. Core sends persistent chat history plus generic JSON-Schema tool definitions to the constrained inference worker.
4. The model returns text and zero or more native tool calls. Core validates each typed call and applies only generic loop limits, cancellation, and the repeated-call guard.
5. Execution and inspection tools run inside the guest; skill bodies load on demand; a depth-one child agent gets an isolated history while sharing the same session VM.
6. Tool results, including real interpreter failures, return to the model as conversation history. Core compacts that history at the measured context threshold without deleting durable trace or execution evidence.
7. Core records observable activity, validates and commits the workspace manifest, and retains the guest in a least-recently-used warm pool bounded by total RAM, the inference cap, a host reserve, and the fixed guest limit.
8. On successful finalization, Core commits the assistant response and valid observed deliverables in one logical completion flow. `artifacts.materialize` creates a verified owner-only temporary copy. `artifacts.export` performs an atomic host write chosen through the native dialog; the webview never receives the destination path.

OpenCode informs the persistent conversation, generic tool, sub-agent, and compaction design but is not a runtime dependency. Vault Desk implements those behaviors within its existing no-NIC execution and audit boundaries.

## Inference Worker

The first runtime is node-llama-cpp with an approved hash-pinned local model. It remains host-native for Metal, CUDA, HIP, or Vulkan acceleration, but runs under an operating-system capability boundary with no external networking, credentials, shell, tools, arbitrary workspace access, or approval authority.

The agent guest never connects directly to inference. Vault Core mediates each request, enforces model identity, typed chat and tool contracts, token and output limits, cancellation, memory budget, and audit. The resident worker loads Gemma once but exposes multiple parallel context sequences, so several model turns can generate concurrently on that single loaded model without multiplying its weight allocation; the added cost is per-sequence KV cache, bounded by the memory budget. Vault Core admits up to the reported sequence count and queues the rest, giving a user's own turn priority over sub-agent turns, so parallel guests never multiply the Gemma allocation. The packaged desktop selects the budget automatically: 10 GiB on Macs through 16 GB, 12 GiB through 24 GB, 16 GiB above 24 GB, and one selected Windows device's complete dedicated VRAM. Aggregate multi-device or unified and shared Windows memory readings are unsupported. An 8 GB Mac exposes an unsupported status and cannot start agent inference. Within the selected budget, the worker fits the largest generation context from the 8K floor through a hardware cap: 64K on Macs through 32 GB unified memory and Windows GPUs through 24 GB dedicated VRAM, or 128K above those platform-specific thresholds. The higher Mac threshold preserves host memory because inference and the rest of the product share one pool. macOS fitting accounts for combined model and context CPU-plus-GPU allocation and verifies the measured post-creation total. Windows reports detected dedicated VRAM separately from the applied cap. After a successful request, the worker process and approved model remain resident for the next turn. An idle-only typed unload command, a model switch, a contained failure, or Core shutdown terminates the complete worker; the operating system then reclaims the model and cached contexts as one process-scoped unit.

Gemma 4 reasoning is enabled through its supported chat wrapper. Only explicitly typed `thought` segments may cross the worker stream into bounded, transient active-run memory for live display. Those segments never enter the workspace database, conversation, agent event, or audit log. Token counts and timing measurements cross in the terminal typed response and are aggregated into persisted numeric run metrics.

## State And Recovery

Authoritative data uses the schema-versioned SQLite workspace catalog, immutable content-addressed artifacts, a single-writer lock, and the redaction-aware hash-chained audit log established in M1.

M3 adds folder grants, sessions, turns, drafts, attachments, agent runs, observable events, and artifact metadata. An interrupted transaction cannot leave a partial conversation. After daemon restart, the last committed state remains readable and in-flight jobs become an explicit interrupted state before retry or cancellation.

Raw hidden model reasoning is never persisted. Supported typed thought segments exist only while their run is active.

## Security Boundaries

- The user grants a folder or explicit files; the model never chooses host paths.
- Vault Core stages inputs and rechecks path identity at use time.
- Host inputs are read-only to the guest; scratch is guest-only and ephemeral.
- The VM has no NIC and no general host proxy.
- Agent code cannot install dependencies or access credentials.
- The model proposes; Vault Core authorizes and mediates; the guest executes only within its job.
- The webview has no direct product authority.
- Generated files are session-owned proposals and cannot silently mutate the host. Only explicit user Open or Save As actions cross the native boundary, and export audit records omit destination paths.
- Application telemetry, analytics, automatic crash reporting, and background metrics export do not exist.

## Packaging

V1 packages the Tauri host, exact Vault Core sidecar, native helpers, approved model assets, and verified guest image. First launch performs zero downloads. The Windows package alone contains the one-time Hyper-V membership helper; its signature and hash are recorded in the application-anchored resource manifest and verified before elevation. The macOS bundle excludes it.

Platform packages verify identities, hashes, signatures, notices, SBOMs, current-user endpoint permissions, no-NIC VM configuration, model confinement, and restart behavior on physical macOS and Windows systems.

## Post-V1 Document Intelligence

Canonical parsing, OCR/layout, retrieval, evidence packs, citations, and deterministic verification are one post-V1 follow-up. They may add product-owned fast paths for measured common tasks while retaining the generic agent as the long-tail capability. They cannot weaken the V1 authority boundaries.

## Later Deployment Shapes

The same control-plane boundaries may later support supported personal computers and multi-user office appliances. Identity, shared storage, network brokers, backup, governance, and organization policy require separate decisions and are not part of V1.

## Revision History

| Date | Change |
|---|---|
| 2026-07-10 | Created the original multi-plane architecture. |
| 2026-07-12 | Adopted the certified no-NIC hostile-work boundary. |
| 2026-07-13 | Selected Tauri v2 and a separate Vault Core daemon. |
| 2026-07-20 | Made the generic offline dev-agent desktop the V1 architecture and moved document intelligence after launch. |
| 2026-07-22 | Grouped sidebar creation actions under their Chats and Folders sections. |
| 2026-07-22 | Added hardware-derived model-plus-context budgets, full Windows GPU VRAM use, automatic context fitting, and the unsupported 8 GB Mac state. |
| 2026-07-25 | Added RAM-bounded parallel conversation guests and serialized model-turn reuse of one resident Gemma worker. |
| 2026-08-01 | Capped automatic context at 64K through 32 GB Mac unified memory or 24 GB Windows VRAM and at 128K above those thresholds. |
| 2026-08-04 | Added declared deliverable persistence plus hash-verified materialization and atomic user-selected export. |
| 2026-08-04 | Restricted Windows memory budgets and context tiers to one selected device's dedicated VRAM. |
| 2026-08-12 | Recorded that the resident worker exposes multiple parallel context sequences so several model turns generate concurrently on one loaded model, with user turns prioritized over sub-agent turns and overflow queued. |
