# Implementation Plan

Updated: 2026-08-28

This is the authoritative implementation sequence for the first Garden Desk release. M0, cross-platform M1, and cross-platform M2 are complete. The repository owner activated M3 on 2026-07-20 as the first full product milestone. Current M3 evidence, what remains open, and how to run the golden tasks are in [M3_STATUS.md](M3_STATUS.md).

The shortest path to V1 is a generic offline desktop agent, not a format-specific document pipeline. The agent may write and run Python or Node.js programs and installed guest commands inside a session-scoped no-network microVM. It sees the selected folder live and read-only at `/source` and works in a persistent bounded `/workspace`. It cannot write to the selected host folder, install packages, reach a network, inherit credentials, or call an unrestricted host service.

## Change Brief

- Goal: ship a functional macOS and Windows desktop application with a generic local coding agent inspired by the interaction model of OpenCode and the desktop structure of the Codex app.
- Active milestone: M3 — Offline Dev-Agent Desktop V1.
- Allowed scope: Tauri/React desktop, native folder and file selection, grouped persistent sessions, local daemon APIs, host-native text and image model mediation, a session-scoped code-agent microVM, fixed offline runtimes and tools, typed execution results, audit, cancellation, packaging, platform evidence, and the owner-approved 14-skill prompt-only professional review set. The review skills use the generic skill tool and prompt-only format methods; they may not add domain routing, domain policy, domain parsing, format routing, or skill-body selection to Core.
- Product boundaries: the webview has no direct filesystem, process, shell, environment, or network authority. Vault Core owns grants, sessions, policy, audit, inference mediation, workspace manifests, worker limits, and lifecycle. The guest receives only the live read-only folder, immutable attachments, and its bounded writable workspace.
- Risks: guest-image size and reproducibility, Windows/macOS packaging differences, multi-step agent-loop correctness, local-model latency, recovery, and accidental host authority.
- Acceptance evidence: a packaged app on physical macOS and Windows; folder and attachment flows; direct and delegated image inspection; grouped session and workspace restoration; real multi-step Python, Node.js, and shell tasks; structural network denial; host-write and package-install denial; cancellation/restart recovery; and signed sidecar and guest-image verification. The professional review skill set ships as prompt-only skills; its outputs get a blind qualified-reviewer check (legal, finance, medical administration) on each platform before release, with no automated model-evidence gate.
- Dependencies affected: reviewed and pinned React/Tauri frontend packages plus a reviewed guest-library manifest. OpenCode is a design reference, not a required dependency.
- Explicitly not doing before V1: canonical document ingestion, OCR/layout routing, hybrid retrieval, deterministic citation verification, domain-specific Core behavior, professional workflows outside the named prompt-only review set, diagnosis, treatment, triage, autonomous approval or denial, Knowledge Bundle import, external integrations, or model downloads.

## Product Architecture

Three layers remain mandatory:

1. **Tauri desktop** — React and TypeScript in the operating-system webview plus the minimum Rust needed for window lifecycle, native dialogs, exact Vault Core sidecar supervision, and connection bootstrap.
2. **Vault Core** — the separate Node.js/TypeScript authority for folder and attachment grants, sessions, jobs, policy, audit, model scheduling, inference mediation, worker supervision, and typed daemon methods.
3. **Workers** — a narrowly sandboxed host-native inference process and a reusable session-scoped no-network microVM for agent-authored code and installed guest commands.

The desktop communicates only through narrow typed Tauri commands and the current-user-only local daemon protocol. TCP is not enabled. Every M3 backend capability is exercised through both the programmatic facade and daemon protocol before the desktop consumes it.

## V1 User Experience

The compact resizable left sidebar has a Chats section whose first option is the global **New chat** action, followed by recent global chats. Its Folders section begins with **Add folder**, followed by folder groups. Each folder group shows its five most recent sessions and a **Show more** control when older sessions exist. Session rows expose deletion on hover or keyboard focus. All conversation, folder-grant, and attachment removals require explicit confirmation.

A New chat action prepares a blank composer with no folder grant and does not persist a placeholder session until the user submits a message or selects attachments. Explicit files remain immutable session-owned attachments. A folder conversation grants a live read-only mount of the selected folder without enumerating or copying it. Switching sessions restores the conversation, selected context, tool activity, draft text, and durable guest workspace; selecting the session begins VM boot and hydration in the background when the hardware-derived warm pool has room.

The image tool accepts one Core-validated PNG or JPEG from an immutable attachment or a regular file below the selected folder. One ordinary direct-image question stays in the primary run. Exact transcription, structured extraction, and multi-image work use one general child; only its short final report enters the primary history. The image runtime never receives a folder, attachment store, conversation, or network authority.

