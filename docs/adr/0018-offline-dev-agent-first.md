# ADR 0018: Offline Dev Agent First

Date: 2026-07-20

## Status

Accepted; supersedes ADR 0015 for V1 product sequencing

## Context

The original implementation plan postponed the desktop application and generic code interpreter until after several document-specific milestones. That sequence produced strong foundations but delayed the first product users could operate. It also assumed that supported document operations should be implemented before a general agent could attempt the same work.

The repository owner instead requires the shortest path to a useful cross-platform desktop product: a generic local agent that can inspect a user-selected folder or explicit attachments, write Python and Node.js scripts, run installed guest commands, and return results from the existing offline microVM boundary without gaining write access to the host.

## Decision

Garden Desk V1 is an offline dev-agent desktop application.

Vault Core owns the agent loop, inference mediation, session state, policy, audit, and cancellation. The model participates through a persistent native tool-calling conversation and never receives direct process, filesystem, VM-control, approval, export, or network authority. Every execution and file inspection crosses a typed Core boundary into the no-network microVM (a virtual machine with no network interface, used for hostile document processing and agent-authored code).

Each conversation owns a reusable no-network microVM under ADR 0012. It stays alive through the current run and may remain in the memory-bounded warm-session pool for later follow-ups:

- Zero virtual network devices and no general host-network proxy.
- A verified immutable root image.
- The selected folder mounted live and read-only at `/source`, with its original hierarchy and no host enumeration, flattening, copying, or size limit.
- A session-scoped writable `/workspace`, limited to 128 MiB and committed after every execution as an atomic content-addressed manifest. Core rehydrates it after VM eviction or an application or machine restart.
- A fixed versioned host/guest socket carrying hello and capabilities, hydration, execution, bounded stdout/stderr, cancellation, workspace deltas, results, and shutdown.
- Python, Node.js, `/bin/sh`, BusyBox commands, and a reviewed pinned library set already present in the image.
- No dependency installation, package downloads, credentials, user home, writable selected-folder mount, host shell, or generic model endpoint.
- One execution at a time per conversation. Different conversations may overlap tool execution while their Gemma turns queue through one resident inference worker. The warm pool is derived from total RAM, the inference cap, and a host reserve; idle sessions are evicted before another VM starts.

The agent's tool set is `bash`, `python`, `node`, `read`, `glob`, `grep`, `list`, `write`, `edit`, `image`, `skill`, `task`, and `question`. `read`, `glob`, `grep`, and `list` inspect the guest; `write` and `edit` change files only under `/workspace`; `python`, `node`, and `bash` run inside the guest. `task` starts a child agent in the same session and VM; the system prompt tells the model to use it only when the user explicitly asks for delegation or parallel work, so the primary agent does not reach for it on its own. Specialized instructions load on demand through the `skill` tool. A run stops after at most 40 model turns. Every file created or changed under `/workspace` during a run is delivered to the user as an artifact; Core's own bookkeeping paths (`.vault-tools/`, `.vault-output/`) are the only exclusion, and there is no separate internal-versus-deliverable classification.

Core validates each tool call before execution. Unsupported model input returns a failed tool result and does not end the task. Missing files, syntax failures, and runtime failures return their real interpreter output to the next turn; Core does not reject programs by source pattern.

Worker-reported used context triggers compaction at 80 percent of the allocated context. Used context is the active sequence token position, not the newly evaluated prompt tokens used for performance reporting. A no-tool summarization pass replaces the older live head of the conversation with a model-written summary, while the current user request and the last two assistant/tool turns remain verbatim. Durable messages, traces, execution evidence, and audit records are never deleted by compaction. After a completed run reports a measured chat allocation of at least 16,384 tokens, Core can queue one session-summary refresh so a later conversation keeps cross-run continuity; the per-session queue is ordered and non-fatal.

Exit status and typed termination determine tool success. Stderr alone is evidence, not failure, because installed libraries may emit benign warnings. Nonzero exits, timeouts, cancellation, resource limits, and crashes return as failed tool results that the model may investigate or replace.

For new runs, Core stores each exact message-history request, advertised tool schema, and returned text/tool-call payload in the immutable content-addressed store, linked to an ordered chat or compaction turn.

The host-native inference worker remains separately sandboxed so local acceleration is available. It renders tool declarations, calls, and results in Gemma 4's own native tool format through a Vault-owned chat wrapper, and parses the returned call from the generated tokens by token id instead of through a generic JSON grammar, so generated source keeps every byte the model wrote. The guest cannot choose a model path or connect to the inference worker directly.

The V1 desktop uses Tauri v2 and React under ADR 0014. Its sidebar contains a global New chat action and folder groups. A folder group shows its five most recent sessions and expands older sessions through Show more. New chat sessions accept explicit file attachments without granting a full folder. The webview receives opaque identifiers and display metadata, never unrestricted host paths or filesystem handles.

Word, PDF, XLSX, and review-report methods are prompt-only skill guidance. The model loads them through the generic `skill` tool. Core does not route a file format, select a skill body, or parse a document format.

Canonical parsing, OCR, retrieval, citations, and deterministic document tools move to one post-V1 document-intelligence follow-up. They may optimize common tasks when measurements justify maintained product code, but they are no longer prerequisites for the generic agent.

OpenCode is an interaction and agent-loop reference, not an adopted runtime. Garden Desk owns the equivalent generic boundaries — Markdown agents, on-demand Markdown skills, isolated child runs, and native multi-turn tools — while preserving its stricter offline microVM, audit, packaging, and artifact-verification authorities.

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
- The guest image is larger because it contains interpreters and fixed libraries.
- Concurrent conversations share inference throughput and can wait behind another Gemma turn.
- Source citations and format-specific verification are not promised in the first release.

Running Gemma 4 as the default model taught one lesson worth keeping in this record: a small local model's misbehavior is an outcome, not a bug, and most of it does not need product code to compensate. The one fix that mattered lived at the tool layer — rendering tool calls in the model's own native format instead of forcing them through a generic JSON grammar it was never trained on (PR #81) — plus a plain 40-turn cap that ends a run cleanly when the model loops or stalls instead of producing a result. Earlier revisions of this agent added duplicate-call detection, a temperature increase during recovery, a stalled-duplicate failure code, and evidence and card-recovery rules to compensate for model behavior; none of it improved outcomes enough to justify its complexity, and it was removed on 2026-08-30 (see AGENTS.md's Model Limitation Rule). ADRs record the decisions made at the time they were written; this one no longer describes a live behavior contract. Read the current code and [M3_STATUS.md](../M3_STATUS.md) for what the agent actually does today.
