# ADR 0006: TypeScript Node Harness

Created: 2026-07-10

Status: Accepted as future implementation direction

## Context

The user has specified that the future harness code should be TypeScript under Node. The current repository phase is documentation-only, so no code or package manifests should be created yet.

## Decision

When implementation begins, Vault Core and the local orchestration harness should be TypeScript running on Node.js.

The harness should own orchestration, local API, sessions, jobs, tools, policy, approvals, audit, runtime adapters, and document-pipeline coordination.

Model runtimes, OCR engines, and platform-specific services should sit behind adapters rather than being embedded directly into the harness.

[ADR 0014](0014-tauri-desktop-shell.md) adds one narrow exception: the Tauri v2 desktop host contains the minimum Rust required for native window/dialog integration, capability enforcement, Vault Core sidecar supervision, and connection bootstrap. Product workflows and policy remain in the TypeScript/Node backend.

## Consequences

Positive:

- Strong type system for tools and policies.
- Good fit for local APIs and streaming.
- Broad ecosystem and desktop integration options.
- Easier to keep model runtimes replaceable through adapters.

Negative:

- Heavy native document or OCR work may need external tools or services.
- Care is needed to avoid turning Node into an unrestricted privileged shell bridge.
- Packaging and native dependencies will require platform-specific validation.
