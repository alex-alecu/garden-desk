# Implementation Quality Bar

Created: 2026-07-10

This document defines the implementation quality constraints for Vault Desk. M0 and M1 are complete, the macOS inference foundation exists, and M3 is active under [AGENTS.md](../AGENTS.md).

The goal is the least amount of new code and the least amount of tests that still protects the product's privacy, correctness, auditability, and local performance promises.

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
- MicroVM lifecycle, immutable guest images, and no-NIC verification.
- Bounded generic-agent orchestration, inference mediation, result validation, and audit.
- Tauri session/folder interface and packaged sidecar lifecycle.
- The minimal Tauri sidecar and capability boundary.

Do not write custom infrastructure when a maintained local dependency can satisfy a narrow adapter contract.

## Default Component Stack

To minimize code written and code changed later, the implementation should start from this verified default stack (component research revalidated 2026-07-11; see [research/document-tools-2026.md](research/document-tools-2026.md) and [research/local-ai-runtimes.md](research/local-ai-runtimes.md)). Each row is a default behind an adapter contract, not a hard dependency; replacing a row must not ripple past its adapter.

| Responsibility | Default component | Fallback | Why least code |
|---|---|---|---|
| Generation runtime | node-llama-cpp (MIT) in a supervised inference worker | Pinned llama.cpp command adapter | Typed Node integration, official Gemma 4 QAT GGUFs, grammar-enforced JSON output, function calling, embeddings, and crash containment |
| Direct image inspection | Pinned llama.cpp `llama-mtmd-cli` child using the generation model and its projector | Later reviewed local vision adapter | Same model and runtime family as generation, with one bounded offline process and no separate ML stack |
| Post-V1 document vision and OCR | Later reviewed llama.cpp-compatible document model | Specialized no-NIC document worker | Keeps document extraction out of the V1 direct-image path and requires measured value before expansion |
| Born-digital parsing | Native Node parsers in a no-NIC microVM: pdf.js, mammoth, ExcelJS/SheetJS, officeParser, mailparser | Process-only compatibility mode, not certified | Permissive licenses, covers most files, and places hostile inputs behind a VM boundary |
| Layout-aware parsing | Granite-Docling-258M GGUF | Docling Python sidecar | Docling-class quality through the already-shipped runtime |
| Remaining formats and fallback parsing | One Python worker image in the no-NIC microVM (Docling, MarkItDown, Unstructured) | — | One isolated dependency image instead of scattered host processes |
| Hostile-work isolation | Platform microVM launcher with no virtual NIC and typed host/guest socket | Process-only sandbox, explicitly non-certified | Structural network denial and a separate guest kernel without command matching |
| Deterministic document operations | Typed Vault Core queries over canonical documents | Format adapter escalation | Common search, filter, join, compare, calculate, and extraction behavior without model-generated scripts |
| Long-tail transformation | Minimal Vault Desk-owned code-interpreter guest loop in a fresh no-NIC microVM | OpenCode only if it passes identical offline, security, footprint, and audit gates and reduces code | Keeps uncommon transformations possible without making a coding agent the product backend |
| Index (lexical plus dense) | LanceDB (Apache 2.0) | sqlite-vec plus FTS5; turbovec via the Python sidecar if benchmarks justify | One embedded dependency covers full-text, vector, hybrid fusion, and quantization |
| Embeddings | Qwen3-Embedding-0.6B via node-llama-cpp GGUF | Transformers.js ONNX | Same runtime as generation; Apache 2.0 official GGUF |
| Tool loop | Vercel AI SDK 6 (Apache 2.0) with per-tool approval gating | Thin hand-rolled loop on node-llama-cpp | Approval-paused tool execution and typed schemas provided, policy stays in Vault Desk code |
| Structured output | JSON Schema to grammar via node-llama-cpp, schemas defined once in TypeScript | — | One schema source feeds grammar, validation, and tool typing |
| Audit trace shape | Small versioned Vault Desk schema persisted to a local append-only log, with no telemetry exporter | — | Keeps the customer-owned audit contract explicit, stable, local, and limited to product needs |
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

## Minimal Test Rule

Tests should protect invariants and user-visible behavior. They should not exist to document framework wiring.

Required first tests:

