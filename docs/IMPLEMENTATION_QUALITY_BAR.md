# Implementation Quality Bar

Created: 2026-07-10

This document defines the implementation quality constraints for Garden Desk. M0 and M1 are complete, the macOS inference foundation exists, and M3 is active under [AGENTS.md](../AGENTS.md).

The goal is the least amount of new code and the least amount of tests that delivers the active product contracts. The architecture, not layers of input checks, protects the guest boundary.

## Minimal Code Rule

Implementation starts from product contracts, not framework defaults.

Add code only when it is required to express one of these product responsibilities:

- Folder grants, attachments, grouped sessions, turns, and drafts.
- Typed agent and desktop boundaries.
- Policy decisions.
- Runtime adapter contracts.
- Audit events.
- Schema-versioned workspace recovery.
- Worker supervision and resource limits.
- MicroVM lifecycle, immutable guest images, and no-network verification.
- Bounded generic-agent orchestration, inference mediation, result validation, and audit.
- Tauri session/folder interface and packaged sidecar lifecycle.
- The minimal Tauri sidecar and capability boundary.

Do not write custom infrastructure when a maintained local dependency can satisfy a narrow adapter contract.

The no-network microVM and read-only `/source` mount contain agent-authored commands and hostile files. Do not add source-pattern filters, URL or address matching, content scans, format allowlists, or repeated checks for paths used only inside the guest. Add validation only when data crosses into host authority and the active product contract names the check.

## Post-V1 Component Research (Not Active)

V1 uses only the components present under `packages/`. The table below is research for the post-V1 document-intelligence work and is not an instruction to add any of it now (component research revalidated 2026-07-11; see [research/document-tools-2026.md](research/document-tools-2026.md) and [research/local-ai-runtimes.md](research/local-ai-runtimes.md)). Each row is a default behind an adapter contract, not a hard dependency; replacing a row must not ripple past its adapter.

| Responsibility | Default component | Fallback | Why least code |
|---|---|---|---|
| Generation runtime | node-llama-cpp (MIT) in a supervised inference worker | Pinned llama.cpp command adapter | Typed Node integration, official Gemma 4 QAT GGUFs, grammar-enforced JSON output, function calling, embeddings, and crash containment |
| Direct image inspection | Pinned llama.cpp `llama-mtmd-cli` child using the generation model and its projector | Later reviewed local vision adapter | Same model and runtime family as generation, with one bounded offline process and no separate ML stack |
| Post-V1 document vision and OCR | Later reviewed llama.cpp-compatible document model | Specialized no-network document worker | Keeps document extraction out of the V1 direct-image path and requires measured value before expansion |
| Born-digital parsing | Native Node parsers in a no-network microVM: pdf.js, mammoth, ExcelJS/SheetJS, officeParser, mailparser | Process-only compatibility mode, not certified | Permissive licenses, covers most files, and places hostile inputs behind a VM boundary |
| Layout-aware parsing | Granite-Docling-258M GGUF | Docling Python sidecar | Docling-class quality through the already-shipped runtime |
| Remaining formats and fallback parsing | One Python worker image in the no-network microVM (Docling, MarkItDown, Unstructured) | — | One isolated dependency image instead of scattered host processes |
| Hostile-work isolation | Platform microVM launcher with no virtual NIC and typed host/guest socket | Process-only sandbox, explicitly non-certified | Structural network denial and a separate guest kernel without command matching |
| Deterministic document operations | Typed Garden Desk Core queries over canonical documents | Format adapter escalation | Common search, filter, join, compare, calculate, and extraction behavior without model-generated scripts |
| Long-tail transformation | Minimal Garden Desk-owned code-interpreter guest loop in a fresh no-network microVM | OpenCode only if it passes identical offline, security, footprint, and audit gates and reduces code | Keeps uncommon transformations possible without making a coding agent the product backend |
| Index (lexical plus dense) | LanceDB (Apache 2.0) | sqlite-vec plus FTS5; turbovec via the Python sidecar if benchmarks justify | One embedded dependency covers full-text, vector, hybrid fusion, and quantization |
| Embeddings | Qwen3-Embedding-0.6B via node-llama-cpp GGUF | Transformers.js ONNX | Same runtime as generation; Apache 2.0 official GGUF |
| Tool loop | Vercel AI SDK 6 (Apache 2.0) with per-tool approval gating | Thin hand-rolled loop on node-llama-cpp | Approval-paused tool execution and typed schemas provided, policy stays in Garden Desk code |
| Structured output | JSON Schema to grammar via node-llama-cpp, schemas defined once in TypeScript | — | One schema source feeds grammar, validation, and tool typing |
| Audit trace shape | Small versioned Garden Desk schema persisted to a local append-only log, with no telemetry exporter | — | Keeps the customer-owned audit contract explicit, stable, local, and limited to product needs |
| Desktop shell | Tauri v2 with React/TypeScript and a minimal Rust host | — | Operating-system webview, capability-scoped native surface, sidecar packaging, and no product logic in the shell |

