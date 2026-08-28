# ADR 0018: Offline Dev Agent First

Date: 2026-07-20

## Status

Accepted; supersedes ADR 0015 for V1 product sequencing

## Context

The original implementation plan postponed the desktop application and generic code interpreter until after several document-specific milestones. That sequence produced strong foundations but delayed the first product users could operate. It also assumed that supported document operations should be implemented before a general agent could attempt the same work.

The repository owner instead requires the shortest path to a useful cross-platform desktop product: a generic local agent that can inspect a user-selected folder or explicit attachments, write Python and Node.js scripts, run installed guest commands, and return results from the existing offline microVM boundary without gaining write access to the host.

## Decision

Garden Desk V1 is an offline dev-agent desktop application.

Vault Core owns the agent loop, inference mediation, session state, policy, audit, cancellation, limits, and result validation. The model participates through a persistent native tool-calling conversation and never receives direct process, filesystem, VM-control, approval, export, or network authority. Every execution and file inspection still crosses a typed Core boundary into the no-network guest.

Each conversation owns a reusable no-network microVM under ADR 0012. It stays alive through the current run and may remain in the memory-bounded warm-session pool for later follow-ups:

- Zero virtual network devices and no general host-network proxy.
- A verified immutable root image.
- The selected folder mounted live and read-only at `/source`, with its original hierarchy and no host enumeration, flattening, copying, file-count limit, individual-size limit, or aggregate-size limit. Immediate host-change visibility is accepted in place of snapshot reproducibility.
- A session-scoped writable `/workspace`, limited to 128 MiB and committed after every responsive execution as an atomic content-addressed manifest. Core rehydrates it after VM eviction or application and machine restart.
- A fixed versioned host/guest socket. Agent protocol v3 carries hello and capabilities, hydration, repeated execution, ordered bounded stdout/stderr chunks, typed lifecycle diagnostics, cancellation, workspace deltas, results, and graceful shutdown; the M1 probe remains protocol v1.
- Python, Node.js, `/bin/sh`, BusyBox commands, and a reviewed pinned library set already present in the image.
- No dependency installation, package downloads, credentials, user home, writable selected-folder mount, host shell, generic Vault Core API, or generic model endpoint.
- One execution at a time per conversation. Different conversations may overlap tool execution while their Gemma turns queue through one resident inference worker. The warm pool is derived from total RAM, the inference cap, a host reserve, and the fixed 4 GiB guest limit. Least-recently-used idle sessions are evicted before another VM starts; deletion, revocation, Core shutdown, helper failure, or memory pressure also evicts a session after responsive workspace state is committed.

Core sends the complete live message history and the current agent's generic tool definitions to Gemma for each turn. A run stops after at most 40 model turns and 24 started guest executions. Core validates each tool call before it can use the guest budget. Unsupported model input returns a failed tool result and does not end the task. Safe optional integers clamp to their configured bounds; wrong types, non-finite numbers, and unsafe integers fail. Python and Node paths accept relative workspace paths, `/workspace/...` paths normalized to relative form, and path-only `/source/...` paths. Workspace source can be committed under `/workspace/steps/`; a later path-only call resolves and runs the exact committed UTF-8 bytes, which Core records. A direct source call runs the live read-only mounted file and records its absolute path with null source text. It does not create an exact-byte snapshot, so the file can change during execution. Shell source is executed as supplied. Missing files, syntax failures, and runtime failures return their real interpreter output to the next turn. `read`, `glob`, `grep`, and `list` run inside the same guest roots; `write` and `edit` also run there but change files only under `/workspace`, as unrecorded guest executions evidenced by the tool result and committed workspace manifest rather than a separate execution record. `read` streams bytes, decodes strict UTF-8 plain text, and fails for invalid UTF-8 or NUL bytes. Duplicate recovery blocks the third identical call and every later identical call until a different validated call executes, except that an already-loaded skill returns the existing zero-cost result without entering recovery. It keeps one copy of a blocked repeated call and its result in later prompts, samples model turns at temperature 0.3 while the block is active, asks a fixed `Repeated action` question once, and fails with `agent_stalled_duplicate` when the direction is ignored; no format, command-shape, or source-pattern policy rejects code before execution.