The main pane is conversation-first. Its header shows the approved model name, on-device residency state, an idle-only manual unload action, and a Technical details control. It shows all streamed assistant output as safe GitHub Flavored Markdown, including single-line responses; user messages remain literal text. Partial response text stays in active memory and uses a stable draft row; only the accepted completed response is stored. Long response code blocks and tables use keyboard-accessible, window-bounded scroll areas. It also shows transient typed thought segments when the approved model supports them, concise code/tool activity, warnings, failures, and cancellation state in chronological order. An expanded activity row can show a bounded, scrollable detail preview. Explicitly requested generated-file deliverables appear beneath their matching assistant response and before response-speed metrics, with Open and Save As actions. Complete scripts, commands, intermediate files, and logs remain in Technical details Steps. Successful execution activity uses plain-language step completion rather than runtime names or exit codes. The right-side Technical details drawer reduces the conversation workspace instead of covering it; its Overview tab is the sole presentation surface for live memory allocation, memory budget and context, and also shows the current session ID and catalog path plus fixed controls to create and reveal a private AI-agent debugging snapshot with SQLite-backed session records and bounded microVM logs. Its separate Steps tab contains one ordered step list that exposes generated code, bounded live output, errors, and typed VM diagnostics one collapsed step at a time, together with the recorded prompt, requested result shape, decision, termination, and exit code read on demand for that step's run. Read-only step evidence boxes resize vertically to a window-bounded maximum, wrap text on request, and copy their exact text to the local clipboard. The preview action for an inline activity step opens that tab and step directly. Assigned Python and Node source files show their guest filename, language, and local syntax highlighting. The composer remains anchored at the bottom. Arbitrary model/runtime configuration stays out of the ordinary interface.

## Agent Execution Contract

Vault Core owns the agent loop; the model never receives execution authority.

- **Prompt**: `prompts/agents/primary.md` defines the system prompt, the fixed tool set, and a 40-turn cap.
- **Tools**: `bash`, `python`, `node`, `read`, `glob`, `grep`, `list`, `write`, `edit`, `image`, `skill`, `task`, and `question`. `read`, `glob`, `grep`, and `list` inspect the guest; `write` and `edit` change files only under `/workspace`; `bash`, `python`, and `node` run inside the guest. `task` starts a child agent in the same session and VM, used only when the user explicitly asks for delegation or parallel work. Specialized instructions load on demand through `skill`.
- **Guest execution**: each session starts or reuses a no-network microVM with `/source` mounted live and read-only through macOS VirtioFS or certified Windows HCS Plan9, and a 128 MiB persistent `/workspace` rehydrated from its last atomic content-addressed manifest. Core validates every tool call before it runs, sends it over the fixed versioned host/guest socket, and returns the guest's real exit status, stdout, and stderr as the tool result; it does not reject programs by source pattern. Escaping links, devices, sockets, and traversing paths are rejected.
- **Artifacts**: every file created or changed under `/workspace` during a run is delivered to the user; there is no internal-versus-deliverable classification.

Core mediates model completions through the host-native inference worker in Gemma 4's own native tool-call format; the guest has no inference channel. Idle VMs sit in a least-recently-used pool bounded by total RAM after the inference cap and host reserve; different conversations may run concurrently up to that capacity, with model turns queued through one resident inference worker.

The guest has no package manager authority, credentials, user home, host shell, general Vault Core endpoint, generic model server, approval authority, export authority, or network broker. Host source folders are never writable. Opening a deliverable uses a verified owner-only temporary copy; Save As uses a native dialog and an atomic Core write without returning the selected destination path to the webview.

## Guest Image

The V1 image contains only a reviewed, pinned offline toolset:

- Python 3 and Node.js matching the product runtime major.
- Python standard-library support for text, JSON, CSV, SQLite, archives, and subprocess-free data work.
- A minimal reviewed set for PDF, DOCX, XLSX, legacy DOC text reading, and image work, including pypdf, python-docx, openpyxl, Antiword, and the pure-Python ReportLab wheel.
- A tiny guest agent entrypoint and typed IPC codec.
- BusyBox and every executable named in `packages/workers/images/agent/capabilities.json`; Git, ripgrep, compilers, pip, npm, package managers, and downloadable libraries remain absent.

The exact library names, versions, licenses, notices, hashes, and purpose live in the machine-readable compliance and guest manifests. Package installation commands and package-manager network configuration are absent from the runtime image. Guest builds are reproducible and generated images are not committed.

## State And Recovery

Vault Core persists authoritative state in the schema-versioned workspace catalog, the immutable content-addressed artifact store, and per-session content-addressed guest-workspace manifests.

