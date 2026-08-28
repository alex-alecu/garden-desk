# ADR 0011: Workspace State And Recovery

Date: 2026-07-11

## Status

Accepted as implementation direction

## Context

Garden Desk must persist manifests, canonical documents, jobs, sessions, evidence packs, approvals, verification results, audit records, indexes, summaries, and caches. The earlier implementation plan named these stores independently without defining which records were authoritative, how writes survived crashes, how versions migrated, or how derived indexes were rebuilt.

Professional document work also requires predictable deletion, retention, recovery, and audit behavior. These properties cannot be added safely after multiple storage formats already exist.

## Decision

Garden Desk will use one schema-versioned workspace format behind a typed `WorkspaceStore` boundary.

The format has three classes of state:

1. **Transactional catalog** — authoritative records for workspace identity, jobs, manifests, document identities, parser runs, sessions, approvals, evidence references, verification outcomes, migrations, and artifact metadata.
2. **Immutable artifacts** — content-addressed canonical document payloads, evidence packs, workflow results, and export records written through an atomic temporary-write and rename protocol.
3. **Derived state** — LanceDB indexes, embeddings, summaries, and caches that are reproducible or rebuildable from authoritative catalog records and immutable artifacts.

The exact maintained SQLite binding may be selected during M0 after Windows and macOS packaging validation, but the transactional catalog semantics are not optional.

Additional rules:

- One process holds the workspace writer lock. Concurrent readers may inspect committed state.
- Every mutation has an idempotency key and an explicit transaction boundary.
- Long jobs persist durable state transitions, cancellation state, resource accounting, and resume cursors.
- Migrations are versioned, tested from supported prior versions, and backup-before-migrate.
- A failed migration leaves the prior workspace usable.
- Derived data records the source, parser, encoder, prompt, schema, and normalization versions needed for invalidation.
- Orphan cleanup, cache limits, workspace deletion, and retention are explicit operations.
- Routine audit records use hashes, identifiers, structured metadata, redacted previews, and artifact references instead of copying full sensitive inputs and outputs.

For the first Community Desktop MVP, data-at-rest protection relies on the operating-system account boundary, per-user filesystem permissions, and encrypted system storage. Garden Desk must state this boundary honestly. Application-managed workspace encryption is deferred until a dedicated threat model also defines keys, recovery, backup, and migration.

## Consequences

Positive:

- Makes crash recovery and resumability properties of the design rather than parser-specific patches.
- Keeps indexes and caches replaceable.
- Makes schema migration and support diagnostics possible.
- Reduces accidental sensitive-content duplication in audit data.

Negative:

- Requires storage and migration tests before visible workflows.
- Introduces a transactional catalog dependency in addition to LanceDB.
- Does not provide application-managed encryption in the first MVP.

## Required Validation

- Abrupt termination tests at every job state transition.
- Single-writer and idempotent-retry tests.
- Migration success, failure, and rollback tests.
- Deterministic index rebuild from authoritative state.
- Workspace deletion and orphan-cleanup tests.
