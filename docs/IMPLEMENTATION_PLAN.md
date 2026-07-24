# Implementation Plan

Updated: 2026-07-22

This is the authoritative implementation sequence for the first Vault Desk release. M0, cross-platform M1, and cross-platform M2 are complete. The repository owner activated M3 on 2026-07-20 as the first full product milestone. The macOS M3 stage is implemented and physically certified; Windows product integration and physical certification remain required before M3 or Community Desktop V1 can close.

The shortest path to V1 is a generic offline desktop agent, not a format-specific document pipeline. The agent may write and run Python or Node.js programs and installed guest commands inside a session-scoped no-NIC microVM. It sees the selected folder live and read-only at `/source` and works in a persistent bounded `/workspace`. It cannot write to the selected host folder, install packages, reach a network, inherit credentials, or call an unrestricted host service.

## Change Brief

- Goal: ship a functional macOS and Windows desktop application with a generic local coding agent inspired by the interaction model of OpenCode and the desktop structure of the Codex app.
- Active milestone: M3 — Offline Dev-Agent Desktop V1.
- Allowed scope: Tauri/React desktop, native folder and file selection, grouped persistent sessions, local daemon APIs, host-native model mediation, a session-scoped code-agent microVM, fixed offline runtimes and tools, typed execution results, audit, cancellation, packaging, and platform evidence.
- Product boundaries: the webview has no direct filesystem, process, shell, environment, or network authority. Vault Core owns grants, sessions, policy, audit, inference mediation, workspace manifests, worker limits, and lifecycle. The guest receives only the live read-only folder, immutable attachments, and its bounded writable workspace.
- Risks: guest-image size and reproducibility, Windows/macOS packaging differences, multi-step agent-loop correctness, local-model latency, recovery, and accidental host authority.
- Acceptance evidence: a packaged app on physical macOS and Windows; folder and attachment flows; grouped session and workspace restoration; real multi-step Python, Node.js, and shell tasks; structural network denial; host-write and package-install denial; cancellation/restart recovery; and signed sidecar and guest-image verification.
- Dependencies affected: reviewed and pinned React/Tauri frontend packages plus a reviewed guest-library manifest. OpenCode is a design reference, not a required dependency.
- Explicitly not doing before V1: canonical document ingestion, OCR/layout routing, hybrid retrieval, citation verification, domain workflows, Knowledge Bundle import, external integrations, or model downloads.

## Product Architecture

Three layers remain mandatory:

1. **Tauri desktop** — React and TypeScript in the operating-system webview plus the minimum Rust needed for window lifecycle, native dialogs, exact Vault Core sidecar supervision, and connection bootstrap.
2. **Vault Core** — the separate Node.js/TypeScript authority for folder and attachment grants, sessions, jobs, policy, audit, model scheduling, inference mediation, worker supervision, and typed daemon methods.
3. **Workers** — a narrowly sandboxed host-native inference process and a reusable session-scoped no-NIC microVM for agent-authored code and installed guest commands.

The desktop communicates only through narrow typed Tauri commands and the current-user-only local daemon protocol. TCP is not enabled. Every M3 backend capability is exercised through both the programmatic facade and daemon protocol before the desktop consumes it.

## V1 User Experience

The compact resizable left sidebar has a Chats section whose first option is the global **New chat** action, followed by recent global chats. Its Folders section begins with **Add folder**, followed by folder groups. Each folder group shows its five most recent sessions and a **Show more** control when older sessions exist. Session rows expose deletion on hover or keyboard focus. All conversation, folder-grant, and attachment removals require explicit confirmation.

A New chat action prepares a blank composer with no folder grant and does not persist a placeholder session until the user submits a message or selects attachments. Explicit files remain immutable session-owned attachments. A folder conversation grants a live read-only mount of the selected folder without enumerating or copying it. Switching sessions restores the conversation, selected context, tool activity, draft text, and durable guest workspace; selecting the session begins VM boot and hydration in the background.

