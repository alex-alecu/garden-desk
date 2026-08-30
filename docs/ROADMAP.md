# Roadmap

Updated: 2026-07-23

## Completed Foundations

- Pinned cross-platform TypeScript/Node workspace, CI, model manifest, dependency inventory, and evaluation harness.
- Current-user Vault Core daemon, scoped workspace state, immutable artifacts, audit, jobs, cancellation, and recovery.
- Certified no-network microVM launchers on macOS and Windows.
- macOS host-native supervised inference with grammar generation, embeddings, memory scheduling, and containment evidence.

## Current: Community Desktop V1

Ship the first useful product as quickly as the security boundary permits:

- Tauri v2 and React desktop application for macOS and Windows.
- Sidebar with New chat and folder groups.
- Five recent sessions per folder with Show more for older sessions.
- Native folder and file selection without webview filesystem authority.
- Persistent conversations, drafts, activity, cancellation, and restart recovery.
- A generic local agent inspired by modern coding-agent interaction.
- Python, Node.js, and installed shell-tool execution in a session-scoped no-network microVM.
- A reviewed fixed set of offline document and image libraries.
- A prompt-only professional review set for legal, finance, and medical administration, with qualified human review of its outputs before release.
- Live read-only selected-folder mount and persistent bounded guest workspace; no selected-folder writes.
- Typed host-mediated local inference; no generic model endpoint in the guest.
- Self-contained packages with zero-download first launch on supported macOS and Windows hardware.

The complete gate is [M3 in the implementation plan](IMPLEMENTATION_PLAN.md#m3--offline-dev-agent-desktop-v1--active).

## Post-V1: Document Intelligence

One combined follow-up may add:

- Native parsing and resumable manifests.
- OCR and layout routing.
- Hybrid indexing and retrieval.
- Evidence packs, citations, and deterministic verification.
- Purpose-built deterministic operations where they materially improve speed, accuracy, or evidence quality over the generic agent.

## Later Product Expansion

- Specialized professional workflow packs selected from real usage.
- Signed offline Knowledge Bundles.
- Office appliance multi-user controls, permissions, backup, and governance.
- Personal systems and certified hardware offerings.
- Model downloads and alternate runtimes.
- Explicitly approved external integrations through a typed audited broker.
- Linux desktop certification.
