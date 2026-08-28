# Architecture

Updated: 2026-08-22

Vault Desk V1 is a local desktop application with three isolated layers: a thin Tauri interface, an authoritative Node.js control plane, and session-scoped no-network agent microVMs plus a narrow host-native inference worker.

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

Vault Core treats verified regular non-internal workspace files as candidate session-owned deliverables. At successful finalization it selects the latest observed bytes and validates path, size, bytes, hash, and protocol before persistence. A failed execution invalidates stale candidates and can retain changed safe bytes for a later successful recovery execution; it cannot create a generated-file card itself. Task text, suffixes, format names, and model completion markers do not decide deliverable completion. The guest never commits authoritative state or writes the selected host folder.

## Agent Loop

Vault Core owns the loop; the guest owns execution.

1. Core resolves the session, canonical folder grant, attachments, and durable history.
2. Core starts or reuses the guest and hydrates `/workspace`.
3. Core sends persistent chat history plus generic JSON-Schema tool definitions to the constrained inference worker.
4. The model returns text and zero or more native tool calls. Core validates each typed call before it uses the guest budget and applies only generic loop limits, cancellation, and the identical-call repair stop. The `read` tool streams bytes and decodes strict UTF-8 plain text. Invalid UTF-8 and NUL bytes fail. Safe optional integers clamp to configured bounds; wrong types, non-finite numbers, and unsafe integers fail. Tool-result previews are at most 50 KiB after JSON encoding. Complete oversized output goes to the internal spill path only after all chunks reserve space in the remaining guest budget.
5. Python and Node source can be committed under `/workspace/steps/`. A workspace path-only call resolves and records the exact committed bytes. A direct `/source/...` path-only call runs the live read-only file and records its absolute path with null source text. The typed guest protocol has a separate request variant for each case. Execution, inspection, and workspace edit tools run inside the guest; skill bodies load on demand through the generic `skill` tool; a depth-one child agent gets an isolated history while sharing the same session VM.
6. Tool results, including real interpreter failures, return to the model as conversation history. At the measured context threshold, Core keeps the model-written anchored summary and adds bounded data-only workspace state with script paths and the last execution failure. It does not extract task facts. Durable trace and execution evidence are unchanged. A completed run can also enter the ordered per-session summary queue only when it reports a measured chat allocation of at least 16,384 tokens. Each summary attempt has a new request identity and trace. One retry is allowed only for an approved worker failure. Summary failure does not fail the completed run, and Core cancels pending summary work at shutdown. The queue does not use profile or model-status fallback values.
7. Core records observable activity, validates and commits the workspace manifest, and retains the guest in a least-recently-used warm pool bounded by total RAM, the inference cap, a host reserve, and the fixed guest limit.
8. On successful finalization, Core commits the assistant response and valid observed deliverables in one logical completion flow. `artifacts.materialize` creates a verified owner-only temporary copy. `artifacts.export` performs an atomic host write chosen through the native dialog; the webview never receives the destination path.

OpenCode informs the persistent conversation, generic tool, sub-agent, and compaction design but is not a runtime dependency. Vault Desk implements those behaviors within its existing no-network execution and audit boundaries.

## Inference Worker

The first runtime is node-llama-cpp with an approved hash-pinned local model. It remains host-native for Metal, CUDA, HIP, or Vulkan acceleration, but runs under an operating-system capability boundary with no external networking, credentials, shell, tools, arbitrary workspace access, or approval authority.

The agent guest never connects directly to inference. Vault Core mediates each request, enforces model identity, typed chat and tool contracts, token and output limits, cancellation, memory budget, and audit. The resident worker loads Gemma once but exposes multiple parallel context sequences, so several model turns can generate concurrently on that single loaded model without multiplying its weight allocation; the added cost is per-sequence KV cache, bounded by the memory budget. Vault Core admits up to the reported sequence count and queues the rest, giving a user's own turn priority over sub-agent turns.

The worker runtime owns Windows GPU discovery and selection. The signed helper reports DXCore adapter facts and installed physical RAM. TypeScript probes the packaged CUDA and Vulkan backends, maps each runtime device to exactly one adapter, isolates each candidate, and selects one usable dedicated adapter before one integrated adapter. It selects the largest usable memory in that type and uses CUDA before Vulkan for the same adapter. It never uses brand or speed as a support rule, and it never adds memory across devices. A dedicated adapter needs at least 8 GiB and uses its complete isolated memory. Installed RAM gives an integrated adapter an 8 GiB maximum tier at exactly 16 GiB, 12 GiB above 16 GiB through 24 GiB, and 16 GiB above 24 GiB. The isolated runtime capacity selects that tier or the next lower fixed tier. Less than 16 GiB installed RAM or less than 8 GiB isolated capacity is unsupported. Unified profiles use combined CPU and GPU fitting and reserve the full inference budget from host RAM. Dedicated profiles use device-memory fitting and the small host reserve. Shared memory has a 64K cap through 32 GiB installed RAM and 128K above it. Dedicated memory has a 64K cap through 24 GiB and 128K above it. Core receives only a neutral memory profile. After a successful request or acknowledged Stop, the worker process and approved model remain resident for the next turn in the same or a different session. Stop keeps its sequence slot until the worker returns the typed cancellation result. If that result does not arrive within one second, Core contains the failed worker and unloads it. An idle-only typed unload command, a model switch, another contained failure, or Core shutdown terminates the complete worker.

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

Platform packages verify identities, hashes, signatures, notices, SBOMs, current-user endpoint permissions, no-network VM configuration, model confinement, and restart behavior on physical macOS and Windows systems.

## Post-V1 Document Intelligence

Canonical parsing, OCR/layout, retrieval, evidence packs, citations, and deterministic verification are one post-V1 follow-up. They may add product-owned fast paths for measured common tasks while retaining the generic agent as the long-tail capability. They cannot weaken the V1 authority boundaries.

## Later Deployment Shapes

The same control-plane boundaries may later support supported personal computers and multi-user office appliances. Identity, shared storage, network brokers, backup, governance, and organization policy require separate decisions and are not part of V1.