The main pane is conversation-first. Its header shows the approved model name, subtle live VRAM with context beneath it when available, on-device residency state, an idle-only manual unload action, and a Technical details control. It shows streamed assistant output, transient typed thought segments when the approved model supports them, concise code/tool activity, generated artifacts, warnings, failures, cancellation state, and response-speed metrics in chronological order. The right-side Technical details drawer opens to an Overview without log bodies; it shows the current session ID and catalog path plus fixed controls to create and reveal a private AI-agent debugging snapshot with SQLite-backed session records and bounded microVM logs, while its Logs tab exposes bounded live output, errors, and typed VM diagnostics one collapsed execution at a time. The composer remains anchored at the bottom. Arbitrary model/runtime configuration stays out of the ordinary interface.

## Agent Execution Contract

Vault Core owns the agent loop. The model may propose a script or request the next bounded observation, but it never receives execution authority.

Each agent session:

1. Validates and canonicalizes the native-picker folder grant in Core; the webview retains only opaque identifiers.
2. Starts or reuses the session VM with zero virtual NICs and mounts the exact folder read-only at `/source` through macOS VirtioFS or certified Windows HCS Plan9.
3. Rehydrates the last atomic content-addressed `/workspace` manifest into a 128 MiB tmpfs.
4. Exchanges protocol-v3 hello/capabilities, hydration, repeated execution, bounded stdout/stderr chunks, typed lifecycle diagnostics, cancellation, workspace delta, result, and shutdown frames over the fixed socket. The M1 probe remains protocol v1.
5. Atomically writes complete Python or Node source to a safe workspace-relative path, or runs a command through `/bin/sh` from `/workspace`.
6. Separately mediates bounded model completions between Core and the host-native inference worker; the guest has no inference channel.
7. Returns and durably records the proposal, path, source or command, stdout, stderr, result, summary, artifacts, limits, and termination reason.
8. Atomically commits regular workspace files and directories after each responsive execution. Escaping links, devices, sockets, and traversing paths are rejected.
9. Keeps the VM as the only warm idle VM until another session, deletion, revocation, shutdown, helper failure, or memory pressure requires eviction.

The guest has no package manager authority, credentials, user home, host shell, general Vault Core endpoint, generic model server, approval authority, export authority, or network broker. Its `/bin/sh` is inside the no-NIC guest and has no host authority. Host source folders are never writable. Generated artifacts remain session-owned proposals; an explicit future export capability must be separately authorized.

## Guest Image

The V1 image contains only a reviewed, pinned offline toolset:

- Python 3 and Node.js matching the product runtime major.
- Python standard-library support for text, JSON, CSV, SQLite, archives, and subprocess-free data work.
- A minimal reviewed set for PDF, DOCX, XLSX, and image inspection.
- A tiny guest agent entrypoint and typed IPC codec.
- BusyBox and every executable named in `packages/workers/images/agent/capabilities.json`; Git, ripgrep, compilers, pip, npm, package managers, and downloadable libraries remain absent.

The exact library names, versions, licenses, notices, hashes, and purpose live in the machine-readable compliance and guest manifests. Package installation commands and package-manager network configuration are absent from the runtime image. Guest builds are reproducible and generated images are not committed.

## State And Recovery

Vault Core persists authoritative state in the existing schema-versioned workspace catalog, immutable artifact store, and per-session content-addressed guest-workspace manifests.

- Folder identity is canonical and stable across equivalent paths.
- A session belongs either to one folder grant or to the global New chat area.
- The newest five sessions per folder are one query, with cursor-based expansion for older sessions.
- Conversation turns and agent-run summaries commit atomically.
- Catalog schema v8 preserves the v7 normalized execution records and adds versioned inference turns linked to runs. New runs durably capture the exact effective prompt, canonical JSON schema, exact pre-parse structured result, worker request identifiers, limits, decision outcome, and execution sequence through immutable content hashes. Historical runs remain version 0 and explicitly report `not_recorded`; restart recovery marks unfinished turns `interrupted`.
- `agent.trace` resolves one run's ordered inference payloads for local diagnostics. `agent.list` remains the session run index, and `agent.get` remains the bounded polling response without trace payloads.
- Events, executions, messages, and audit metadata never copy trace payloads. Trace audit entries contain only identifiers, content hashes, outcomes, and execution links.
- The packaged `vault-core` executable has a private `debug-session` process mode that opens the catalog read-only and reconstructs one isolated session into a fresh owner-only temporary directory. The desktop derives the catalog internally and invokes this mode through fixed Tauri commands using only the selected session ID. It verifies immutable artifacts and a stable content-addressed workspace manifest, then preserves exact guest paths in a host-safe payload mapping without adding a daemon method, CLI command, or persistent product state.
- A daemon or guest crash leaves the previous committed conversation readable and the interrupted run explicitly failed or resumable.
- Raw hidden model reasoning is never persisted.
- Typed model thought segments are transient active-run state only; completed snapshots, events, audit, and conversation records never contain them.
- Generation speed, prompt-processing speed, and total response time are stored as bounded numeric run evidence.
- Conversation context is rebuilt from durable messages and execution events. Core reserves 4,096 output tokens, protects the current run and newest failed repair chain, anchors up to two recent user turns, and compacts older history without deleting originals.

