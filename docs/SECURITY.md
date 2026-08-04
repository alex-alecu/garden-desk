# Security

Created: 2026-07-10

Vault Desk must treat privacy, permissions, auditability, and reversibility as product features, not implementation details.

## Security Goals

- Keep customer documents local by default.
- Avoid mandatory cloud dependencies.
- Prevent silent cloud fallback.
- Restrict model-initiated actions through typed tools.
- Require approvals for consequential actions.
- Preserve source traceability.
- Support rollback for file-changing actions.
- Provide auditable external connections.
- Make office appliance permissions enforceable and inspectable.

## Threat Model Assumptions

- Model output is untrusted.
- User documents may contain sensitive financial, legal, medical, or business data.
- Plugins and integrations may be faulty or malicious.
- Users may accidentally approve the wrong action.
- Shared offices require workspace and role isolation.
- Remote support must never become unrestricted access.
- Local malware risk exists and should be reduced through process and filesystem boundaries where practical.
- Source documents, archives, parser inputs, OCR inputs, and retrieved text may be malformed or malicious.
- Signed or unsigned Knowledge Bundles may contain malicious archives, documents, metadata, prompt injection, or deceptive authority claims.
- Document content may contain prompt injection or instructions that attempt to override policy or request tool execution.
- Native parsers and model runtimes may crash, hang, exhaust resources, or emit malformed output.
- Generated code and interpreter libraries may be malicious, incorrect, nondeterministic, resource-exhausting, or crafted to escape their boundary.
- The Tauri webview and its rendered model or document content may be exposed to injection attempts and must remain unprivileged.

## Desktop Authority

The Tauri desktop, Vault Core, inference process, and ordinary native helpers run as the current user on Windows and macOS. macOS requires no administrator grant. On Windows only, HCS requires membership in Administrators or Hyper-V Administrators. Vault Desk packages a fixed signed helper that elevates once, reads the requesting non-elevated desktop process token, and adds only that SID to the built-in Hyper-V Administrators group. It cannot accept an arbitrary SID, enable Hyper-V, run commands, install a service, or schedule work.

The helper is hash-verified and read-locked before UAC. The user receives an explicit disclosure before elevation and must sign out and back in before the new group SID enters the desktop token. Until then, Vault Desk is browse-only and the native task command rejects execution. Hyper-V Administrators is a standing account permission: every process under that Windows user can manage Hyper-V, not only Vault Desk. This is narrower than running the complete application as administrator but remains a material permission that must be visible in product and installation guidance.

## Agent Security Model

The model may propose an action. It must not execute one directly.

Documents and retrieved evidence are data, never execution instructions. Text found inside a source cannot redefine the system prompt, grant permission, approve an action, or become a tool request without passing the same typed application boundary as every other model proposal.

The application is responsible for:

- Validating the proposed action schema.
- Checking workspace permissions.
- Checking file path scope.
- Routing an external-connection request through the typed network broker and checking its permission, approval, and destination policy.
- Showing previews and diffs.
- Requesting explicit approval when required.
- Executing through a restricted tool boundary.
- Recording an audit event.
- Supporting rollback where possible.

## Tool Sandbox Requirements

Future tools should be:

- Typed.
- Narrow.
- Versioned.
- Policy-aware.
- Workspace-scoped.
- Resource-limited.
- Logged.
- Previewable when they change files or external systems.

Examples of acceptable tool categories:

- Search approved documents.
- Open a specific page or region.
- Extract structured data.
- Compare document versions.
- Create an export.
- Produce a redacted copy.
- Create a case or client folder inside an approved workspace.

Examples of unsafe default capabilities:

- Direct host shell access or an unbounded guest shell.
- Arbitrary filesystem traversal.
- Arbitrary network calls.
- Unbounded file writes.
- Hidden background uploads.
- Unreviewed destructive edits.

## Worker Isolation Requirements

Hostile document parsing and model-requested executable tools must run in certified no-NIC microVMs. Document jobs may use disposable job-scoped guests; each active V1 development-agent conversation uses a session-scoped guest with a durable bounded workspace, within a RAM-derived least-recently-used pool. Network denial must come from the absence of a NIC and general network proxy, not from matching commands, executables, domains, URLs, addresses, or protocols.

