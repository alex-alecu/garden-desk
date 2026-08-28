# Offline Knowledge Bundles Research (2026)

Created: 2026-07-12

This document reviews current standards and practices relevant to distributing professional reference libraries that Garden Desk can install and use without internet access.

Claims are research-derived until validated through M0 prototypes, legal review, production corpora, and subject-matter review.

## Research Question

What should Garden Desk store and distribute so a domain library is:

- Fully usable offline.
- Verifiable and safely updateable.
- Citable to original evidence.
- Portable across retrieval-engine and embedding-model changes.
- Composable by domain, jurisdiction, period, and organization.
- Legally distributable.
- Safe to import despite containing untrusted documents and archives.

## Finding

No single current standard covers semantic description, complete-file fixity, publisher authentication, secure updates, licensing, local retrieval, and professional-domain applicability.

The best fit is a small profile assembled from mature boundaries:

- RO-Crate for descriptive metadata, provenance, contextual entities, and domain profiles.
- A complete cryptographic payload manifest following BagIt-style fixity rules.
- SPDX Dataset metadata for rights and inventory where useful.
- TUF for publisher trust, delegated update roles, rollback resistance, and offline update metadata.
- Optional Sigstore bundles for release attestations that can be verified offline.
- Garden Desk's own canonical document and citation contracts for local evidence use.

This is preferable to adopting a vector database, archive format, model package, or container registry layout as the whole knowledge format.

## Standards Review

### RO-Crate 1.3

