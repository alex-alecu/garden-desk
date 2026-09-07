# Architecture

Updated: 2026-08-22

Garden Desk V1 is a local desktop application with three isolated layers: a thin Tauri interface, an authoritative Node.js control plane, and session-scoped no-network agent microVMs plus a narrow host-native inference worker.

## System Shape

```text
┌───────────────────────────────────────────────────────────────┐
│ Tauri v2 desktop                                              │
│ React webview + minimal Rust host + native dialogs            │
└──────────────────────────┬────────────────────────────────────┘
                           │ typed commands / local RPC
┌──────────────────────────▼────────────────────────────────────┐
│ Garden Desk Core                                                   │
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

The first desktop uses Tauri v2 with React and TypeScript. The Rust host owns only window lifecycle, native dialogs and granted-folder opening, exact Garden Desk Core sidecar startup, and connection bootstrap.

The webview receives no generic shell, process launcher, environment reader, network client, local-endpoint selector, or unrestricted filesystem API. It works with opaque folder, session, attachment, job, and artifact identifiers through narrow typed commands.

The sidebar's Chats section begins with New chat and then recent global sessions. Its Folders section begins with Add folder and then folder groups. Each folder group exposes its newest five sessions, cursor-based expansion, and a folder icon that asks the native shell to open the active Core-resolved grant in Finder or Explorer. The main pane restores conversation and observable agent activity. Its header exposes the approved model's human-readable identity, residency state, and manual unload control. The composer remains anchored at the bottom.

## Garden Desk Core

Garden Desk Core is a separate Node.js/TypeScript process and the sole product authority. It owns:

- Current-user-only local RPC and version negotiation.
- Folder grants and explicit attachments.
- Session, turn, draft, job, and artifact state.
- Canonical folder grants, live read-only mount authority, and immutable attachment staging.
- Policy, audit, cancellation, timeouts, and recovery.
- Model selection, memory scheduling, and inference mediation.
- Agent-loop orchestration and worker teardown.
- Validation of guest messages and results.

Unit tests may use the programmatic facade, but every desktop capability also crosses the daemon protocol. macOS uses a Unix domain socket; Windows uses the protected current-user named pipe. Desktop mode has no TCP listener.

The desktop and Garden Desk Core run without administrator privileges on both platforms. Windows HCS requires either an administrator or Hyper-V Administrators account, so a signed Windows-only setup helper may elevate once, identify the requesting account from the non-elevated desktop process token, and add only that account to the built-in Hyper-V Administrators group. After the next Windows sign-in, the ordinary desktop token owns HCS lifecycle and the fixed Hyper-V socket admits that group. macOS retains its existing current-user Virtualization.framework path and has no administrator setup helper or prompt.

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

The guest does not receive credentials, user home, writable host mounts, arbitrary host paths, a host shell, package installation, an external broker, a generic Garden Desk Core API, approval authority, export authority, or a generic model endpoint.

Every file a run creates or changes under `/workspace` is a session-owned deliverable; there is no separate internal-versus-deliverable classification. At successful finalization Core validates path, size, bytes, and hash before persistence. Task text, suffixes, format names, and model completion markers do not decide deliverable completion. The guest never commits authoritative state or writes the selected host folder.

## Agent Loop

Garden Desk Core owns the loop; the guest owns execution.

1. Core resolves the session, canonical folder grant, attachments, and durable history.
2. Core starts or reuses the guest and hydrates `/workspace`.
3. Core sends persistent chat history plus generic JSON-Schema tool definitions to the constrained inference worker.
4. The model returns text and zero or more native tool calls. Core validates each typed call before it runs and applies only the loop's 40-turn cap and cancellation; there is no retry or recovery logic for how the model uses its tools. The `read` tool streams bytes and decodes strict UTF-8 plain text. Invalid UTF-8 and NUL bytes fail. Safe optional integers clamp to configured bounds; wrong types, non-finite numbers, and unsafe integers fail. Tool-result previews are at most 50 KiB after JSON encoding. A complete oversized result is saved under `/workspace` and the tool result names its path.
5. Python and Node calls run source once, save source to a workspace path and run it, run the last saved bytes at a workspace path, or run a live file directly from `/source/...`. A direct `/source/...` call records its absolute path with null source text. Execution, inspection, and workspace edit tools run inside the guest; skill bodies load on demand through the generic `skill` tool; a depth-one child agent gets an isolated history while sharing the same session VM.
6. Tool results, including real interpreter failures, return to the model as conversation history. When the worker-reported used context reaches 80 percent of the allocated context, Core replaces the older conversation head with one model-written summary while the current user request and last two assistant/tool turns stay verbatim. Durable trace and execution evidence are unchanged. A completed run can also enter the ordered per-session summary queue only when it reports a measured chat allocation of at least 16,384 tokens. Each summary attempt has a new request identity and trace. One retry is allowed only for an approved worker failure. Summary failure does not fail its completed run, and Core cancels pending summary work at shutdown.
7. Core records observable activity, validates and commits the workspace manifest, and retains the guest in a least-recently-used warm pool bounded by total RAM, the inference cap, a host reserve, and the fixed guest limit.
8. On successful finalization, Core commits the assistant response and valid observed deliverables in one logical completion flow. `artifacts.materialize` creates a verified owner-only temporary copy. `artifacts.export` performs an atomic host write chosen through the native dialog; the webview never receives the destination path.

OpenCode informs the persistent conversation, generic tool, sub-agent, and compaction design but is not a runtime dependency. Garden Desk implements those behaviors within its existing no-network execution and audit boundaries.

## Inference Worker

The runtime is the pinned llama.cpp server with a hash-verified Qwen3.8 27B Q4 model. It uses Metal, CUDA, or Vulkan inside the native OS boundary. Windows uses the no-capability AppContainer and one-process job. Mac permits only the exact private Unix socket. The Windows helper relays opaque bytes; TypeScript owns HTTP and parsing. No TCP, credentials, tools, or arbitrary workspace access is allowed. See [ADR 0019](adr/0019-qwen38-private-server.md).

Core mediates all inference and retains tool authority. One resident server has one slot. The existing scheduler queues model turns and unloads generation before embedding or image work. Cancellation closes the request and waits at most one second for the slot to become idle; a failed server is then stopped. Shutdown stops the server and removes its private directory.

Generation uses a fixed 32K context. Core retains compaction. Reasoning stays in transient memory during one task and is cleared at completion, cancellation, or compaction. Stored messages and traces contain no reasoning. Task time stays fixed across tool turns. Context accounting includes cached input; performance counts only evaluated input tokens. Unavailable allocation measurements are omitted.

## State And Recovery

Authoritative data uses the schema-versioned SQLite workspace catalog, immutable content-addressed artifacts, a single-writer lock, and the redaction-aware hash-chained audit log established in M1.

M3 adds folder grants, sessions, turns, drafts, attachments, agent runs, observable events, and artifact metadata. An interrupted transaction cannot leave a partial conversation. After daemon restart, the last committed state remains readable and in-flight jobs become an explicit interrupted state before retry or cancellation.

Raw hidden model reasoning is never persisted. Supported typed thought segments can remain in transient desktop memory until the application closes and are never restored.

## Security Boundaries

- The user grants a folder or explicit files; the model never chooses host paths.
- Garden Desk Core stages inputs and rechecks path identity at use time.
- Host inputs are read-only to the guest; scratch is guest-only and ephemeral.
- The VM has no NIC and no general host proxy.
- Agent code cannot install dependencies or access credentials.
- The model proposes; Garden Desk Core authorizes and mediates; the guest executes only within its job.
- The webview has no direct product authority.
- Generated files are session-owned proposals and cannot silently mutate the host. Only explicit user Open or Save As actions cross the native boundary, and export audit records omit destination paths.
- Application telemetry, analytics, automatic crash reporting, and background metrics export do not exist.

## Packaging

V1 packages the Tauri host, exact Garden Desk Core sidecar, native helpers, approved model assets, and verified guest image. First launch performs zero downloads. The Windows package alone contains the one-time Hyper-V membership helper; its signature and hash are recorded in the application-anchored resource manifest and verified before elevation. The macOS bundle excludes it.

Platform packages verify identities, hashes, signatures, notices, SBOMs, current-user endpoint permissions, no-network VM configuration, model confinement, and restart behavior on physical macOS and Windows systems.

## Post-V1 Document Intelligence

Canonical parsing, OCR/layout, retrieval, evidence packs, citations, and deterministic verification are one post-V1 follow-up. They may add product-owned fast paths for measured common tasks while retaining the generic agent as the long-tail capability. They cannot weaken the V1 authority boundaries.

## Later Deployment Shapes

The same control-plane boundaries may later support supported personal computers and multi-user office appliances. Identity, shared storage, network brokers, backup, governance, and organization policy require separate decisions and are not part of V1.
