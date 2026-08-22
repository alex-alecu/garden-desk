# Implementation Plan

Updated: 2026-08-14

This is the authoritative implementation sequence for the first Vault Desk release. M0, cross-platform M1, and cross-platform M2 are complete. The repository owner activated M3 on 2026-07-20 as the first full product milestone. The macOS stage and prior Windows headless, guest, and installed-product integration are physically certified. The new Antiword x86_64 guest still requires its physical Windows gate; generated-file packaged-app evidence, dedicated-standard-user setup, macOS lower-tier context, and release-signing evidence also remain before M3 or Community Desktop V1 can close.

The shortest path to V1 is a generic offline desktop agent, not a format-specific document pipeline. The agent may write and run Python or Node.js programs and installed guest commands inside a session-scoped no-NIC microVM. It sees the selected folder live and read-only at `/source` and works in a persistent bounded `/workspace`. It cannot write to the selected host folder, install packages, reach a network, inherit credentials, or call an unrestricted host service.

## Change Brief

- Goal: ship a functional macOS and Windows desktop application with a generic local coding agent inspired by the interaction model of OpenCode and the desktop structure of the Codex app.
- Active milestone: M3 — Offline Dev-Agent Desktop V1.
- Allowed scope: Tauri/React desktop, native folder and file selection, grouped persistent sessions, local daemon APIs, host-native text and image model mediation, a session-scoped code-agent microVM, fixed offline runtimes and tools, typed execution results, audit, cancellation, packaging, platform evidence, and the owner-approved 14-skill prompt-only professional review set. The review skills reuse the generic skill tool and existing format workflows; they may not add domain routing, domain policy, or domain parsing to Core.
- Product boundaries: the webview has no direct filesystem, process, shell, environment, or network authority. Vault Core owns grants, sessions, policy, audit, inference mediation, workspace manifests, worker limits, and lifecycle. The guest receives only the live read-only folder, immutable attachments, and its bounded writable workspace.
- Risks: guest-image size and reproducibility, Windows/macOS packaging differences, multi-step agent-loop correctness, local-model latency, recovery, and accidental host authority.
- Acceptance evidence: a packaged app on physical macOS and Windows; folder and attachment flows; direct and delegated image inspection; grouped session and workspace restoration; real multi-step Python, Node.js, and shell tasks; structural network denial; host-write and package-install denial; cancellation/restart recovery; and signed sidecar and guest-image verification. The professional skill set also requires 12 synthetic held-out domain cases and two negative routing cases with real Gemma on each platform. The first successful skill loads must put `document-review` before the selected domain skill. Cases must reject unrelated domain skills, cite all tested evidence, retain required values, state the applicable human-review limit, resist source instructions, and avoid prohibited professional conclusions. The negative cases must complete ordinary text and DOCX work without a professional review skill. Qualified legal, finance, and medical-administration reviewers must approve the 12 domain results from each platform before release.
- Dependencies affected: reviewed and pinned React/Tauri frontend packages plus a reviewed guest-library manifest. OpenCode is a design reference, not a required dependency.
- Explicitly not doing before V1: canonical document ingestion, OCR/layout routing, hybrid retrieval, deterministic citation verification, domain-specific Core behavior, professional workflows outside the named prompt-only review set, diagnosis, treatment, triage, autonomous approval or denial, Knowledge Bundle import, external integrations, or model downloads.

## Product Architecture

Three layers remain mandatory:

1. **Tauri desktop** — React and TypeScript in the operating-system webview plus the minimum Rust needed for window lifecycle, native dialogs, exact Vault Core sidecar supervision, and connection bootstrap.
2. **Vault Core** — the separate Node.js/TypeScript authority for folder and attachment grants, sessions, jobs, policy, audit, model scheduling, inference mediation, worker supervision, and typed daemon methods.
3. **Workers** — a narrowly sandboxed host-native inference process and a reusable session-scoped no-NIC microVM for agent-authored code and installed guest commands.