## Model And Asset Distribution

The first V1 package is self-contained and performs zero downloads on first launch. It includes only approved runtime assets, one generation model, the guest image, and required native helpers whose hashes appear in the package manifest. The desktop selects the inference envelope automatically: 10 GiB on Macs through 16 GB, 12 GiB through 24 GB, 16 GiB above 24 GB, and the complete runtime-reported GPU VRAM capacity on Windows. An 8 GB Mac does not start inference and exposes a clear unsupported status. The worker fits the largest generation context from 8K through 256K inside the selected budget and reports the actual allocation. It keeps the approved model resident after first use. Manual unload or Core shutdown terminates the complete worker process so all native model and context resources are reclaimed together; the next request launches and verifies it again.

Downloaded development models, generated guest images, signed helpers, build output, coverage, reports, installers, and dependency directories remain ignored artifacts. Distribution requires notices, SBOMs, hashes, signatures, and platform package verification. A model-download build remains post-V1 work.

## Continuous Verification

`pnpm verify` remains the fast repository gate. `pnpm test:gate --milestone 3` is the V1 acceptance entrypoint and must fail rather than silently skip any required physical-platform, model, microVM, desktop, or packaging evidence.

Unit tests may use deterministic inference and guest fakes. Acceptance must use the real daemon, packaged sidecar, real host-native inference, real guest image, real microVM launchers, and real Tauri applications on macOS and Windows.

## Milestones

### M0 — Reproducible foundation — complete

M0 established the pinned workspace, CI, generic deterministic task fixtures, model manifest, dependency inventory, test-only Tauri capability probe, and provisional no-NIC guest validation. Its evidence remains in [M0_STATUS.md](M0_STATUS.md).

### M1 — Secure local control plane and microVMs — complete

M1 delivered workspace state, scoped files, atomic artifacts, audit, jobs, current-user daemon transports, CLI health, bounded worker staging, and certified no-NIC microVM launchers on macOS and Windows. Its evidence remains in [M1_STATUS.md](M1_STATUS.md).

### M2 — Supervised inference foundation — complete

The cross-platform supervisor, model resolver, memory scheduler, typed inference worker, grammar generation, embeddings, platform-native confinement, and real-model canaries are implemented. M3 reuses this completed foundation and integrates it into the packaged desktop product. [M2_STATUS.md](M2_STATUS.md) records the completed milestone evidence.

### M3 — Offline Dev-Agent Desktop V1 — active

Stage state: macOS implementation and physical acceptance pass; Windows implementation and physical acceptance remain open.

Scope:

- Add typed folder-grant, attachment, session, turn, agent-run, agent-event, and artifact contracts just in time.
- Add schema migrations and Core commands/queries for folder groups, the newest five sessions, cursor expansion, New chat, turns, attachments, drafts, and recovery.
- Add daemon methods and a typed desktop client for every M3 capability, including streaming or bounded event polling, cancellation, and reconnect.
- Build the product Tauri v2 and React desktop shell on macOS and Windows.
- Add native folder/file dialogs without exposing arbitrary paths to the webview.
- Implement the Vault Core-owned agent loop with bounded turns, typed inference mediation, cancellation, audit, and deterministic fake coverage.
- Build a reproducible agent guest image with Python, Node.js, BusyBox shell/tools, the reviewed fixed library set, a typed guest entrypoint, immutable root, live read-only source, and bounded persistent workspace.
- Extend the agent guest protocol to version 3 for hello/capabilities, workspace hydration, repeated execution, ordered bounded stdout/stderr frames, typed lifecycle diagnostics, cancellation, workspace deltas, structured results, and graceful shutdown while preserving the M1 probe protocol.
- Integrate the completed Windows native inference boundary into the agent product and verify the real V1 model on both platforms.
- On Windows, expose the selected source through host-read-only Plan9 plus a guest read-only mount, and remove the VM-specific recursive read grant when HCS teardown completes.
- Package the exact Vault Core sidecar, native helpers, model assets, and guest image with zero-download first launch.