MicroVM workers receive immutable explicit attachments or one Core-validated live read-only folder share and communicate over a versioned typed host/guest socket. Their root filesystem is immutable. The dev agent's 128 MiB writable `/workspace` is session-owned and survives only through validated content-addressed manifests; a separate 16 MiB `/run/user` tmpfs is ephemeral, and `/tmp` is read-only to task processes. Neither grants selected-folder or general host writes. Executed child processes inherit no control descriptor and an OS-enforced syscall filter denies creation of new sockets, including VSOCK. Each execution retains time, memory, CPU, process, writable-storage, and output limits.

GPU-backed inference may remain in a host-native supervised process so Metal, CUDA, HIP, or Vulkan remains available. That process is not a tool-execution environment: it receives no shell, credentials, approval authority, arbitrary workspace access, or network capability. Its network denial must be enforced by the operating system rather than application command matching. The completed M2 boundary uses Seatbelt on macOS and a no-capability AppContainer plus a one-process, memory-limited Job Object on Windows. Worker output must be schema-validated and size-checked before it can enter authoritative workspace state. Cancellation, crashes, malformed IPC, temporary-file cleanup, and restart recovery must be tested. See [adr/0012-worker-isolation-and-untrusted-documents.md](adr/0012-worker-isolation-and-untrusted-documents.md).

## Generated-Code Controls

Agent-authored code and installed guest commands are the V1 work capability, not a trusted extension mechanism. Each session uses a no-NIC microVM with a live read-only `/source`, a persistent bounded `/workspace`, pinned offline interpreters, `/bin/sh`, BusyBox tools, and libraries, plus limits for processes, CPU, memory, time, storage, output count, and output size.

The guest receives no user home, credentials, arbitrary host path, package manager access, host shell, generic Vault Core API, external connection broker, approval capability, or model endpoint. Its shell is guest-local and cannot cross the VM boundary. Vault Core mediates completions through the separately confined native inference worker and sends only validated execution requests to the guest. Code and dependencies cannot be installed.

Vault Core records every message, generated source or command, workspace path, summary, bounded logs, structured result, event, declared deliverable, resource use, and termination reason. Workspace intermediates remain recoverable through the session workspace and debug snapshot but do not become artifact rows. Results and workspace deltas remain untrusted until schema, path, hash, size, protocol, and policy validation completes. See [ADR 0018](adr/0018-offline-dev-agent-first.md).

Only a successful structured final response may declare deliverables, and declarations are limited to unique observed current-run workspace paths. Core selects the latest bytes, derives known MIME types from a trusted extension map, verifies the immutable content hash, and commits only valid declarations with the response. Missing, oversized, removed, undeclared, or failed-run files produce no card.

## Desktop Shell Controls

The Tauri webview has no generic shell, process, environment, network, or unrestricted filesystem capability. React uses a narrow typed command surface. The Rust host may open native dialogs and supervise the exact packaged Vault Core sidecar, but it cannot accept arbitrary executable names, arguments, paths, URLs, or endpoints from the webview.

Tauri capabilities are defense in depth, not the product authorization layer. Vault Core still validates workspace scope, model selection, policy, approval, audit, artifact identity, session ownership, content hashes, and export destinations. Opening creates an owner-only verified temporary copy. Save As keeps the native destination out of the webview, rejects symlink and path-identity races, writes atomically, and audits success or failure without recording the destination. Sidecar identity, hashes, signatures, endpoint permissions, protocol versions, upgrades, and crash recovery must be verified independently. See [adr/0014-tauri-desktop-shell.md](adr/0014-tauri-desktop-shell.md).

## Filesystem Controls

Vault Desk should enforce:

- Folder-scoped access.
- Path traversal prevention.
- File extension and MIME validation.
- Safe temporary storage.
- Time-of-check/time-of-use replacement prevention for authorized inputs.
- Size and expansion limits for archives, containers, and parser output.
- Reversible file operations.
- Immutable originals where practical.
- Explicit user or administrator grants for watched folders.