[RO-Crate 1.3](https://www.researchobject.org/ro-crate/specification/1.3/index.html) was published on 2026-06-22 and is the current long-term release. It organizes file-based data with machine- and human-readable JSON-LD metadata and supports data entities, contextual entities, provenance, licensing, and profiles.

The 1.3 release is a small, backwards-compatible update from 1.2, chiefly updating workflow vocabulary URIs and the Schema.org context. Its profile mechanism is a good match for accounting, legal, medical-administration, and jurisdiction-specific additions.

Fit for Garden Desk:

- Strong semantic and provenance baseline.
- Designed to describe files and related entities rather than dictate a database.
- Extensible through domain profiles.
- Human-readable preview convention is useful for bundle inspection.

Limits:

- Does not by itself authenticate a publisher.
- Does not provide secure update or rollback protection.
- Does not require a complete cryptographic inventory of every byte in the package.
- JSON-LD processing can add implementation complexity; Garden Desk should use a constrained profile and ordinary validation rather than require a graph database.

### BagIt 1.0

[RFC 8493](https://datatracker.ietf.org/doc/html/rfc8493) defines a simple directory package containing opaque payload files and complete checksum manifests. A bag is complete only when required elements and all listed payloads exist; it is valid only when every checksum verifies. Implementations must support SHA-256 and SHA-512, and the RFC recommends SHA-512 by default for new bags.

Fit for Garden Desk:

- Mature, simple, transport-independent fixity convention.
- Complete payload enumeration detects missing and altered files.
- Payload bytes remain opaque, so original evidence can be preserved unchanged.

Limits:

- Fixity is not authenticity.
- Human-oriented `bag-info.txt` is not enough for domain applicability or policy.
- Remote payload fetching is inappropriate for a guaranteed-offline bundle.
- Strict conformance may duplicate a richer Vault manifest; M0 should test whether conformance reduces implementation and interoperability cost.

### SPDX 3.0.1 Dataset Profile

[SPDX 3.0.1](https://spdx.github.io/spdx-spec/v3.0.1/scope/) covers software, AI models, datasets, provenance, integrity, licenses, copyright, suppliers, and relationships. Its [Dataset Profile](https://spdx.github.io/spdx-spec/v3.0.1/model/Dataset/Dataset/) requires declared and concluded license relationships for conforming dataset packages and provides fields for intended use, availability, preprocessing, sensitive personal information, suppliers, and integrity.

Fit for Garden Desk:

- Avoids inventing license identifiers and dataset inventory semantics.
- Can record both what a publisher declares and what Garden Desk concludes after review.
- Supports attribution, supplier, integrity, and intended-use information.

Limits:

- SPDX metadata does not grant redistribution rights or replace counsel.
- Full SPDX 3 may be heavier than every community bundle needs; use a profile or attached rights record rather than mirror the entire model into the core manifest.

### W3C PROV And Selectors

[W3C PROV-O](https://www.w3.org/TR/prov-o/) models entities, activities, agents, derivation, attribution, revision, and primary sources. Its small starting-point vocabulary is sufficient to say which publisher or transformation produced a normalized resource from which exact source.

The [W3C Selectors and States model](https://www.w3.org/TR/selectors-states/) defines text-position and text-quote selectors. Position selectors are compact but brittle after edits. Quote selectors preserve exact text plus optional prefix and suffix context. Using both alongside page, region, table, and cell anchors improves citation recovery without making web annotation machinery a runtime dependency.

Fit for Garden Desk:

- Provides established names for derivation and source relationships.
- Reinforces redundant, representation-aware citation anchors.

Limit:

- These are vocabularies, not storage engines or verification systems.

### The Update Framework

[TUF metadata](https://theupdateframework.io/docs/metadata/) assigns separate root, targets, snapshot, and timestamp roles. Target metadata binds files to hashes and sizes; snapshot metadata prevents inconsistent mixtures of repository versions; version and expiration checks address rollback and freeze attacks. Offline root keys and role separation reduce the damage from an online-key compromise.

Fit for Garden Desk:

- Directly addresses bundle update trust rather than only file integrity.
- Delegations can separate publishers, domains, jurisdictions, and organization-local repositories.
- Metadata and target files can be carried on controlled removable media for air-gapped installation.
- Root rotation and threshold signing avoid a permanent single key.

Limits and operational cautions:

- Expiration and trusted-time handling need a deliberate air-gap procedure.
- TUF authenticates an authorized repository role, not the truth or professional quality of its content.
- Installed content should not stop working merely because update metadata expires; expiration should block unverified new updates.

### Sigstore Bundle Format

The current [Sigstore bundle format](https://docs.sigstore.dev/about/bundle/) contains signature verification material and may include transparency-log entries and RFC 3161 timestamps. Current Cosign documentation states that the newer bundle format supports offline verification and keeps signature, certificate, timestamps, and attestations together.

Fit for Garden Desk:

- Useful optional build and release provenance.
- Offline verification material can travel with an air-gapped artifact.
- DSSE/in-toto attestations can bind a release to a build or curation process.

Limits:

- Trust still depends on a local policy for accepted identities and roots.
- Public transparency-log freshness cannot be queried while offline.
- Sigstore does not provide the repository consistency and rollback protections of TUF.
- A valid publisher signature does not establish subject-matter authority.

Recommendation: use TUF as the install/update trust gate; consider Sigstore as an attached release attestation, not a replacement.

### OCI Image Layout 1.1

The [OCI Image Layout](https://specs.opencontainers.org/image-spec/image-layout/?v=v1.1.0) stores content-addressed blobs and references in a transport-neutral directory that can itself travel through archives or shared filesystems. OCI 1.1 also formalized non-container artifact guidance and subject/referrer relationships.

Strengths:

- Strong content-addressed distribution model.
- Mature registry and artifact ecosystem.
- Natural attachment model for signatures and attestations.

Why it is not the recommended user-facing bundle format yet:

- Its manifest and layer semantics remain container-shaped.
- It does not describe domain validity, evidence anchors, rights, or retrieval compatibility without a custom artifact profile.
- Adopting OCI distribution tooling would add operational surface before Garden Desk needs a network registry.

Garden Desk should borrow content-descriptor and immutable-object semantics. M0 may still select OCI layout as an internal or publisher-side transport if it demonstrably removes more code than it adds.

### Frictionless Data Package

The [Data Package v1](https://specs.frictionlessdata.io/data-package/) descriptor offers a simple resource list with titles, licenses, sources, paths, media types, schemas, sizes, and hashes. It is attractive for tabular datasets and can be extended.

Why it is not the primary profile:

- Its core model is intentionally general and less expressive for provenance, authority, revisions, professional applicability, and heterogeneous document relationships.
- Its resource hash field historically defaults to MD5 unless an algorithm prefix is supplied.
- It does not add update trust or publisher authentication.

It may remain an import/export format for individual tabular resources inside a bundle.

## Storage Alternatives

| Alternative | Strength | Failure for Garden Desk |
|---|---|---|
| Raw folder or archive | Simple to author | No stable identity, completeness, provenance, rights contract, update safety, or compatibility declaration |
| SQLite database | Portable single file and excellent local queries | Encourages mixing source, mutable state, and derived index; poor content deduplication across bundles; schema and writer coupling |
| Vector database snapshot | Fast first query | Encoder/index lock-in, weak exact search, no original evidence guarantee, hard migration and audit |
| Parquet dataset | Strong immutable tabular interchange | Not a general package, signature, citation, or update format; weak fit for original PDFs and heterogeneous documents |
| OCI artifact | Content-addressed ecosystem and attestations | Container-shaped metadata and unnecessary registry complexity for the first offline desktop product |
| Model fine-tune or baked weights | Compact runtime use | Facts become uncitable and stale; no jurisdiction, time, rights, or source-level correction path |
| RO-Crate alone | Rich metadata and profiles | Missing complete fixity, trust roles, and secure updates |
| BagIt alone | Mature completeness and checksum rules | Missing publisher identity, domain semantics, update policy, and retrieval contract |
| Layered Vault Knowledge Bundle | Separates evidence, metadata, trust, and accelerators | Requires a constrained profile and M0 validation, but each responsibility remains replaceable |

## Retrieval Findings

Precomputed retrieval state is useful only when its derivation contract exactly matches the installed runtime. At minimum, embeddings depend on the source normalization, chunk boundaries, tokenizer, model artifact, task prefix, dimensions, normalization, and quantization. Lexical indexes depend on analyzers, language rules, tokenization, and engine format.

Therefore:

- Canonical sources and source-linked normalized representations should travel in the bundle.
- Local indexes should be rebuilt by default.
- Optional accelerators should be content-addressed and compatibility-gated.
- Summaries should retain source citations and model/prompt provenance.
- Bundle activation should not depend on a proprietary vector database format.

This matches Garden Desk's existing rule that LanceDB, embeddings, summaries, and caches are derived state, while authoritative records and immutable artifacts remain sufficient for rebuild and replay.

## Domain Composition Findings

Professional knowledge is multi-dimensional. `accounting` is not an adequate scope key. Applicability often depends on:

- Jurisdiction.
- Effective date or reporting period.
- Entity type and size.
- Language.
- Regulator or issuing authority.
- Primary versus secondary authority.
- Draft, current, superseded, withdrawn, or historical status.
- Product/version applicability for technical libraries.
- Organization-local policy and its relationship to public authority.

Small composable layers reduce download size and licensing conflicts, but overlays must never erase contradictory evidence. The retrieval layer should filter by applicability and preserve conflicts for the verifier.

## Security Findings

Archive and document safety are independent of signature validity. A trusted publisher account can be compromised, and legitimate bundles contain parser-hostile formats.

The importer should use the same no-network microVM boundary as hostile document work and enforce path, expansion, nesting, resource, schema, checksum, and media-type limits. The host should activate only a complete verified result through an atomic catalog transaction.

Knowledge bundles should remain passive. Executable scripts, macros, workflows, tools, active HTML, or policy changes must not acquire authority merely because they arrived inside a signed library.

## Rights Findings

The primary commercial risk is likely content rights, not file format. Statutes, standards, regulatory guidance, professional commentary, textbooks, forms, and vendor manuals have different copyright, database-rights, access, modification, attribution, and redistribution terms.

Best practice is resource-level rights provenance and a concluded redistribution decision. `Publicly accessible`, `open data`, `public domain`, and `commercially redistributable` are not interchangeable labels.

When redistribution is prohibited but local use is lawful, Garden Desk can provide a tool for a user or administrator to build a private bundle from their own licensed materials without uploading them. That locally created bundle must retain the same provenance, trust status, and passive-content boundaries.

## Recommended First Prototype

Prototype one small accounting bundle before designing a universal catalog:

- One jurisdiction.
- One reporting or tax period.
- A small set of primary sources and clearly marked regulator guidance.
- Original publications plus source-linked normalized text and anchors.
- RO-Crate 1.3-based metadata profile.
- Complete payload digest manifest.
- TUF-protected offline repository snapshot.
- No shipped vector index in the baseline.
- Local hybrid-index rebuild.
- A public conformance set and a separate held-out Garden Desk acceptance set.
- Historical-date, supersession, conflict, unsupported-answer, and prompt-injection cases.

Measure import time, installed size, deduplication, rebuild time, retrieval recall, citation precision, update/rollback behavior, and Local 12 memory impact before expanding to a second domain.

## Open Validation Work

- Confirm maintained TypeScript implementations for RO-Crate, SPDX 3, BagIt, TUF, and optional Sigstore verification.
- Decide the minimal constrained manifest that avoids JSON-LD and SPDX duplication.
- Validate deterministic bundle construction across Windows and macOS.
- Validate safe archive extraction in the selected microVM backends.
- Test update expiry, clock skew, delegated roles, offline root rotation, rollback attempts, and compromised signing keys.
- Benchmark local indexing from normalized text against compatible shipped accelerators.
- Define source-authority vocabularies with accounting and legal experts.
- Obtain jurisdiction-specific content-rights review before distributing any real library.
- Define removal behavior for withdrawn or legally restricted sources without breaking retained audit evidence.

## Primary Sources Reviewed

- [RO-Crate 1.3 specification](https://www.researchobject.org/ro-crate/specification/1.3/index.html)
- [RO-Crate 1.3 announcement and compatibility notes](https://www.researchobject.org/ro-crate/blog/2026-06-23/announcing-ro-crate-1-3)
- [RO-Crate profiles](https://www.researchobject.org/ro-crate/specification/1.3/profiles.html)
- [BagIt File Packaging Format, RFC 8493](https://datatracker.ietf.org/doc/html/rfc8493)
- [SPDX 3.0.1 scope](https://spdx.github.io/spdx-spec/v3.0.1/scope/)
- [SPDX 3.0.1 Dataset Profile](https://spdx.github.io/spdx-spec/v3.0.1/model/Dataset/Dataset/)
- [SPDX 3.0.1 DatasetPackage](https://spdx.github.io/spdx-spec/v3.0.1/model/Dataset/Classes/DatasetPackage/)
- [W3C PROV-O](https://www.w3.org/TR/prov-o/)
- [W3C Selectors and States](https://www.w3.org/TR/selectors-states/)
- [TUF metadata roles](https://theupdateframework.io/docs/metadata/)
- [TUF specification](https://theupdateframework.github.io/specification/)
- [Sigstore bundle format](https://docs.sigstore.dev/about/bundle/)
- [Sigstore signature verification](https://docs.sigstore.dev/cosign/verifying/verify/)
- [OCI Image Layout](https://specs.opencontainers.org/image-spec/image-layout/?v=v1.1.0)
- [OCI 1.1 artifact and referrer guidance](https://opencontainers.org/posts/blog/2024-03-13-image-and-distribution-1-1/)
- [Frictionless Data Package v1](https://specs.frictionlessdata.io/data-package/)