Measured prompt use triggers compaction at 80 percent of the allocated context. A no-tool summarization pass replaces the older live head with a model-written anchored Objective, Facts, Work State, Next Move, and Relevant Files summary. Core appends bounded data-only workspace state with current-run named script paths and the last failed execution termination, exit code, and error text. It does not extract task facts. The current user request and last two assistant/tool turns remain verbatim, and different failed calls remain available. Durable messages, traces, execution evidence, and audit records are never deleted by live-context compaction. Tool-result previews retain at most 2,000 lines and 50 KiB after JSON encoding. Complete overflow is written to `/workspace/.vault-output` only after every chunk reserves space within the 24-execution budget; no partial spill starts. Chat generation uses up to 16,384 output tokens while reserving at least 4,096 tokens for the prompt, and compact summaries stay bounded at 2,048. An explicit question-tool test makes the first turn one question call. Output exhaustion alone does not cause compaction. Core keeps typed tools available for one direct recovery turn and stops with `agent_generation_limit` if that turn also reaches its output limit.

After a completed run reports a measured chat allocation of at least 16,384 tokens, Core can queue one session-summary refresh. The per-session queue is ordered and non-fatal. Each attempt has a new request identity and trace. Core retries once only for an approved worker failure, never uses a profile or model-status fallback, and cancels pending work at shutdown.

Exit status and typed termination determine tool success. Stderr alone is evidence, not failure, because installed libraries may emit benign warnings. Nonzero exits, timeouts, cancellation, resource limits, and crashes return as failed tool results that the model may investigate or replace.

Successful runs expose the latest non-internal workspace files observed in execution deltas as generated files. Core filters internal tool, output-spill, and checkpoint paths and independently persists captured bytes. A failed execution invalidates stale candidate bytes and can retain changed safe bytes for a later successful recovery execution. A failed execution alone never creates a generated-file card. No task-text parsing, model-authored declaration, format-specific completion marker, suffix allowlist, or format allowlist decides completion.

For new runs, Core stores each exact message-history request, advertised tool schema, and returned text/tool-call payload in the immutable content-addressed store. The catalog links their hashes and request metadata to an ordered chat or compaction turn and records the accepted tool calls, response, or compaction outcome. Capture fails closed, while hidden thought segments remain transient and absent from traces.

The host-native inference worker remains separately sandboxed so local acceleration is available. It serializes Core-owned history through a Vault-owned Gemma 4 chat wrapper in the model's native tool format and parses the returned call by token id without executing handlers. The guest cannot choose a model path or connect to the inference worker directly.

The V1 desktop uses Tauri v2 and React under ADR 0014. Its sidebar contains a global New chat action and folder groups. A folder group shows its five most recent sessions and expands older sessions through Show more. New chat sessions accept explicit file attachments without granting a full folder. The webview receives opaque identifiers and display metadata, never unrestricted host paths or filesystem handles.

Word, PDF, XLSX, and review-report methods are prompt-only skill guidance. The model loads them through the generic `skill` tool. Core does not route a file format, select a skill body, or parse a document format. For multi-step output, the guidance can use a guest-workspace checkpoint. The final program rereads source facts, derives values again, compares them with the saved verified state, creates each requested output, reopens it, and verifies it before completion.

Canonical parsing, OCR, retrieval, citations, and deterministic document tools move to one post-V1 document-intelligence follow-up. They may optimize common tasks when measurements justify maintained product code, but they are no longer prerequisites for the generic agent.

OpenCode is an interaction and agent-loop reference, not an adopted runtime. Garden Desk owns the equivalent generic boundaries: Markdown agents, on-demand Markdown skills, isolated child runs, native multi-turn tools, bounded output spill, and measured compaction, while preserving its stricter offline microVM, audit, packaging, and artifact-verification authorities.

## Consequences

Positive:

- Produces a usable desktop product earlier.
- Supports broad file work before format-specific product features exist.
- Reuses the already certified cross-platform no-network microVM boundary.
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
- Chat requests cannot become a generic inference endpoint or escape their turn, token, tool, and output limits.
- Session grouping, five-item pagination, New chat attachments, restart restoration, draft preservation, and folder removal behave as specified.
- Packaged macOS and Windows applications launch with zero downloads and verify the exact sidecar, helpers, model assets, and guest image.
