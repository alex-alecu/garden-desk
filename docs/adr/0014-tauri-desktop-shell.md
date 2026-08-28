# ADR 0014: Tauri Desktop Shell

Date: 2026-07-13

## Status

Accepted; supersedes the Electron portion of [ADR 0010](0010-electron-and-local-transport.md)

## Context

Garden Desk needs a small Windows and macOS desktop shell around an independently testable local backend. Electron was selected previously, but the product does not need a Node-enabled renderer or an embedded Chromium runtime. It benefits more from the operating-system webview, a narrow capability surface, smaller packaged shell overhead, and explicit Rust-side command boundaries.

Tauri v2 supports a React/TypeScript web frontend, Rust commands, capability-scoped permissions, platform installers, and bundled external binaries. These are research-derived claims verified from the official Tauri documentation on 2026-07-13 and must be validated against pinned versions during M0.

## Decision

Garden Desk Community Desktop will use Tauri v2 with a React and TypeScript frontend.

The Tauri Rust host is a thin desktop adapter. It owns only window lifecycle, native dialogs, capability-scoped operating-system integration, secure startup and supervision of the packaged Vault Core sidecar, and connection bootstrap. It must not duplicate sessions, workflows, policy, retrieval, verification, approvals, audit, model routing, or workspace persistence.

Vault Core remains a separate Node.js/TypeScript daemon and the source of product behavior. Tauri starts the exact packaged sidecar through a narrow allowlist and connects to the existing versioned local protocol:

- Unix domain socket on macOS.
- Named pipe on Windows.
- No desktop TCP listener.
- Current-user endpoint permissions.
- Request and job IDs, idempotency, cancellation, bounded streaming, backpressure, reconnect, version negotiation, and structured errors.

The webview receives no generic shell, process, environment, network, or unrestricted filesystem capability. React calls a minimal typed Tauri command surface. The Rust layer validates command shape and delegates product requests to Vault Core; it does not accept arbitrary executable names, arguments, paths, URLs, or local endpoints from the frontend.

Tauri sidecar packaging is a distribution mechanism, not a trust boundary. Vault Core, native inference workers, microVM launchers, guest images, models, and document assets remain independently hashed, signed, supervised, and constrained by their own boundaries.

## User Interface Contract

The first desktop interface follows a calm, conversation-centered layout inspired by the structural clarity of the Codex desktop application without copying its brand assets:

- A header spans the full window above both navigation and conversation and shows the session name and active model.
- A persistent left sidebar below the header lists chats first and working folders below them.
- Selecting a chat restores its session and active folder context.
- Selecting a folder opens or creates its workspace view without granting the webview direct filesystem access.
- Multi-model builds show a model selector containing only installed, product-approved models compatible with the current hardware and workflow.
- Single-model builds show the bundled model name as static text with no dropdown affordance.
- The main content area shows the conversation, progress, tool activity, citations, warnings, and approval cards.
- The composer stays anchored at the bottom of the main pane.

Detailed behavior is recorded in [DESKTOP_DESIGN.md](../DESKTOP_DESIGN.md).

## Consequences

Positive:

- Keeps the webview separated from Node.js and product authority.
- Uses the operating-system webview rather than packaging a separate Chromium runtime.
- Preserves the independently testable Vault Core daemon and CLI.
- Makes native capabilities explicit and narrow.
- Supports packaged sidecars and platform installers through the selected shell.

Negative:

- Introduces a small Rust surface and Rust toolchain in addition to the TypeScript/Node product backend.
- Requires WebView2 and WKWebView behavior to be tested independently.
- Sidecar packaging, signing, startup, upgrade, and crash recovery differ by platform.
- Tauri capability configuration is not sufficient by itself to secure Vault Core or workers.

## Required Validation

- Pin Tauri v2 and review its licenses, supply chain, capability model, and updater position during M0.
- Package and launch a minimal signed Vault Core sidecar on supported Windows and macOS targets.
- Prove that the webview cannot invoke arbitrary shell commands, processes, paths, URLs, or endpoints.
- Test sidecar identity, hash verification, single-instance behavior, endpoint permissions, reconnect, incompatible protocol, crash, forced termination, upgrade, and uninstall.
- Test keyboard navigation, screen-reader labels, focus restoration, window resizing, and 200 percent scaling for the required layout.
- Validate both single-model static labeling and multi-model selection against the installed model manifest.

## Research Links

- [Tauri](https://github.com/tauri-apps/tauri)
- [Tauri v2 sidecars](https://v2.tauri.app/develop/sidecar/)
- [Tauri distribution](https://v2.tauri.app/distribute/)