Gate:

- A fresh install launches on physical Apple-silicon macOS and supported Windows x64 and connects only to its authenticated current-user daemon endpoint.
- The desktop can add and remove folder grants, create a folder session, create a New chat session, attach files, restore sessions after restart, show exactly five recent sessions per folder, and expand older sessions with Show more.
- A real local model completes at least one multi-step Python task and one multi-step Node.js task over folder inputs on both platforms.
- The guest can recursively read the unlimited authorized live folder and write only to its bounded workspace. It cannot mutate, create, rename, or delete anything in the host source folder.
- A folder with more than 64 files and a sparse file larger than 512 MiB preserves hierarchy without host copy limits; live host changes appear and guest writes fail.
- A failed program can be corrected at the same workspace path without rebooting, and the workspace survives VM and Core restart.
- VM configuration and runtime probes prove zero virtual network adapters and denial of DNS, IPv4, IPv6, LAN, multicast, host reachability, package installation, credentials, host paths, arbitrary host services, and generic model endpoints without command or destination matching.
- Traversal, symlink/junction escape, time-of-check/time-of-use replacement, malformed IPC, oversized input/output, process storms, timeout, cancellation, guest crash, daemon crash, and low-disk cases are contained and produce typed durable outcomes.
- The webview cannot invoke arbitrary shell commands, processes, paths, URLs, local endpoints, environments, model files, or filesystem operations.
- The conversation exposes concise activity and generated artifacts. Technical details opens to Overview; Logs initially shows collapsed executions newest first, auto-expands only the active execution after selection, exposes one bounded stream at a time, follows output only near the bottom, and never persists hidden reasoning.
- The approved model remains loaded between successful turns, reports its state in the desktop header, and unloads only through the typed idle-only Core command or Core shutdown.
- Supported Gemma thought segments stream through typed IPC into transient active-run state and are absent from persisted events, messages, audit, and terminal snapshots.
- The newest assistant response shows measured generation speed, prompt-processing speed, and total run time.
- Keyboard navigation, visible focus, screen-reader labels, reduced motion, resizing, and 200 percent scaling pass on both platform webviews.
- Packaged application checks cover install, first launch with zero downloads, sidecar and helper identity, restart, upgrade, uninstall, and preservation of user workspace state.
- Required notices, SBOMs, artifact manifests, hashes, signatures, and unsupported-hardware messages are present and accurate.
- On physical Windows x64, `pnpm test:m3:windows` proves real-Gemma Python and Node output before terminal state, typed diagnostics, cancellation retention, stdout truncation, malformed-frame HCS teardown, and session teardown. It is not a substitute for the remaining packaged-desktop evidence.

M3 closes only when all macOS and Windows evidence passes. Closing M3 is the Community Desktop V1 launch gate.

## Post-V1 Follow-up: Document Intelligence

After V1, one combined follow-up may add the former document-specific sequence as a single measured capability:

- Native parsing and crash-consistent manifests.
- OCR and layout routing.
- Structure-aware chunking and hybrid retrieval.
- Evidence packs, claim-level citations, and deterministic verification.

The generic agent remains available for novel tasks, but supported deterministic document operations may be added when measurements show they improve speed, accuracy, evidence quality, or model cost. This follow-up must not weaken the V1 microVM, read-only-host, no-network, session, or desktop contracts.

## Explicitly Deferred After V1

- Specialized professional workflow packs.
- Knowledge Bundle distribution and import.
- External integrations and their typed network broker.
- Model downloads and alternate runtime adapters.
- Office appliance multi-user controls.
- Linux desktop certification.

## V1 Launch And Contribution Activation

The V1 launch follows M3 certification. Until then, the repository owner remains the sole commit author and develops each implementation stage through short-lived branches and pull requests. At launch, contribution activation remains a separate owner decision; it is not required to ship the desktop app.

AI assistants, models, coding agents, and tools are never commit authors or co-authors.

## Change And Commit Policy

