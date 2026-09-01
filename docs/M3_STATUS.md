# Milestone M3 Status

Updated: 2026-08-30

M3 Offline Dev-Agent Desktop V1 is active. The desktop runs one general-purpose local agent per conversation: a system prompt plus a fixed tool set, executing every file read and every command inside a no-network microVM (a virtual machine with no network interface).

## What M3 Delivers Today

- New chat sessions with folder or explicit file attachments, folder groups, and recent-session paging.
- The agent inspects a selected folder, writes and runs Python or Node.js, runs shell commands, and returns every file it created or changed under `/workspace` as a deliverable.
- In-run clarifying questions, cancellation, and session restoration after a restart.
- Concurrent conversations share one resident inference worker inside a RAM-bounded pool of reusable microVMs. Stop and generation timeouts keep a healthy model resident.
- A private, owner-only debugging snapshot for one session, for local troubleshooting.
- A `task` tool for delegating to a child agent, used only when the user explicitly asks for delegation or parallel work.

## Security Boundary

- The guest VM has zero network devices, an immutable root image, a live read-only mount of the selected folder at `/source`, and a writable, persistent 128 MiB `/workspace`.
- Garden Desk Core owns every host filesystem, process, and audit decision; the webview and the model never receive host authority.
- Crash recovery marks any run left `queued` or `running` after a Core restart as failed. Session summaries and context compaction keep long conversations coherent without extending the live prompt indefinitely.

## What Remains Open

- Blind qualified-reviewer check of the professional review skills' outputs (legal, finance, medical administration) on both platforms before public release.
- Packaged Open and Save As for generated files, observed on the built macOS and Windows applications.
- Windows setup certified under a dedicated standard-user account (current evidence used an administrator account with UAC filtering).
- Release signing: macOS Developer ID notarization and Windows Authenticode signing under the production certificate.

## Running The Golden Tasks

`pnpm test:m3:macos` and `pnpm test:m3:windows` run the guest security probes (no network interface, read-only `/source`, cancellation, resource limits, persistence), then four golden folder tasks — XLSX extraction, DOCX extraction, PDF extraction, and a mixed-folder report — each through one real agent run, checked deterministically against known fixture values. They print `golden: N/4 passed` and exit non-zero if any task fails. There is no separate readiness record or result classification beyond that count.