The desktop communicates only through narrow typed Tauri commands and the current-user-only local daemon protocol. TCP is not enabled. Every M3 backend capability is exercised through both the programmatic facade and daemon protocol before the desktop consumes it.

## V1 User Experience

The compact resizable left sidebar has a Chats section whose first option is the global **New chat** action, followed by recent global chats. Its Folders section begins with **Add folder**, followed by folder groups. Each folder group shows its five most recent sessions and a **Show more** control when older sessions exist. Session rows expose deletion on hover or keyboard focus. All conversation, folder-grant, and attachment removals require explicit confirmation.

A New chat action prepares a blank composer with no folder grant and does not persist a placeholder session until the user submits a message or selects attachments. Explicit files remain immutable session-owned attachments. A folder conversation grants a live read-only mount of the selected folder without enumerating or copying it. Switching sessions restores the conversation, selected context, tool activity, draft text, and durable guest workspace; selecting the session begins VM boot and hydration in the background when the hardware-derived warm pool has room.

The image tool accepts one Core-validated PNG or JPEG from an immutable attachment or a regular file below the selected folder. One ordinary direct-image question stays in the primary run. Exact transcription, structured extraction, and multi-image work use one general child; only its short final report enters the primary history. The image runtime never receives a folder, attachment store, conversation, or network authority.

The main pane is conversation-first. Its header shows the approved model name, on-device residency state, an idle-only manual unload action, and a Technical details control. It shows all streamed assistant output as safe GitHub Flavored Markdown, including single-line responses; user messages remain literal text. Partial response text stays in active memory and uses a stable draft row; only the accepted completed response is stored. Long response code blocks and tables use keyboard-accessible, window-bounded scroll areas. It also shows transient typed thought segments when the approved model supports them, concise code/tool activity, warnings, failures, and cancellation state in chronological order. An expanded activity row can show a bounded, scrollable detail preview. Explicitly requested generated-file deliverables appear beneath their matching assistant response and before response-speed metrics, with Open and Save As actions. Complete scripts, commands, intermediate files, and logs remain in Technical details Steps. Successful execution activity uses plain-language step completion rather than runtime names or exit codes. The right-side Technical details drawer reduces the conversation workspace instead of covering it; its Overview tab is the sole presentation surface for live memory allocation, memory budget and context, and also shows the current session ID and catalog path plus fixed controls to create and reveal a private AI-agent debugging snapshot with SQLite-backed session records and bounded microVM logs. Its separate Steps tab contains one ordered step list that exposes generated code, bounded live output, errors, and typed VM diagnostics one collapsed step at a time, together with the recorded prompt, requested result shape, decision, termination, and exit code read on demand for that step's run. Read-only step evidence boxes resize vertically to a window-bounded maximum, wrap text on request, and copy their exact text to the local clipboard. The preview action for an inline activity step opens that tab and step directly. Assigned Python and Node source files show their guest filename, language, and local syntax highlighting. The composer remains anchored at the bottom. Arbitrary model/runtime configuration stays out of the ordinary interface.

## Agent Execution Contract

Vault Core owns the agent loop. The model may propose a script or request the next bounded observation, but it never receives execution authority.

Each agent session:

1. Validates and canonicalizes the native-picker folder grant in Core; the webview retains only opaque identifiers.
2. Starts or reuses the session VM with zero virtual NICs and mounts the exact folder read-only at `/source` through macOS VirtioFS or certified Windows HCS Plan9.
3. Rehydrates the last atomic content-addressed `/workspace` manifest into a 128 MiB tmpfs.
4. Exchanges protocol-v3 hello/capabilities, hydration, repeated execution, bounded stdout/stderr chunks, typed lifecycle diagnostics, cancellation, workspace delta, result, and shutdown frames over the fixed socket. The M1 probe remains protocol v1.
5. Atomically writes complete Python source or Node `.mjs` ES-module source to a safe workspace-relative path, or runs a typed `/bin/sh` command from `/workspace`. Core executes model-authored source and returns the guest's real exit status, stdout, stderr, and termination as the tool result; it does not reject programs by source pattern. Read, glob, grep, and list operations use the same guest boundary. Specialized instructions load only when the model calls the generic `skill` tool.
6. Separately mediates bounded model completions between Core and the host-native inference worker; the guest has no inference channel.
7. Returns and durably records each tool call, path, source or command, stdout, stderr, result, summary, workspace changes, limits, and termination reason. The final text response ends the loop when it contains no tool calls.
8. Atomically commits regular workspace files and directories after each responsive execution. Escaping links, devices, sockets, and traversing paths are rejected.
9. Keeps idle VMs in a least-recently-used pool bounded by total RAM after the inference cap and host reserve. Different conversations may run concurrently up to that capacity; their model turns run on the one resident Gemma worker, which loads the model once and exposes multiple parallel context sequences (up to a memory-bounded count) so several turns can generate concurrently; turns beyond the available sequence slots queue. Excess runs remain queued without starting another VM.