- Path scope and permission decisions.
- Tool schema validation.
- Approval gates for consequential actions.
- Audit event creation.
- Manifest resumability.
- Parser routing decisions.
- Evidence-pack citation requirements.
- Claim verification outcomes.
- Spreadsheet calculation checks.
- Compaction state preservation.
- Runtime adapter failure handling.
- Offline/no-cloud behavior.
- Cross-platform daemon lifecycle and protocol compatibility.
- Workspace migration, atomicity, idempotency, and crash recovery.
- Hostile-document, prompt-injection, worker-limit, and microVM escape behavior.
- Zero virtual network adapters and failed DNS, IPv4, IPv6, LAN, multicast, and host-network probes.
- Proof that typed host/guest IPC cannot become a general network proxy.
- Native accelerator OS-sandbox and network-capability denial.
- Exact folder-wide XLSX search with source cell anchors and no model or code-interpreter invocation.
- Deterministic-versus-code routing policy.
- Generated-code no-NIC isolation, typed inference mediation, resource limits, result verification, and replayable audit.
- Tauri command denial, sidecar identity, local-protocol bootstrap, and platform-webview lifecycle.

Do not add broad snapshot tests, brittle UI tests, or duplicated mock-heavy tests before the underlying behavior is stable.

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

Avoid a central "agent brain" module. Vault Desk should be a set of explicit workflows and typed tools with model calls as one step inside those workflows.

## Test Selection Policy

When deciding whether to add a test, ask:

- Can this failure leak private data?
- Can this failure perform an action without approval?
- Can this failure lose source anchors, citations, or audit data?
- Can this failure make a verified answer unsupported?
- Can this failure corrupt an export?
- Can this failure make a long folder job non-resumable?
- Can this failure make hardware tiers behave differently beyond their memory and context allocation?
- Can this failure make authoritative workspace state unrecoverable or derived state impossible to rebuild?
- Can untrusted document content or a worker escape its data-only role?
- Can a certified microVM acquire a network device or turn typed host/guest IPC into a general proxy?
- Can a native accelerator gain network, shell, credential, tool, approval, or arbitrary workspace authority?
- Can generated code reach a network, host path, credential, package manager, approval, export, or generic model endpoint?
- Can generated code modify the selected host folder or survive outside the validated bounded session workspace?
- Can a session or attachment receive another folder's authority?
- Can the Tauri webview invoke an arbitrary command, process, path, URL, endpoint, or model file?

If the answer is yes, add a focused test. If the answer is no, prefer a simpler implementation and defer the test.

## Implementation Entry Gate

Before code for a milestone is added, the implementation plan must name:

- The first workflow being implemented.
- The product contract it exercises.
- The minimal adapter interfaces required.
- The invariants that must be tested.
- The dependencies being used instead of custom code.
- The code that will intentionally not be written.

No package manifest or source tree should be created until that plan exists and the milestone is active. M3 satisfies this entry gate through [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md#m3--offline-dev-agent-desktop-v1--active), [ADR 0018](adr/0018-offline-dev-agent-first.md), and [M3_STATUS.md](M3_STATUS.md).

## Revision History

| Date | Change |
|---|---|
| 2026-07-10 | Added future minimal-code, minimal-test, and Clean Code quality constraints. |
| 2026-07-11 | Added the verified default component stack table so implementation starts from proven components behind adapter contracts. |
| 2026-07-11 | Added persistence recovery, cross-platform process, hostile-document, and worker-isolation invariants to the first implementation quality gates. |
| 2026-07-12 | Required a no-NIC microVM for certified hostile work and made process-only sandboxing a non-equivalent fallback. |
| 2026-07-13 | Added Tauri, deterministic document operations, and the bounded code-interpreter fallback to the minimal component and test bar. |
| 2026-07-16 | Activated the quality bar for M0 while retaining milestone-scoped authorization. |
| 2026-07-17 | Replaced the proposed OpenTelemetry trace shape with a minimal Vault Desk-owned local audit schema and no exporter. |
| 2026-07-20 | Replaced the pre-V1 document-specific quality surface with the generic offline dev-agent desktop gate. |
| 2026-07-22 | Replaced fixed profile checks with automatic memory-tier and Windows GPU-budget validation. |
| 2026-08-15 | Replaced the proposed vision server with the implemented bounded llama-mtmd-cli direct-image adapter and kept document vision after V1. |