- Keep commits small and leave `pnpm verify` green.
- Beginning with M1, implementation reaches `main` only through a pull request.
- Keep generated binaries, models, guest images, reports, packages, coverage, and dependency directories out of Git.
- Record exact pass, fail, and not-run evidence before closing a gate.

## Revision History

| Date | Change |
|---|---|
| 2026-07-11 | Initial milestone plan (M0-M11) created with the three-layer architecture, AI-drivable daemon/CLI, tiered Gemma test models, and ground-truth evaluation. |
| 2026-07-11 | Added model distribution policy for development downloads and self-contained offline packages. |
| 2026-07-11 | Reordered the plan after implementation-readiness review: moved accounting, OCR, summary trees, compaction, recovery, and 12B gates before certification; added cross-platform CI and transport, persistent-state and worker-isolation boundaries, held-out/adversarial evaluation, redistribution and supply-chain gates, hardware detection, and pilot-readiness criteria. |
| 2026-07-12 | Replaced command-level worker network policy with a certified no-NIC microVM, added platform launcher gates and typed socket confinement, and retained a narrow OS-sandboxed native GPU exception. |
| 2026-07-12 | Added staged Knowledge Bundle contracts at M5 and signed offline import, rollback, and hostile-archive gates at M10. |
| 2026-07-13 | Replaced Electron with Tauri v2, specified the desktop layout and model selector behavior, and added deterministic document operations with a bounded no-NIC generated-code fallback. |
| 2026-07-13 | Linked IMPLEMENTATION_STRUCTURE.md as the file-level blueprint for the monorepo layout. |
| 2026-07-13 | Reconciled phase entry, just-in-time CI, M0 platform harnesses, schema ownership, MIME validation, session persistence, tool policy reuse, scratch-write authority, compaction ownership, and M10 bundle import with IMPLEMENTATION_STRUCTURE.md. |
| 2026-07-15 | Added the M0 contribution activation gate for licensing, human DCO authorship, GitHub protection, private reporting, and contribution-ready issues. |
| 2026-07-15 | Applied ADR 0016: Qwen3-Embedding-0.6B replaces EmbeddingGemma in test tiers and gates, two distribution flavors defined with the model-download build deferred after M11, and the Knowledge Bundle ADR renumbered to 0017. |
| 2026-07-15 | Added PrismML Bonsai as a research-derived post-M11 evaluation candidate, gated on stable upstream runtime support and the full model-certification suite. |
| 2026-07-15 | Recorded the committed Apache 2.0 license as resolved, made development platform-independent with platform-bound items as milestone-closure checkpoints, and moved contribution activation from M0 to the v1 launch with direct-to-main owner commits until then. |
| 2026-07-17 | Required owner pull requests for every implementation stage from M1 onward while retaining post-M11 activation for external contributors. |
| 2026-07-19 | Recorded the M1 review follow-up for authenticated and canonical local endpoints, audit-tail anchoring, bounded cancellable staging, and forced-exit recovery. |
| 2026-07-20 | Recorded cross-platform M2 completion after macOS Seatbelt and Windows AppContainer authority probes plus pinned Qwen and Gemma canaries passed. |
| 2026-07-20 | Replaced the long pre-product sequence with M3 Offline Dev-Agent Desktop V1, moved document intelligence after V1, and made the generic no-NIC coding agent the first product. |
| 2026-07-21 | Completed the M3 macOS implementation and physical acceptance while keeping the cross-platform launch gate open for Windows. |
| 2026-07-22 | Grouped sidebar creation actions under their Chats and Folders sections. |
| 2026-07-22 | Added hardware-derived macOS inference budgets, complete Windows GPU VRAM use, automatic context fitting up to 256K, and the unsupported 8 GB Mac behavior. |
| 2026-07-22 | Restored concise task activity and generated files to the conversation and reserved the renamed Technical details drawer for low-level evidence. |
| 2026-07-23 | Added protocol-v3 bounded live execution logs, typed VM diagnostics, normalized catalog schema v7 execution records, and the Overview-first Technical details design. |
| 2026-07-24 | Added catalog schema v8 durable per-run inference traces and the read-only `agent.trace` diagnostic method without persisting hidden reasoning. |
| 2026-07-24 | Added the initial on-demand read-only local session debug snapshot and source-tree command. |
| 2026-07-24 | Moved session snapshot creation into the packaged Core executable and added fixed installed-app create and reveal controls. |