The guest has no package manager authority, credentials, user home, host shell, general Vault Core endpoint, generic model server, approval authority, export authority, or network broker. Its `/bin/sh` is inside the no-NIC guest and has no host authority. Host source folders are never writable. At successful finalization, Core hashes and persists verified regular files created or changed by successful executions, excluding internal tool state and intermediate code. Opening uses a verified owner-only temporary copy; Save As uses a native dialog and an atomic Core write without returning the selected destination path to the webview.

## Guest Image

The V1 image contains only a reviewed, pinned offline toolset:

- Python 3 and Node.js matching the product runtime major.
- Python standard-library support for text, JSON, CSV, SQLite, archives, and subprocess-free data work.
- A minimal reviewed set for PDF, DOCX, XLSX, legacy DOC text reading, and image work, including pypdf, python-docx, openpyxl, Antiword, and the pure-Python ReportLab wheel.
- A tiny guest agent entrypoint and typed IPC codec.
- BusyBox and every executable named in `packages/workers/images/agent/capabilities.json`; Git, ripgrep, compilers, pip, npm, package managers, and downloadable libraries remain absent.

The exact library names, versions, licenses, notices, hashes, and purpose live in the machine-readable compliance and guest manifests. Package installation commands and package-manager network configuration are absent from the runtime image. Guest builds are reproducible and generated images are not committed.

## State And Recovery

Vault Core persists authoritative state in the existing schema-versioned workspace catalog, immutable artifact store, and per-session content-addressed guest-workspace manifests.

