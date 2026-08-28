# Offline Knowledge Bundles

Created: 2026-07-12

Garden Desk should support installable, domain-scoped libraries that remain fully useful without internet access.

This document records a research-derived architecture proposal. The boundary is recommended now; exact serialization, archive transport, and maintained TypeScript libraries must be validated during M0 before an ADR makes the format stable.

## Product Definition

A **Knowledge Bundle** is a passive, versioned collection of source evidence, structured metadata, provenance, rights information, and optional reproducible retrieval accelerators for one subject area.

Examples:

- Romanian accounting rules for a stated tax year.
- UK employment-law primary sources as of a stated date.
- A manufacturer's service manuals for a product family and revision range.
- A medical-administration terminology and form library that contains no diagnostic policy.
- An organization's approved policies layered over a public domain bundle.

A Knowledge Bundle is not:

- A model or fine-tune.
- A prompt pack.
- An executable plugin.
- A workflow definition.
- A mutable workspace.
- A vector index presented as the source of truth.

Workflow Packs define tasks, tools, approvals, validations, and exports. Knowledge Bundles provide evidence those workflows may retrieve. Keeping the two separate prevents downloaded content from acquiring execution authority.

## Core Decision

Use a layered bundle with four distinct classes of content:

1. **Source evidence** — immutable original publications or source snapshots with stable identifiers and hashes.
2. **Descriptive metadata** — resource identity, publisher, authorship, provenance, license, language, jurisdiction, scope, dates, authority, and relationships.
3. **Normalized representations** — text, structure, tables, and citation anchors derived from a specific source representation through a recorded process.
4. **Retrieval accelerators** — chunks, lexical indexes, embeddings, summaries, reranking features, and compressed vectors tied to exact tool and schema versions.

Source evidence and bundle metadata are authoritative. Normalized representations are evidence-bearing derivatives whose lineage must be explicit. Retrieval accelerators are disposable derived state.

Never make an embedding, summary, chunk, or vendor-specific database the only copy of information.

## Logical Bundle Layout

The logical format should remain independent of its transport archive. A future `.vdkb` file may use ZIP64, tar plus Zstandard, or another validated envelope, but import must materialize verified content into Garden Desk's installed store rather than querying the archive in place.

Proposed logical layout:

```text
bundle root
├── human-readable bundle description
├── machine-readable bundle manifest
├── complete payload checksum manifest
├── detached signature and verification material
├── provenance and rights records
├── sources
│   └── immutable original representations
├── normalized
│   └── source-linked text, structure, tables, and anchors
├── evaluations
│   └── public conformance cases and expected citations
└── accelerators
    └── optional version-matched chunks, embeddings, or indexes
```

The eventual format should adopt or profile existing standards rather than inventing equivalents:

- Use [RO-Crate 1.3](https://www.researchobject.org/ro-crate/specification/1.3/index.html) as the semantic metadata and domain-profile baseline. It supports file-based data, contextual entities, provenance, licensing, and additional domain profiles.
- Use [BagIt 1.0](https://datatracker.ietf.org/doc/html/rfc8493) concepts, or strict conformance if M0 tooling proves practical, for a complete payload inventory and cryptographic fixity checks.
- Use [SPDX 3.0.1 Dataset](https://spdx.github.io/spdx-spec/v3.0.1/model/Dataset/Dataset/) records for machine-readable declared and concluded licenses, attribution, supplier, integrity, and dataset inventory where applicable.
- Use simple W3C PROV-compatible entity, activity, and agent relationships for derivation lineage. Do not require a graph database to consume them.

RO-Crate is the metadata vocabulary, not the installed database. BagIt checksums prove completeness and fixity, not publisher identity or update freshness. SPDX records rights and inventory, but does not replace legal review.

## Required Bundle Identity

Every bundle version should declare:

- Stable bundle ID independent of title and version.
- Human-readable name and description.
- Domain and optional subdomains.
- Edition and monotonically increasing release sequence.
- Bundle schema version.
- Publisher and signing identity.
- Creation and release timestamps.
- Content cutoff or `as_of` date.
- Coverage start and end when meaningful.
- Jurisdictions and geographic scope.
- Languages using stable language tags.
- Intended uses and explicit exclusions.
- Authority class for each source, such as primary law, regulator guidance, professional commentary, vendor manual, or organization policy.
- Status such as current, superseded, withdrawn, draft, or historical.
- Required bundle dependencies by stable ID and accepted version or exact digest.
- Conflicts, replacements, and superseded bundle digests.
- Hash algorithm, byte length, media type, and digest for every payload.
- Source, normalized, evaluation, and accelerator roles for every payload.
- Licenses, attribution requirements, redistribution status, and any access restrictions at bundle and resource level.
- Whether personal, confidential, or contract-restricted information is present.
- Minimum compatible Garden Desk bundle reader and canonical-document schema.
- Signature references and update-channel identity.

A semantic version alone is insufficient for professional knowledge. A tax bundle needs a tax period and jurisdiction; a legal bundle needs validity dates and source status; a manual bundle needs product and revision applicability.

## Resource Identity And Citations

Every resource and every evidence-bearing derivative should have a stable ID. Each derivative must point to the exact source digest and transformation record from which it was produced.

Citation anchors should survive local reindexing. Use redundant selectors where the format allows:

- Original resource digest and stable resource ID.
- Page, section, clause, table, sheet, cell, region, or record identifiers.
- Normalized text character offsets.
- Exact quoted text with short prefix and suffix context.
- Bounding boxes for rendered or scanned evidence.
- Source edition and validity interval.

The text-position plus text-quote pattern follows the W3C selector model: positions are efficient but brittle, while exact text with surrounding context helps recover an anchor after benign representation changes.

A citation must include the bundle ID and installed bundle digest. Answers and audit records can then be replayed even after a newer edition is installed.

## Installed Storage Model

Do not copy every bundle into an isolated mutable directory and do not merge bundle files into user workspaces.

Use three local storage layers:

1. **Content-addressed object store** — immutable payload objects keyed by a cryptographic digest. Identical sources shared by several bundles occupy one physical copy.
2. **Authoritative catalog** — transactional records for installed bundle versions, manifests, signatures, resource roles, licenses, provenance, dependencies, policy, and object references.
3. **Derived retrieval store** — rebuildable canonical projections, chunks, lexical indexes, embeddings, summaries, and caches namespaced by bundle digest and derivation configuration.

Installation should stage, validate, and atomically activate a complete bundle version. A failed import must leave neither an active partial bundle nor unreferenced authoritative records. Garbage collection may delete an object only when no installed bundle, audit record, evidence pack, export, or retained historical version references it.

Installed bundle versions are immutable. Updating installs a new version beside the old one, switches the active pointer atomically, and retains any version referenced by an evidence pack or retention policy.

## Retrieval And Composition

Knowledge retrieval must begin with metadata and policy filters before relevance ranking:

1. Workspace and user permission.
2. Enabled bundle and exact installed version.
3. Domain and intended-use compatibility.
4. Jurisdiction and geographic applicability.
5. Language.
6. Validity interval relative to the user's requested date.
7. Source status and authority class.
8. Lexical and dense candidate generation.
9. Metadata-aware reranking.
10. Contradiction and supersession checks.

The system must not silently let a commentary source override primary authority, a newer rule answer a historical question, or an organization overlay erase a conflicting public source.

Compose small immutable layers instead of publishing one enormous domain archive:

- Domain base, such as accounting concepts.
- Jurisdiction layer, such as Romania.
- Period or edition layer, such as tax year 2026.
- Optional professional commentary layer.
- Organization overlay containing approved internal policy.

Dependencies and precedence must be explicit. When two applicable sources conflict, preserve and surface both with authority, date, and provenance rather than overwriting one.

Bundle retrieval should be a distinct source scope from customer documents. The UI may show a simple label such as `Library`, but evidence packs and audit records must retain whether a claim came from a customer file, a knowledge bundle, deterministic tool output, or model-generated derived material.

## Derived Accelerators

The safest default is to build retrieval state locally from normalized content. This avoids compatibility failures when the parser, chunker, encoder, vector dimension, normalization rule, or index engine changes.

A publisher may include an optional accelerator only when it declares the complete derivation key:

- Source and normalized-resource digests.
- Canonical schema version.
- Parser and parser configuration.
- Chunker and chunking configuration.
- Embedding model artifact digest, tokenizer, dimension, normalization, and task prefix.
- Index engine and format version.
- Quantization method and parameters.
- Summary model, prompt, verifier, and generation settings.
- Platform constraints where the artifact is not portable.

Garden Desk may use an accelerator only on an exact compatibility match and after validating its references. Otherwise it rebuilds locally. Rebuilding retrieval state must never change bundle identity because accelerators are not authoritative payloads for evidence.

Model-generated summaries must be visibly classified as derived, retain citations, and never substitute for the included source.

## Trust, Signing, And Offline Updates

Checksums detect corruption; they do not establish who published a bundle. Every official or organization-managed bundle must be authenticated before activation.

Use a TUF-style signed update repository for official channels and offline media:

- Trusted root keys are provisioned with Garden Desk or by an organization administrator.
- Target metadata binds every bundle to its cryptographic hash and byte length.
- Snapshot and version metadata prevent mix-and-match and rollback attacks.
- Expiring metadata detects stale or frozen update channels.
- Root and signing keys can rotate without replacing the application.
- Delegated roles can separate domains, jurisdictions, publishers, and organization-local bundles.
- Threshold signing should protect high-value official roots.

An air-gapped update medium must carry the complete metadata chain required for offline verification. Installed content may continue to work after repository metadata expires; a new install or update must not silently bypass expired metadata. Controlled environments need an audited procedure for trusted time, media issuance, emergency expiration recovery, and root rotation.

Sigstore bundles are useful optional release attestations because current formats can carry signatures, certificates, transparency-log evidence, and timestamps for offline verification. They should not replace the local trust policy or TUF update roles: a valid signature proves control of an identity, not that Garden Desk should trust that identity to publish Romanian tax knowledge.

Community sideloading may permit unsigned bundles only behind a clear untrusted status and explicit approval. Organization policy may prohibit it entirely. Signature trust must never grant execution capability.

## Import Security

Treat a bundle as hostile input even when it is signed. A compromised publisher can sign a malformed archive, and signatures do not make parsers safe.

Bundle inspection and extraction must run through the certified no-network microVM boundary with:

- Total compressed and expanded byte limits.
- Per-file and file-count limits.
- Compression-ratio and nesting limits.
- CPU, memory, time, and scratch-space limits.
- Rejection of absolute paths, parent traversal, ambiguous separators, duplicate normalized paths, device names, special files, hard links, and unsafe symbolic links.
- Declared-versus-detected media-type checks.
- Schema validation before catalog writes.
- Complete checksum verification before activation.
- No execution of contained scripts, macros, HTML active content, or workflow definitions.
- Atomic host-side commit only after the worker's result is validated.

Garden Desk should render human-readable descriptions as inert content. A bundle cannot add tools, change prompts, alter approvals, request network access, or modify workspace policy.

## Rights And Governance

Openly readable does not mean redistributable. Every candidate bundle needs a resource-level rights review covering copyright, database rights, attribution, modification, commercial redistribution, territory, update obligations, and source terms.

Required governance records should include:

- Declared license and concluded license.
- Copyright and database-rights holder where known.
- Attribution text.
- Original source and acquisition date.
- Redistribution and modification decision.
- Review owner and review date.
- Personal or confidential information classification.
- Retention and withdrawal requirements.
- Required notices shipped with the bundle.

Public-source snapshots should retain the original publication and acquisition metadata. If redistribution is not permitted, Garden Desk may support a local user-created bundle from lawfully obtained materials, but must not distribute those materials itself.

## Quality Contract

Each curated bundle should ship a human-readable quality card and a machine-readable evaluation set containing:

- Scope, exclusions, jurisdictions, periods, and languages.
- Source inventory by authority class.
- Known omissions and unresolved conflicts.
- Normalization and extraction warnings.
- Freshness and planned update cadence.
- Representative questions with expected source IDs and anchors.
- Historical and supersession cases.
- Questions that should return insufficient evidence.
- Prompt-injection and malicious-content fixtures.
- Retrieval recall and citation-candidate targets.
- Claim-support and contradiction-detection targets.
- License and attribution conformance checks.

Publisher-supplied cases are conformance fixtures, not the held-out acceptance corpus. Garden Desk must maintain separate held-out evaluation and periodically test bundles against the exact production retrieval and verification pipeline.

## Update Lifecycle

Bundle updates should be:

- Immutable releases rather than in-place mutation.
- Hash-pinned and signature-verified.
- Downloadable or transferable as complete offline packages.
- Optionally delta-encoded for transport, with the reconstructed result verified against the full target digest.
- Staged beside the active version.
- Validated for dependencies, rights, schema, anchors, and evaluation gates.
- Activated atomically.
- Reversible while retention policy permits.
- Audited with old and new digests.

The UI should distinguish:

- Published date.
- Knowledge cutoff.
- Effective or coverage period.
- Installed date.
- Last checked-for-update date.
- Superseded or withdrawn status.

These dates answer different questions and must not be collapsed into a single `updated` field.

## Rejected Shortcuts

- **One vector database per domain:** locks evidence to an encoder and index format, weakens provenance, and makes migration or citation repair difficult.
- **Fine-tuning domain facts into Gemma:** hides sources, makes updates expensive, and cannot provide reliable temporal or jurisdictional citations.
- **One giant universal library:** increases update cost, rights conflicts, irrelevant retrieval, and ambiguity about applicable dates and jurisdictions.
- **Mutable bundles:** break replay, signatures, audit, and safe rollback.
- **Trusting checksums without signatures:** detects accidental corruption but not a malicious publisher or rollback.
- **Trusting signatures without policy:** proves an identity signed bytes but does not establish publishing authority.
- **Shipping executable logic inside a knowledge bundle:** turns evidence distribution into a plugin supply-chain risk.
- **Treating summaries as sources:** converts model output into circular evidence.
- **Silently merging organization overlays with public authority:** hides conflicts and makes advice impossible to audit.

## M0 Validation Questions

Before freezing the format in an ADR:

- Validate RO-Crate 1.3 and SPDX 3.0.1 library maturity in the TypeScript/Node toolchain.
- Decide whether strict BagIt conformance reduces code or merely duplicates the Vault manifest.
- Compare ZIP64 and tar plus Zstandard for cross-platform streaming, random access, deterministic construction, recovery, and safe extraction.
- Validate a TUF client and repository implementation with offline removable media, delegated domains, root rotation, expired metadata, and clock skew.
- Decide whether official bundles also require Sigstore release attestations.
- Benchmark local rebuild versus shipped accelerators on representative accounting and legal bundles.
- Measure cross-bundle content deduplication and garbage collection.
- Define the first domain profile fields and authority taxonomy with a subject-matter expert.
- Complete legal review for each intended source library before redistribution.

## Research Basis

The comparative research and primary source links are recorded in [research/offline-knowledge-bundles-2026.md](research/offline-knowledge-bundles-2026.md).