- **Crash recovery**: a daemon or guest crash leaves the last committed conversation readable. On restart, Core marks any run left `queued` or `running` as failed, and the guest workspace rehydrates from its last committed manifest.
- **Compaction**: measured prompt use at 80 percent of the allocated context triggers a no-tool summarization turn. It replaces the older conversation head with a model-written summary while the current user request and the last two assistant/tool turns stay verbatim. Durable messages, executions, traces, and audit records are never touched by compaction.
- **Session summary**: after a completed run reports a measured chat allocation of at least 16,384 tokens, Core queues one session-summary refresh so a later conversation keeps continuity. The per-session queue is ordered and non-fatal; each attempt gets a new request identity, one retry is allowed only for an approved worker failure, and pending work is cancelled at shutdown.

Agent and skill instructions are authored under root `prompts/`; see [IMPLEMENTATION_STRUCTURE.md](IMPLEMENTATION_STRUCTURE.md) for the folder map and the skill catalog.

## Model And Asset Distribution

The first V1 package is self-contained and performs zero downloads on first launch. It includes only approved prompt assets, runtime assets, one generation model, its image projector, the pinned llama.cpp image runtime, the guest image, and required native helpers whose hashes appear in the package manifest. One Windows x64 package carries the pinned CUDA 13.1 binding and cuBLAS redistributables together with Vulkan. The official llama.cpp archive supplies its Microsoft OpenMP runtime, and the package adds only the three Visual C++ DLLs that its imports require from one hash-pinned official Microsoft package. TypeScript probes both packaged backends and selects one mapped adapter. The user does not need a separate package for a GPU brand. The self-contained model exceeds NSIS's package limit, so the M3 Windows artifact is a signed copy-installed application directory with the same copy, restart, replacement, and removal lifecycle as the macOS application bundle; public release installers remain a separate credentialed distribution step.

The desktop and Vault Core run without administrator privileges on Windows and macOS. Hyper-V must already be enabled on Windows Pro or Enterprise. When the current Windows token lacks HCS authority, the desktop explains the standing permission and may launch one fixed, signed, hash-verified helper through UAC. That helper derives the requesting SID from the non-elevated parent process and adds only that account to Hyper-V Administrators. Until a new Windows sign-in activates the membership, the desktop is browse-only and rejects new tasks at the Tauri boundary. The Windows package and development resources contain the helper; the macOS bundle does not, and macOS has no administrator setup. Hyper-V Administrators grants every process under the configured Windows account Hyper-V management authority.

Before the packaged host launches sensitive children, it verifies the sidecar and the signed-application-anchored resource manifest, verifies fixed native helpers and every prompt asset against that manifest, and retains non-writable read locks until shutdown so a user-writable copy cannot swap children or instructions after verification. The setup helper receives the same verification and lock before elevation. The webview retains the same fixed capability set and cannot invoke arbitrary process or setup operations. The desktop selects the inference envelope automatically. Macs use the existing 10/12/16 GiB tiers. On Windows, the worker selects one usable dedicated GPU first and uses its complete isolated memory if it has at least 8 GiB. If no dedicated GPU is usable, it selects one integrated GPU. Installed RAM sets an integrated maximum of 8 GiB at exactly 16 GiB, 12 GiB above 16 GiB through 24 GiB, and 16 GiB above 24 GiB. The isolated runtime capacity selects the highest fixed tier that fits. Less than 16 GiB installed RAM or less than 8 GiB isolated capacity is unsupported. Brand and speed do not decide support. The worker fits the largest context inside the budget. Shared memory has a 64K cap through 32 GiB installed RAM and 128K above it. Dedicated memory has a 64K cap through 24 GiB and 128K above it. It reports the actual allocation, memory kind, backend, and one selected device. Stop and generation timeouts do not unload a healthy model. Manual unload, a model or operation change, image inspection, or Core shutdown terminates the complete worker process.

Downloaded development models, generated guest images, signed helpers, build output, coverage, reports, installers, and dependency directories remain ignored artifacts. Distribution requires notices, SBOMs, hashes, signatures, and platform package verification. A model-download build remains post-V1 work.

## Continuous Verification

`pnpm verify` remains the fast repository gate. `pnpm test:gate --milestone 3` is the V1 acceptance entrypoint and must fail rather than silently skip any required physical-platform, model, microVM, desktop, or packaging evidence.

Unit tests may use deterministic inference and guest fakes. Acceptance must use the real daemon, packaged sidecar, real host-native inference, real guest image, real microVM launchers, and real Tauri applications on macOS and Windows.

## Milestones

### M0 — Reproducible foundation — complete

M0 established the pinned workspace, CI, generic deterministic task fixtures, model manifest, dependency inventory, test-only Tauri capability probe, and provisional no-network guest validation. Its evidence remains in [M0_STATUS.md](M0_STATUS.md).