- Folder identity is canonical and stable across equivalent paths.
- A session belongs either to one folder grant or to the global New chat area.
- The newest five sessions per folder are one query, with cursor-based expansion for older sessions.
- Conversation turns and agent-run summaries commit atomically.
- Catalog schema v13 preserves historical execution and structured inference records, stores one replaceable anchored session summary per session, and adds parent run IDs plus tool identity on events. New runs durably capture exact message histories, advertised tool schemas, returned text/tool calls, worker request identifiers, limits, and chat or compaction outcomes through immutable content hashes. Historical runs remain readable and explicitly report `not_recorded` when traces predate capture; restart recovery marks unfinished turns `interrupted`.
- `agent.trace` resolves one run's ordered inference payloads for local diagnostics. The desktop reads it on demand through a fixed Tauri command when a step is selected in Technical details, never during run polling, because each turn inflates content-addressed prompt, schema, and response bytes. `agent.list` remains the session run index, and `agent.get` remains the bounded polling response without trace payloads.
- Events, executions, messages, and audit metadata never copy trace payloads. Trace audit entries contain only identifiers, content hashes, outcomes, and execution links.
- The packaged `vault-core` executable has a private `debug-session` process mode that opens the catalog read-only and reconstructs one isolated session into a fresh owner-only temporary directory. The desktop derives the catalog internally and invokes this mode through fixed Tauri commands using only the selected session ID. It verifies immutable artifacts and a stable content-addressed workspace manifest, then preserves exact guest paths in a host-safe payload mapping without adding a daemon method, CLI command, or persistent product state.
- A daemon or guest crash leaves the previous committed conversation readable and the interrupted run explicitly failed or resumable.
- Raw hidden model reasoning is never persisted.
- Typed model thought segments enter transient active-run state and may remain in session-scoped desktop memory until application close; completed snapshots, events, audit, and conversation records never contain them.
- Generation speed, prompt-processing speed, and total response time are stored as bounded numeric run evidence.
- The Core-owned loop sends persistent conversation history and generic tool definitions to the worker for each native chat turn. A cold run requests automatic context and keeps that request shape stable while budgeting from the worker's measured allocation. It permits 40 model turns and 24 guest executions. The third consecutive byte-identical call is blocked with a change-approach reminder. Tool output retains 2,000 lines or 50 KiB in context and spills the complete value under `/workspace/.vault-output` for targeted retrieval. Chat output uses up to 16,384 tokens while reserving at least 4,096 tokens for the prompt, and compact summaries stay bounded at 2,048. An explicit question-tool test makes the first turn one question call without a planning turn.
- Measured prompt use at 80 percent of the allocation triggers a no-tool anchored summary while preserving the current user request and last two assistant/tool turns verbatim. Three consecutive failed tools roll live history back to the last checkpointed working step, replace the failed direction with one short deterministic failure note carrying its last evidence, and request a materially different approach. Durable records are never deleted by compaction or rollback.
- Exit status and termination determine tool success. Stderr alone is evidence, not failure. Nonzero exits, timeouts, cancellations, resource limits, and crashes remain visible to the model as real tool results.
- When verbatim older conversation exceeds the allocation-derived history budget, Core uses one anchored session summary that later turns merge into rather than re-derive. The summary is untrusted continuity prose: it records objective, constraints, work state, and next move, never carries authoritative `LABEL=value` values, artifact names, or completion state, and never selects instructions. It is produced only after the worker reports an allocation of at least 16,384 tokens, selects the largest pending-message prefix that fits that allocation, and runs outside the completed-run transaction. A summary inference gets one fresh-identity retry only for `internal`, `worker_crash`, or `malformed_worker_message`; every other failure and a repeated failure fall back to deterministic history excerpts so a run outcome never depends on the summary.
- If a turn reaches its output limit without a tool call, Core discards it and requests one immediate typed tool call or concise answer. It keeps tools available and compacts only when measured prompt use is also at least 80 percent of the context allocation. A second output-limit turn fails with `agent_generation_limit`. Successful runs independently expose the latest non-internal files observed in workspace deltas; no model-authored declaration or format-specific completion marker is required.
- All agent behavior is authored under root `prompts/`: `agents/*.md` carries validated name, description, primary/subagent mode, literal tools, temperature, steps, and system body; `skills/*/SKILL.md` carries only name, description, and on-demand guidance; `system/*.md` carries compaction and legacy structured-call instructions. Core lists skill metadata without loading bodies and contains no document-format routing or recovery policy. Packaged prompt assets remain offline resources covered by the package manifest; Windows verifies and read-locks every prompt before Core starts.
- The 14 professional review skills are `document-review`, `review-report`, `legal-document-review`, `legal-document-comparison`, `legal-due-diligence-review`, `legal-matter-chronology`, `finance-document-review`, `financial-records-reconciliation`, `invoice-expense-review`, `budget-variance-review`, `medical-record-review`, `medical-record-timeline`, `prior-authorization-document-review`, and `medical-billing-document-review`. `document-review` owns shared evidence rules. `review-report` loads only for an explicit formal, polished, executive, decision-ready, DOCX, or PDF result. The other 12 skills own focused domain work.

## Model And Asset Distribution

The first V1 package is self-contained and performs zero downloads on first launch. It includes only approved prompt assets, runtime assets, one generation model, its image projector, the pinned llama.cpp image runtime, the guest image, and required native helpers whose hashes appear in the package manifest. One Windows x64 package carries the pinned CUDA 13.1 binding and cuBLAS redistributables together with Vulkan. The official llama.cpp archive supplies its Microsoft OpenMP runtime, and the package adds only the three Visual C++ DLLs that its imports require from one hash-pinned official Microsoft package. TypeScript probes both packaged backends and selects one mapped adapter. The user does not need a separate package for a GPU brand. The self-contained model exceeds NSIS's package limit, so the M3 Windows artifact is a signed copy-installed application directory with the same copy, restart, replacement, and removal lifecycle as the macOS application bundle; public release installers remain a separate credentialed distribution step.

