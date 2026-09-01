# ADR 0010: Electron And Local Transport

Date: 2026-07-11

## Status

Partially superseded

The Electron shell decision is superseded by [ADR 0014](0014-tauri-desktop-shell.md). The separate Garden Desk Core process, local transport, and early daemon-validation decisions remain accepted.

## Context

Garden Desk needs a Windows and macOS desktop shell while keeping privileged orchestration outside the renderer. The implementation plan previously selected Electron while the architecture document still treated the shell as open, and it deferred Windows named-pipe support even though Windows is an initial product target.

Deferring the real process transport would allow most backend work to be tested only through an in-process API. That would postpone serialization, lifecycle, permissions, reconnect, streaming, and platform failures until the desktop milestone.

## Decision

Garden Desk will use Electron with React and TypeScript for the first Community Desktop implementation.

The Electron renderer has context isolation enabled and Node integration disabled. The preload exposes only a narrow, schema-validated IPC facade. The Electron main process is a client of Garden Desk Core and does not duplicate product workflows or privileged business logic.

Garden Desk Core runs as a separate Node.js process from the beginning of implementation. Its local JSON-RPC transport uses:

- A Unix domain socket on macOS.
- A named pipe on Windows.
- One shared, versioned protocol and transport adapter contract.
- Current-operating-system-user endpoint permissions.
- Request IDs, job IDs, idempotency keys, cancellation, bounded streaming, backpressure, reconnect behavior, and structured errors.

Desktop mode does not expose a TCP listener. Appliance networking requires a future deployment and identity ADR.

The daemon skeleton and both platform transports are implemented before document or model workflows depend on them. Unit tests may use the in-process core API, but every milestone also exercises new backend behavior through the daemon.

## Consequences

Positive:

- Removes ambiguity from desktop scaffolding and packaging.
- Finds Windows and macOS process-boundary failures early.
- Keeps the renderer unprivileged and the backend independently testable.
- Prevents UI-only backend capabilities.

Negative:

- Requires cross-platform lifecycle and transport tests from the first implementation milestone.
- Electron and native dependencies increase package size and platform release work.
- A later shell change would require a new ADR, although the daemon protocol limits the migration surface.

## Required Validation

- Native dependency load smoke tests on Windows and macOS in M0.
- Daemon start, health, cancellation, restart, incompatible protocol, and endpoint permission tests in M1.
- Signed packaged-build smoke tests on both platforms before certification.