Avoid:

- Custom OCR engines.
- Custom document parsers.
- Custom vector databases.
- Custom model runtimes.
- Broad plugin systems before one workflow is proven.
- Generic agent frameworks that obscure policy and audit boundaries.
- Generated boilerplate that is not exercised by a workflow.
- Generated code for common supported document operations.
- A networked, host-authorized, or unbounded coding workspace.

## Test Rule

The Test Rule in [AGENTS.md](../AGENTS.md#test-rule) is the only test policy: test architecture boundaries, business logic, and bugs; never the model. Bug fixes start with one failing reproduction test; everything else is implemented first and gets at most one focused test. Do not add broad snapshot tests, brittle UI tests, or mock-heavy duplicates.

## Clean Code Principles To Enforce

The following principles are based on the major themes of Clean Code by Robert C. Martin, summarized here as project guidance rather than quoted source text.

1. Use intention-revealing names for modules, functions, types, and events.
2. Keep functions small enough to explain one decision or transformation.
3. Keep one level of abstraction per function.
4. Give each module one reason to change.
5. Remove duplication before adding options.
6. Prefer explicit typed boundaries over implicit shared state.
7. Make command functions and query functions distinct.
8. Avoid boolean flag arguments that hide multiple behaviors.
9. Represent errors deliberately and handle them close to the boundary that can recover.
10. Keep comments rare and useful; prefer clearer names and smaller functions.
11. Keep formatting conventional and boring.
12. Keep tests readable as behavior specifications.
13. Test behavior and invariants, not private implementation details.
14. Keep adapters thin around third-party tools.
15. Keep policy decisions separate from model output.
16. Keep data structures stable at persistence and audit boundaries.
17. Avoid speculative generality and unused extension points.
18. Refactor only to reduce current complexity or protect a proven boundary.
19. Make dependencies point inward toward product contracts.
20. Leave the codebase easier to reason about after every change.

## Architecture Consequences

The TypeScript/Node harness should be small because it coordinates work rather than doing all work itself.

Preferred shape:

- Thin local API.
- Thin runtime adapters.
- Thin parser adapters.
- Small policy engine.
- Small manifest store.
- Small evidence-pack builder.
- Small verifier orchestration layer.
- Small compaction state manager.

Avoid a central "agent brain" module. Garden Desk should be a set of explicit workflows and typed tools with model calls as one step inside those workflows.

## Implementation Entry Gate

Before code for a milestone is added, the implementation plan must name:

- The first workflow being implemented.
- The product contract it exercises.
- The minimal adapter interfaces required.
- The invariants that must be tested.
- The dependencies being used instead of custom code.
- The code that will intentionally not be written.

No package manifest or source tree should be created until that plan exists and the milestone is active. M3 satisfies this entry gate through [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md#m3--offline-dev-agent-desktop-v1--active), [ADR 0018](adr/0018-offline-dev-agent-first.md), and [M3_STATUS.md](M3_STATUS.md).