The desktop and Vault Core run without administrator privileges on Windows and macOS. Hyper-V must already be enabled on Windows Pro or Enterprise. When the current Windows token lacks HCS authority, the desktop explains the standing permission and may launch one fixed, signed, hash-verified helper through UAC. That helper derives the requesting SID from the non-elevated parent process and adds only that account to Hyper-V Administrators. Until a new Windows sign-in activates the membership, the desktop is browse-only and rejects new tasks at the Tauri boundary. The Windows package and development resources contain the helper; the macOS bundle does not, and macOS has no administrator setup. Hyper-V Administrators grants every process under the configured Windows account Hyper-V management authority.

Before the packaged host launches sensitive children, it verifies the sidecar and the signed-application-anchored resource manifest, verifies fixed native helpers and every prompt asset against that manifest, and retains non-writable read locks until shutdown so a user-writable copy cannot swap children or instructions after verification. The setup helper receives the same verification and lock before elevation. The webview retains the same fixed capability set and cannot invoke arbitrary process or setup operations. The desktop selects the inference envelope automatically. Macs use the existing 10/12/16 GiB tiers. On Windows, the worker selects one usable dedicated GPU first and uses its complete isolated memory if it has at least 8 GiB. If no dedicated GPU is usable, it selects one integrated GPU. Installed RAM sets an integrated maximum of 8 GiB at exactly 16 GiB, 12 GiB above 16 GiB through 24 GiB, and 16 GiB above 24 GiB. The isolated runtime capacity selects the highest fixed tier that fits. Less than 16 GiB installed RAM or less than 8 GiB isolated capacity is unsupported. Brand and speed do not decide support. The worker fits the largest context inside the budget. Shared memory has a 64K cap through 32 GiB installed RAM and 128K above it. Dedicated memory has a 64K cap through 24 GiB and 128K above it. It reports the actual allocation, memory kind, backend, and one selected device. Manual unload or Core shutdown terminates the complete worker process.

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

