# ADR 0018: Offline Dev Agent First

Date: 2026-07-20

## Status

Accepted; supersedes ADR 0015 for V1 product sequencing

## Context

The original implementation plan postponed the desktop application and generic code interpreter until after several document-specific milestones. That sequence produced strong foundations but delayed the first product users could operate. It also assumed that supported document operations should be implemented before a general agent could attempt the same work.

The repository owner instead requires the shortest path to a useful cross-platform desktop product: a generic local agent that can inspect a user-selected folder or explicit attachments, write Python and Node.js scripts, run installed guest commands, and return results from the existing offline microVM boundary without gaining write access to the host.

## Decision

Vault Desk V1 is an offline dev-agent desktop application.

Vault Core owns the agent loop, inference mediation, session state, policy, audit, cancellation, limits, and result validation. The model proposes code and follow-up observations as typed data. It never receives direct process, filesystem, VM-control, approval, export, or network authority.

Each conversation owns a reusable no-NIC microVM under ADR 0012. It stays alive through the current run and may remain in the memory-bounded warm-session pool for later follow-ups:

- Zero virtual network devices and no general host-network proxy.
- A verified immutable root image.
- The selected folder mounted live and read-only at `/source`, with its original hierarchy and no host enumeration, flattening, copying, file-count limit, individual-size limit, or aggregate-size limit. Immediate host-change visibility is accepted in place of snapshot reproducibility.
- A session-scoped writable `/workspace`, limited to 128 MiB and committed after every responsive execution as an atomic content-addressed manifest. Core rehydrates it after VM eviction or application and machine restart.
- A fixed versioned host/guest socket. Agent protocol v3 carries hello and capabilities, hydration, repeated execution, ordered bounded stdout/stderr chunks, typed lifecycle diagnostics, cancellation, workspace deltas, results, and graceful shutdown; the M1 probe remains protocol v1.
- Python, Node.js, `/bin/sh`, BusyBox commands, and a reviewed pinned library set already present in the image.
- No dependency installation, package downloads, credentials, user home, writable selected-folder mount, host shell, generic Vault Core API, or generic model endpoint.
- One execution at a time per conversation. Different conversations may overlap tool execution while their Gemma turns queue through one resident inference worker. The warm pool is derived from total RAM, the inference cap, a host reserve, and the fixed 4 GiB guest limit. Least-recently-used idle sessions are evicted before another VM starts; deletion, revocation, Core shutdown, helper failure, or memory pressure also evicts a session after responsive workspace state is committed.

Core builds each Gemma request from durable conversation messages and execution events. It requests at most 32,768 output tokens for a new executable proposal, 8,192 for a failed or rejected repair or XLSX repair and continuation turn, and 4,096 for a forced final response. While assembling context, Core reserves up to the applicable amount while leaving at least 4,096 tokens for the current prompt; the certified 8K minimum therefore reserves 4,096 output tokens. It uses the actual allocated context when known, preserves the current run and newest unsuperseded failed repair in full, anchors the last two user turns, and summarizes older history without deleting stored originals. If mandatory repair context cannot fit, Core returns `agent_context_exhausted` rather than dropping required source or commands. If Gemma reaches the generation limit before producing a complete structured action, Core records the failed turn and makes one new traced 8,192-token request restricted to a complete Python or Node source action of at most 64 lines that creates or patches one bounded part of a persistent workspace file. A repeated generation-limit stop returns an explicit failure instead of executing partial output.

For new runs, Core stores each exact effective inference prompt plus canonical JSON schema and pre-parse structured result in the immutable content-addressed store. The catalog links their hashes and request metadata to an ordered run turn and records the decision outcome before execution or response acceptance. Capture fails closed, while hidden thought segments remain transient and absent from traces.

The host-native inference worker remains separately sandboxed so local acceleration is available. A guest completion request is schema-bounded and mediated by Vault Core; the guest cannot choose a model path or connect to the inference worker directly.

The V1 desktop uses Tauri v2 and React under ADR 0014. Its sidebar contains a global New chat action and folder groups. A folder group shows its five most recent sessions and expands older sessions through Show more. New chat sessions accept explicit file attachments without granting a full folder. The webview receives opaque identifiers and display metadata, never unrestricted host paths or filesystem handles.

Canonical parsing, OCR, retrieval, citations, and deterministic document tools move to one post-V1 document-intelligence follow-up. They may optimize common tasks when measurements justify maintained product code, but they are no longer prerequisites for the generic agent.

OpenCode is an interaction and agent-loop reference, not an adopted runtime. Vault Desk starts with the smallest owned loop that satisfies the offline microVM, typed mediation, cancellation, audit, packaging, and resource gates. A future dependency decision requires a separate review.

## Consequences

Positive:

- Produces a usable desktop product earlier.
- Supports broad file work before format-specific product features exist.
- Reuses the already certified cross-platform no-NIC microVM boundary.
- Keeps host source folders immutable while allowing iterative work in a durable session workspace.
- Allows real usage to identify which deterministic document features deserve post-V1 maintenance.

Negative:

- A generic local agent can be slower and less reliable than purpose-built operations.
- Generated code and shell commands can produce incorrect results even when securely isolated.
- Live mounts are less reproducible than snapshots because host changes are visible immediately.
- The guest image becomes larger because it contains interpreters and fixed libraries.
- Model mediation, multi-step execution, and desktop streaming must work before V1.
- Concurrent conversations share inference throughput and can wait behind another Gemma turn.
- Source citations and format-specific verification are not promised in the first release.

## Required Validation

- Real multi-step Python, Node.js, and shell tasks over live read-only folders on macOS and Windows without a VM reboot between steps.
- Same-path repair after failure, persistence across VM and Core restart, and warm-VM eviction.
- Parallel conversations up to the hardware-derived guest capacity, queued excess work, and one shared resident inference allocation.
- A folder with more than 64 files and a sparse file larger than 512 MiB mounts without copy limits; hierarchy and live host changes remain visible and guest writes fail.
- Zero-NIC configuration inspection plus runtime denial probes for external, LAN, multicast, and host reachability.
- Attempts to modify the host folder, traverse outside staged inputs, follow escaping links, access credentials, install packages, or reach arbitrary host services fail.
- Infinite loops, process storms, memory and disk exhaustion, oversized output, malformed IPC, guest crash, cancellation, and daemon restart are contained.
- Guest completion requests cannot become a generic inference endpoint or escape their turn, token, schema, and output limits.
- Session grouping, five-item pagination, New chat attachments, restart restoration, draft preservation, and folder removal behave as specified.
- Packaged macOS and Windows applications launch with zero downloads and verify the exact sidecar, helpers, model assets, and guest image.

## Revision History

| Date | Change |
|---|---|
| 2026-07-20 | Made the generic offline dev agent and full desktop application the V1 product path. |
| 2026-07-23 | Replaced one-execution snapshots with a session-scoped warm VM, live read-only source mount, durable bounded workspace, shell execution, and anchored repair context. |
| 2026-07-23 | Added durable bounded live execution streams, allowlisted VM diagnostics, final-result completeness validation, and normalized execution recovery records. |
| 2026-07-25 | Allowed memory-bounded parallel conversation VMs while retaining one serialized resident inference worker. |
| 2026-07-28 | Raised new executable proposals to 32,768 output tokens and added bounded 8,192-token multi-turn workspace-edit recovery when generation reaches that limit. |