### M1 — Secure local control plane and microVMs — complete

M1 delivered workspace state, scoped files, atomic artifacts, audit, jobs, current-user daemon transports, CLI health, bounded worker staging, and certified no-network microVM launchers on macOS and Windows. Its evidence remains in [M1_STATUS.md](M1_STATUS.md).

### M2 — Supervised inference foundation — complete

The cross-platform supervisor, model resolver, memory scheduler, typed inference worker, grammar generation, embeddings, platform-native confinement, and real-model canaries are implemented. M3 reuses this completed foundation and integrates it into the packaged desktop product. [M2_STATUS.md](M2_STATUS.md) records the completed milestone evidence.

### M3 — Offline Dev-Agent Desktop V1 — active

Stage state: current evidence and the open items still blocking launch are in [M3_STATUS.md](M3_STATUS.md).

Scope:

- Add typed folder-grant, attachment, session, turn, agent-run, agent-event, and artifact contracts just in time.
- Add schema migrations and Core commands/queries for folder groups, the newest five sessions, cursor expansion, New chat, turns, attachments, drafts, and recovery.
- Add daemon methods and a typed desktop client for every M3 capability, including streaming or bounded event polling, cancellation, and reconnect.
- Build the product Tauri v2 and React desktop shell on macOS and Windows.
- Add native folder/file dialogs without exposing arbitrary paths to the webview.
- Implement the Vault Core-owned agent loop with bounded turns, typed inference mediation, cancellation, audit, and deterministic fake coverage.
- Keep the generic `read` tool as strict streamed UTF-8 plain-text inspection. Invalid UTF-8 and NUL bytes fail. Clamp safe optional integers to their configured bounds, and reject wrong types, non-finite numbers, and unsafe integers. Limit every model-facing tool-result preview to 50 KiB after JSON encoding; spill a complete oversized result under `/workspace` and name its path in the tool result. Add generic `write` and `edit` tools scoped to `/workspace`, with `edit` requiring an exact, unique match unless the model asks to replace every match.
- Treat every file created or changed under `/workspace` during a run as an artifact delivered to the user; do not parse task text or add a suffix or format allowlist.
- Run session-summary work only from a measured chat allocation of at least 16,384 tokens. Use one ordered non-fatal queue per session, new identity and trace per attempt, one approved-failure retry, and shutdown cancellation. Do not use profile or model-status fallback values.
- Build a reproducible agent guest image with Python, Node.js, BusyBox shell/tools, the reviewed fixed library set, a typed guest entrypoint, immutable root, live read-only source, and bounded persistent workspace.
- Extend the agent guest protocol to version 3 for hello/capabilities, workspace hydration, repeated execution, ordered bounded stdout/stderr frames, typed lifecycle diagnostics, cancellation, workspace deltas, structured results, and graceful shutdown while preserving the M1 probe protocol.
- Integrate the completed Windows native inference boundary into the agent product and verify the real V1 model on both platforms.
- On Windows, expose the selected source through host-read-only Plan9 plus a guest read-only mount, and remove the VM-specific recursive read grant when HCS teardown completes.
- Package the exact Vault Core sidecar, native helpers, model assets, and guest image with zero-download first launch.

Gate:

- A fresh install launches on physical Apple-silicon macOS and supported Windows x64 and connects only to its authenticated current-user daemon endpoint.
- The desktop can add and remove folder grants, create a folder session, create a New chat session, attach files, restore sessions after restart, show exactly five recent sessions per folder, and expand older sessions with Show more.
- Boundary tests prove zero virtual network adapters and denial of DNS, IPv4, IPv6, LAN, multicast, host reachability, package installation, and credential access. The guest can recursively read the unlimited authorized live folder and write only to its bounded workspace; it cannot mutate, create, rename, or delete anything in the host source folder.
- Traversal, symlink/junction escape, malformed IPC, oversized input/output, process storms, timeout, cancellation, guest crash, daemon crash, and low-disk cases are contained and produce typed durable outcomes.
- The webview cannot invoke arbitrary shell commands, processes, paths, URLs, local endpoints, environments, model files, or filesystem operations.
- `pnpm test:m3:macos` and `pnpm test:m3:windows` pass the guest boundary probes and all four golden folder tasks (`golden: 4/4 passed`) on physical hardware.
- Packaged application checks cover install, first launch with zero downloads, sidecar and helper identity, restart, upgrade, uninstall, and preservation of user workspace state.
- Required notices, SBOMs, artifact manifests, hashes, signatures, and unsupported-hardware messages are present and accurate.

M3 closes when this gate passes on physical macOS and Windows and the open items in [M3_STATUS.md](M3_STATUS.md) are resolved. Closing M3 is the Community Desktop V1 launch gate.

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