Stage state: macOS implementation and physical acceptance pass; Windows implementation, refreshed guest document probe, canonical physical headless acceptance, and installed-product UI, live-execution, and debug-snapshot observations pass; generated-file Open and Save As observations on both packaged platforms, dedicated-standard-user setup, macOS lower-tier context, and release-signing observations remain open.

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
- The conversation exposes concise activity and response-grouped generated-file deliverables with verified Open and Save As actions. A current typed thought segment stays open in its intermediate activity step and follows the last streamed text row; it remains available in desktop memory and collapses when the step ends. Technical details contains no generated-file metadata; it opens to Overview, while Steps remains a separate tab with collapsed entries, syntax-highlighted Python and Node source, one bounded stream at a time, near-bottom output following, and no persisted hidden reasoning.
- The approved model remains loaded between successful turns, reports its state in the desktop header, and unloads only through the typed idle-only Core command or Core shutdown.
- Supported Gemma thought segments stream through typed IPC into transient active-run state, may remain in session-scoped desktop memory until application close, and are absent from persisted events, messages, audit, and terminal snapshots.
- The newest assistant response shows measured generation speed, prompt-processing speed, and total run time.
- Keyboard navigation, visible focus, screen-reader labels, reduced motion, resizing, and 200 percent scaling pass on both platform webviews.
- Packaged application checks cover install, first launch with zero downloads, sidecar and helper identity, restart, upgrade, uninstall, and preservation of user workspace state.
- Required notices, SBOMs, artifact manifests, hashes, signatures, and unsupported-hardware messages are present and accurate.
- On physical Windows x64, `pnpm test:m3:windows` proves the same live read-only source hierarchy, persistent bounded workspace, Python, Node.js, shell, repair, no-NIC isolation, cancellation, timeout, output, process, memory, quota, crash, escaping-link, and rehydration evidence as macOS. It also proves real-Gemma Python and Node output before terminal state, typed diagnostics, cancellation retention, stdout truncation, malformed-frame HCS teardown, and session teardown. It is not a substitute for packaged-desktop evidence.

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
| 2026-08-04 | Restricted Windows automatic inference budgets and context tiers to one device's dedicated VRAM. |
| 2026-08-15 | Added one-device, dedicated-first Windows selection and integrated 8/12/16 GiB shared-memory tiers. |
| 2026-08-17 | Let an integrated adapter use the next lower fixed tier when driver-reserved memory makes its installed-RAM tier too large. |
| 2026-07-22 | Grouped sidebar creation actions under their Chats and Folders sections. |
| 2026-07-22 | Added hardware-derived macOS inference budgets, complete Windows GPU VRAM use, automatic context fitting up to 256K, and the unsupported 8 GB Mac behavior. |
| 2026-07-22 | Restored concise task activity and generated files to the conversation and reserved the renamed Technical details drawer for low-level evidence. |
| 2026-07-23 | Added protocol-v3 bounded live execution logs, typed VM diagnostics, normalized catalog schema v7 execution records, and the Overview-first Technical details design. |
| 2026-07-24 | Added catalog schema v8 durable per-run inference traces and the read-only `agent.trace` diagnostic method without persisting hidden reasoning. |
| 2026-07-24 | Added the initial on-demand read-only local session debug snapshot and source-tree command. |
| 2026-07-24 | Moved session snapshot creation into the packaged Core executable and added fixed installed-app create and reveal controls. |
| 2026-07-25 | Added memory-bounded parallel conversations, serialized reuse of one resident Gemma worker, sidebar working state, and explicit budget-versus-allocation presentation. |
| 2026-07-27 | Defined one self-contained Windows x64 package with automatic CUDA-first and Vulkan-fallback inference plus a copy-installed directory format that can carry the offline V1 model. |
| 2026-07-28 | Certified the physical Windows headless product gate, including HCS Plan9, the packaged CUDA/AppContainer worker, the reproducible x86_64 guest, and the single CUDA/Vulkan application directory. |
| 2026-07-28 | Added catalog schema v9 persistent folder ordering and completed attachment open, transfer, and native drop contracts. |
| 2026-08-01 | Replaced the 256K automatic context ceiling with 64K and 128K hardware caps that preserve Mac unified memory. |
| 2026-08-06 | Added inspectable current-run context compaction and artifact delivery for verified results that exceed the response contract. |
| 2026-08-08 | Bound execution and conversation compaction to the reported allocation, retained ranked evidence per execution across repeated turnover, and added bounded summary backlog and structured-call recovery. |
| 2026-08-08 | Allowed exit-zero bounded output evidence to finalize after the typed resource limit while retaining source-only recovery for actual failures. |
| 2026-08-04 | Added declared generated-file deliverables, verified Open and atomic Save As flows, and product-owned DOCX, XLSX, and PDF skills with pinned ReportLab. |
| 2026-08-12 | Recorded that the resident worker exposes multiple parallel context sequences for concurrent turns (bounded sub-agent parallelism in V1) with overflow queued, and added a flat worked/working activity timeline with a live context meter. |
| 2026-08-14 | Kept supported typed thought segments in session-scoped desktop memory until application close, with live last-row following and completed-step collapse. |
| 2026-08-14 | Added the guest Antiword reader and one Word skill for DOCX work and legacy DOC plain-text input. |
| 2026-08-15 | Allowed the owner-approved prompt-only legal and finance review skills in M3 while keeping domain routing, parsing, policy, and other workflows deferred. |
| 2026-08-15 | Expanded M3 to the owner-approved 14-skill professional review set, with medical work limited to administration and with cross-platform and qualified reviewer release gates. |
| 2026-08-15 | Added direct and delegated image context with a pinned offline model projector, llama.cpp image runtime, and application-local Windows runtime dependencies. |
