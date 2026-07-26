# Vault Desk

**Private work should stay private.**

Vault Desk is building a local-first AI coworker for private folders and files. The M3 product target lets you select a folder or attach files to a chat; its local agent can inspect them and run Python, Node.js, or installed guest shell tools without sending the work to a cloud service.

> The community software is free. Vault Desk sells certainty.

> [!IMPORTANT]
> Vault Desk completed M0, cross-platform M1, and cross-platform M2. The M3 macOS desktop agent uses a RAM-bounded pool of session-scoped no-NIC microVMs for Python, Node.js, and installed guest shell tools, with a live read-only selected folder and durable bounded workspace per conversation. The global M3 launch gate remains open for Windows product integration and physical certification. [The M3 status](docs/M3_STATUS.md) records exact evidence and deferrals.

## Why

People should not have to upload private work—or learn models, runtimes, sandboxes, and context windows—to get useful help from an AI agent.

Vault Desk hides that machinery. Folder sessions keep related conversations and a bounded agent workspace together. New chat accepts explicit attachments without granting a whole folder. The agent can create scripts and artifacts in that private workspace, but it cannot write to the selected host folder.

The same platform is planned as a free community desktop app, a supported personal computer, and a governed office appliance. [The product brief](docs/PRODUCT.md) explains that shape without the implementation detail.

## How we are building it

- Product logic lives in [TypeScript](https://www.typescriptlang.org/) on [Node.js](https://nodejs.org/). [Tauri v2](https://tauri.app/) and [React](https://react.dev/) provide the desktop experience; [Rust](https://www.rust-lang.org/) and Swift remain limited to operating-system capabilities that TypeScript cannot safely provide.

- [node-llama-cpp](https://node-llama-cpp.withcat.ai/) runs the local generation model in a separately constrained host-native worker. Contracts remain model-agnostic even though the first certified model is deliberate.

- Agent-authored Python, Node.js, and installed shell commands run in a session-scoped [no-network microVM](docs/adr/0012-worker-isolation-and-untrusted-documents.md) with an immutable image, a live read-only folder mount, a persistent 128 MiB workspace, typed host/guest IPC, and no package installation or selected-folder write authority.

- Vault Core owns folder grants, sessions, policy, audit, model mediation, resource limits, cancellation, and worker teardown. The model may propose bounded guest commands; it never receives a host shell, unrestricted filesystem, network, approval, or VM authority.

- Vault Desk sends no application telemetry. Local customer-owned audit records stay on the device unless the user explicitly exports them.

Document-specific parsing, OCR, retrieval, citations, and deterministic optimizations are one post-V1 follow-up. They are not prerequisites for the generic desktop agent.

## Public website

The static launch website is built from [`site/`](site/) for the project URL at
<https://alex-alecu.github.io/vault-desk/>. It includes the public route, legal and security pages,
unavailable download cards, and a browser-only interactive demo that reuses the desktop React app,
reducer, components, and stylesheet with synthetic in-memory fixtures. The demo does not run a
model, transmit entered text, persist data, or import the Tauri adapter.

Run `pnpm site:dev` for the local site at `http://127.0.0.1:4173/`, `pnpm site:build` to create the
Pages artifact, and `pnpm site:check` to build and validate its public contracts. Signed desktop
installers remain unavailable until the separate release gate is complete.

## Open source and acknowledgements

Current pinned dependencies, development tools, native components, versions, licenses, and uses are recorded in the [machine-readable compliance inventory](compliance/inventory.json); transitive JavaScript, Rust, and Swift package resolutions are owned by repository lockfiles. Planned components are not installed dependencies until reviewed and consumed.

The development workflow was informed by [Everything Claude Code](https://github.com/affaan-m/ECC), especially its research, verification, reusable-skill, review, and handoff practices. Vault Desk expresses those ideas in original project-specific instructions and does not include the ECC package or runtime.

The macOS development package generates notices, an SPDX SBOM, hashes, signatures, and an artifact manifest as required by the [implementation plan](docs/IMPLEMENTATION_PLAN.md#model-and-asset-distribution). Developer ID signing and notarization remain release-distribution work.

## Go deeper

Start with [the product](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), and [security](docs/SECURITY.md). The [implementation plan](docs/IMPLEMENTATION_PLAN.md), [offline dev-agent decision](docs/adr/0018-offline-dev-agent-first.md), [desktop design](docs/DESKTOP_DESIGN.md), and [M3 status](docs/M3_STATUS.md) define the active product path. [CONTRIBUTING.md](CONTRIBUTING.md) explains the current contribution rules.