## Knowledge Bundle Controls

Knowledge Bundles are passive evidence packages, never plugins. Import, archive inspection, checksum validation, and document normalization run inside the certified no-NIC microVM boundary with bounded expansion, file count, nesting, CPU, memory, time, scratch space, and output size.

Before activation, Vault Core must verify the complete payload inventory, cryptographic digests, schema, signature policy, update metadata, dependencies, resource roles, and rights metadata. It must reject absolute or traversing paths, duplicate normalized paths, special files, unsafe links, ambiguous names, and undeclared payloads. Activation is an atomic authoritative-catalog transaction.

A bundle signature grants no execution or policy authority. Bundle content cannot add tools, prompts, workflows, macros, network access, approvals, or workspace policy. Official and organization-managed update channels should use a provisioned TUF-style root of trust; community sideloading remains visibly untrusted and may be disabled by organization policy. See [KNOWLEDGE_BUNDLES.md](KNOWLEDGE_BUNDLES.md).

## Network Controls

Network access should be explicit and inspectable.

Defaults:

- MicroVM workers have no virtual network device.
- No worker receives a general network proxy or arbitrary fetch capability.
- Approved external integrations execute through a separate typed Vault Core broker that owns policy, credentials, destination validation, approval, and audit.
- Local inference should work without internet.
- Document processing should not require outbound connections.
- No application telemetry, usage analytics, automatic crash reporting, or background metrics export.
- Local customer-owned audit records are never transmitted unless the user explicitly exports them.
- No silent hosted reasoning fallback.
- Updates should be user-controlled.
- Office appliances should support offline update packages.
- Remote support should require time-limited, explicit authorization.

## Audit Log

Audit records should capture:

- User.
- Workspace.
- Request.
- Documents accessed.
- Retrieval evidence.
- Model profile.
- Generated code hash, interpreter image, and dependency manifest when applicable.
- Tool proposal.
- Policy decision.
- Approval decision.
- Tool result.
- Export destination.
- Error state.
- Timing and resource metrics.

Audit logs should avoid storing unnecessary sensitive content. Where possible, store hashes, references, redacted previews, and structured metadata.

Audit logs are local product records, not telemetry. Vault Desk must not configure an exporter or transmit audit events, traces, timing, resource metrics, crash data, or usage data in the background. Any user-initiated export remains visible, scoped, and approval-gated.

## Business Control Layer

The business layer should add:

- Organization management.
- Identity and roles.
- Permission-aware retrieval.
- Approval policies.
- Immutable audit history.
- Backup orchestration.
- Appliance administration.
- Diagnostics.
- Supported release channels.

These controls are part of the paid certainty proposition.

## Remote Support

Remote support must be:

- Disabled by default.
- Explicitly authorized.
- Time-limited.
- Audited.
- Revocable.
- Scoped to diagnostics or approved maintenance actions.
- Designed to avoid exposing customer documents unless explicitly permitted.

## Revision History

| Date | Change |
|---|---|
| 2026-07-10 | Initial security document created from supplied architecture and product material. |
| 2026-07-11 | Added hostile-document, prompt-injection, supervised-worker, resource-limit, and staged-input security requirements. |
| 2026-07-12 | Made a no-NIC microVM the certified hostile-work boundary and prohibited command-matching as the network-isolation mechanism. |
| 2026-07-12 | Added passive Knowledge Bundle import, trust, archive-safety, atomic-activation, and no-execution requirements. |
| 2026-07-13 | Added Tauri webview/sidecar controls and the generated-code microVM threat model, audit, and validation requirements. |
| 2026-07-17 | Prohibited application telemetry and telemetry exporters; clarified that local customer-owned audit records are transmitted only through explicit, scoped export. |
| 2026-07-20 | Recorded the completed M2 Seatbelt and Windows AppContainer/Job Object native-inference boundaries. |
| 2026-08-04 | Added declared-only deliverable persistence and path-redacted, hash-verified Open and atomic Save As controls. |
