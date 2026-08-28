# Open Source Boundary

Created: 2026-07-10

Garden Desk should use a useful open-source community application to create trust, distribution, product feedback, and demand for supported deployments.

The community product must be real software, not a crippled demo.

## Community Candidate Modules

Likely open-source:

- Desktop application shell.
- Local single-user workspace.
- Local document ingestion.
- Deterministic canonical-document search, filtering, comparison, calculation, and extraction.
- Bounded no-network code-interpreter fallback and its audit surface.
- Local search and retrieval.
- Local model/runtime adapter interface.
- Safe folder access.
- Basic tool registry.
- Local Knowledge Bundle reader, verifier, catalog, and rebuildable indexing.
- Approval UI for local actions.
- Export workflows.
- Hardware compatibility check.
- Community documentation.

## Business Candidate Modules

Likely proprietary:

- Organization management.
- Multi-user administration.
- Identity integration.
- Role and policy engine.
- Permission-aware retrieval across shared workspaces.
- Approval workflows for teams.
- Immutable audit trail.
- Backup orchestration.
- Appliance and fleet management.
- Long-term supported release channels.
- Curated and supported professional Knowledge Bundle channels, delegated publisher roots, and organization-local bundle governance.
- Business integrations.
- Administration dashboard.
- Diagnostics and support tooling.
- Support SLA enforcement.

## Boundary Principles

- The community product must remain independently useful.
- Business controls should not contaminate the community core with hard-coded limitations.
- Shared abstractions should be designed once and used by both desktop and office editions.
- Proprietary modules should add governance, scale, supportability, and integrations.
- The user should not need to understand which module handles a task.

## Licensing Decisions

Resolved decisions:

- Community source license: Apache License 2.0, selected by the repository owner on 2026-07-15. The root `LICENSE` file was added when M0 began, per [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Rationale: explicit patent grant over MIT, no CLA needed alongside the DCO-only contribution rule, compatible with the open-core boundary in this document, and matching Gemma 4, llama.cpp, and node-llama-cpp licensing. The permissive norm in the adjacent space (AnythingLLM, Hermes, OpenClaw, OpenCode, Onyx community on MIT; Jan on Apache 2.0) and the Open WebUI custom-license backlash both informed the choice.
- Contributor agreement strategy: Developer Certificate of Origin 1.1 sign-off with no CLA, per [CONTRIBUTING.md](../CONTRIBUTING.md).
- Compliance ownership: the repository owner is responsible for dependency, model, notice, and redistribution approval decisions until a second maintainer is appointed and this line is updated.
- Model and third-party notice strategy: manifest-driven `development` / `candidate_to_ship` / `ships` status with packaged notices, SBOMs, and inventories, per [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

Open decisions:

- Trademark policy.
- Whether business plugins can depend on community extension points.

Known model-license facts (verified 2026-07-11):

- Gemma 4 (including 12B QAT) is Apache 2.0. It can be redistributed inside community packaging with standard notices.
- Qwen3-Embedding-0.6B, the default encoder per [ADR 0016](adr/0016-model-agnostic-defaults-and-managed-downloads.md), is Apache 2.0 with an official GGUF release, so the default shipped stack is fully Apache 2.0.
- EmbeddingGemma (validated alternative encoder) remains under the Gemma Terms of Use, not Apache 2.0. Redistribution and bundling terms need explicit review before it could ship inside any installer.
- Candidate third-party components are permissively licensed: turbovec (MIT), Docling (MIT), MarkItDown (MIT), llama.cpp and node-llama-cpp (MIT).
- The M3 Windows package includes only the NVIDIA cuBLAS 13.2.0.9 DLLs listed as redistributable by the CUDA Toolkit EULA. Their archive and file hashes, upstream license, package notices, SBOM entry, and bounded review are recorded in [the Windows runtime dependency review](research/m3-windows-runtime-dependency-review.md).

Implementation consequence: every model and native runtime begins as a development or candidate-to-ship asset. A candidate can be marked as shipping only after redistribution terms, required notices, platform package behavior, hashes, and offline operation are reviewed. Packaging must emit third-party notices plus dependency and model inventories.

The same gate applies resource by resource to Knowledge Bundles. Public access does not establish copyright, database-rights, modification, or commercial redistribution permission. Each distributed bundle needs declared and concluded licenses, attribution, provenance, intended-use, review ownership, and a recorded redistribution decision. Locally built private bundles may reference lawfully obtained materials that Garden Desk itself is not permitted to redistribute.

## Intellectual Property Hygiene

This repository should contain:

- Original Garden Desk concepts.
- Public market knowledge.
- Public prior-art summaries.
- Architecture hypotheses.
- Future product decisions.

This repository should not contain:

- Employer code.
- Employer confidential information.
- Employer internal architecture.
- Employer-owned generated assets.
- Third-party proprietary source.
- Unlicensed copied documentation.

Before signing employment or investment agreements, review the repository and concept timeline with an employment/IP lawyer.
