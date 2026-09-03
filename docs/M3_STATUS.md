# Milestone M3 Status

Updated: 2026-09-03

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

- A current Windows golden-task gate. On 2026-09-03, commit `6ffb71b` failed before guest start because the local x86-64 agent root image did not match the immutable manifest.
- Blind qualified-reviewer check of the professional review skills' outputs (legal, finance, medical administration) on both platforms before public release.
- Packaged Open and Save As for generated files, observed on the built macOS and Windows applications.
- Windows setup certified under a dedicated standard-user account (current evidence used an administrator account with UAC filtering).
- Release signing: macOS Developer ID notarization and Windows Authenticode signing under the production certificate.

## 2026-09-03 Windows Gate Result

The run used physical Windows x64 after `git fetch origin main`. The checked commit was the current `origin/main` tip, `6ffb71b`.

- `pnpm install --frozen-lockfile` passed.
- `pnpm guest:build:agent:windows` failed the immutable image check. The two independent builds were byte-for-byte equal. The kernel SHA-256 was the required `9fabee42a89b8128aa9f16dee4d43289c113f8b2aea398cabc904b6911a41dea`. The root image SHA-256 was `452478a3997469786ebfe14471da2983b5417f3033089d6c5ca513c1c65a7b63`, but the manifest requires `8b7cf436d933f5698147e50e12d3e866516e1a71fa11e14da3e6bd84dca2488a`.
- `pnpm desktop:build-sidecar` failed when it checked the x86-64 guest image against the same manifest.
- `pnpm test:m3:windows` exited with code 1 and reported `Agent initramfs hash mismatch.` The guest did not start. The real model and all four golden folder tasks did not run. No golden pass count was printed.

This result does not pass the Windows M3 gate. It is an image reproducibility and manifest failure, not a model-quality result.

## Running The Golden Tasks

`pnpm test:m3:macos` and `pnpm test:m3:windows` run the guest security probes (no network interface, read-only `/source`, cancellation, resource limits, persistence), then four golden folder tasks — XLSX extraction, DOCX extraction, PDF extraction, and a mixed-folder report — each through one real agent run, checked deterministically against known fixture values. They print `golden: N/4 passed` and exit non-zero if any task fails. There is no separate readiness record or result classification beyond that count.
