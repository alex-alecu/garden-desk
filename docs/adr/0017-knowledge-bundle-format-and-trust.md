# ADR 0017: Knowledge Bundle Format And Trust

Created: 2026-07-16

## Status

Accepted as a post-V1 direction. Platform and hostile-archive behavior remains research-derived until a Knowledge Bundle implementation milestone is activated and its gates pass.

## Context

Knowledge Bundles must preserve immutable evidence, provenance, rights, citations, and offline update trust without becoming plugins or binding authoritative content to one retrieval engine. A future implementation must keep the logical layout readable unpacked and inspect removable-media transport inside the certified no-network microVM.

No single reviewed standard covers semantic description, complete fixity, publisher authentication, rollback resistance, hostile-archive inspection, and Garden Desk citation anchors. The first implementation therefore needs a small profile with explicit ownership at each layer.

## Decision

### Logical format

The authoritative form is an immutable directory tree. It contains a versioned Garden Desk manifest, constrained RO-Crate 1.3 JSON-LD metadata, resource-level SPDX 3.0.1 rights records where applicable, original sources, normalized evidence-bearing derivatives, public evaluations, and optional compatibility-keyed accelerators.

The Garden Desk manifest is the one complete inventory consumed by future bundle code. It uses SHA-512 for every payload and follows BagIt completeness and fixity rules, but the product does not claim strict BagIt conformance or duplicate the inventory into BagIt tag manifests.

### Transport

The v1 `.vdkb` transport is an uncompressed deterministic POSIX tar stream. Entries are lexically ordered, use UTF-8 forward-slash relative paths, fixed modes, uid and gid zero, empty owner names, and an epoch modification time. Only directories and regular files are valid. Links, devices, sparse entries, absolute paths, traversal, ambiguous separators, case-colliding paths, and duplicate normalized paths are rejected.

A future bundle importer may use `tar-stream` 3.2.0 only as a streaming tar decoder inside the no-network guest. The guest produces a bounded typed inventory; it never writes directly into the installed store. Garden Desk Core verifies the inventory and commits immutable objects atomically.

Compression is deliberately absent in v1. Node 24's Zstandard API is experimental, and adding a second native codec would enlarge the parser and supply-chain surface. A later ADR may add compression after deterministic construction, decompression limits, and cross-platform behavior are proven.

### Trust and signatures

Official and organization-managed channels use TUF metadata. A future importer may wrap `tuf-js` 6.0.0 behind the Core bundle-inspection boundary and supply an offline-media fetch adapter restricted to the selected import root. Root, targets, snapshot, timestamp, threshold, delegation, version, hash, size, expiration, and rollback decisions remain Core policy.

Bundle release manifests use detached Ed25519 signatures verified with Node 24's built-in `crypto` APIs. A valid detached signature does not replace TUF channel authorization and never grants execution authority. Sigstore attestations remain optional external provenance and are not a v1 activation requirement.

Trusted roots are product- or administrator-provisioned and versioned independently from installed bundle metadata. Expired update metadata blocks new activation but does not disable already installed evidence. Unsigned community sideloading, if enabled by policy, is explicitly untrusted and approval-gated.

### Passive-content boundary

A bundle may carry evidence, metadata, rights records, inert human-readable descriptions, normalized representations, evaluations, and compatible accelerators. It cannot add commands, tools, prompts, workflows, executable hooks, approval rules, network authority, or workspace policy. Active HTML, macros, scripts, and binaries remain inert hostile payloads and cannot execute during inspection or retrieval.

## Dependency Decisions

- `tar-stream` 3.2.0: retained as a reviewed candidate for future guest-only streaming tar inspection. It is MIT-licensed, pure JavaScript, small, and exposes entries without extracting them to host paths.
- `tuf-js` 6.0.0: adopt behind a Core adapter for TUF metadata verification. It is MIT-licensed, maintained by The Update Framework organization, and supports the role model required by the offline channel.
- Node `crypto`: adopt for detached Ed25519 verification. It adds no package, telemetry, network, or credential surface.
- RO-Crate and SPDX libraries: defer. A library is added only if representative bundles prove it removes maintained code.
- Strict BagIt tooling: defer. The single Garden Desk inventory adopts the necessary completeness and SHA-512 invariants without duplicate manifests.
- Sigstore client: defer. TUF plus detached signatures satisfies the first activation boundary; optional provenance does not justify another trust stack yet.

## Consequences

- Future bundle reading stays simple and transport-independent.
- Future archive parsing stays outside Garden Desk Core and behind no-network isolation.
- Uncompressed transport uses more removable-media space but has a smaller deterministic and security surface.
- `tuf-js` and `tar-stream` remain development-only validation dependencies; they become production dependencies only when a future bundle milestone introduces their adapters.
- Content truth, professional authority, rights, and applicability remain separate review decisions from cryptographic authenticity.
- The installed catalog and object store must retain exact bundle and resource digests so citations and audits remain replayable across updates.

## Required Validation

- Construct byte-identical tar streams on macOS and Windows.
- Reject traversal, links, devices, duplicate normalized paths, case collisions, oversized entries, expansion-limit breaches, trailing garbage, and malformed headers inside the no-network guest.
- Verify offline TUF root rotation, threshold roles, delegation, expiration, clock skew policy, rollback, freeze, mix-and-match, corrupt targets, and removable-media root confinement.
- Verify valid, invalid, wrong-key, and altered-manifest Ed25519 signatures.
- Demonstrate that signed content cannot add execution or policy authority.
- Complete resource-level content-rights review before any real bundle is redistributed.

## Primary Sources

- [RO-Crate 1.3](https://www.researchobject.org/ro-crate/specification/1.3/index.html)
- [BagIt RFC 8493](https://datatracker.ietf.org/doc/html/rfc8493)
- [SPDX 3.0.1 Dataset Profile](https://spdx.github.io/spdx-spec/v3.0.1/model/Dataset/Dataset/)
- [The Update Framework specification](https://theupdateframework.github.io/specification/)
- [Node.js crypto documentation](https://nodejs.org/download/release/v24.18.0/docs/api/crypto.html)
