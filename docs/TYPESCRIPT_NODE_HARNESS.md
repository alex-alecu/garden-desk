# TypeScript Node Harness

Created: 2026-07-10

This document defines the implementation direction. M0 now contains only the workspace and validation scaffolding authorized by [AGENTS.md](../AGENTS.md).

Vault Core and the local orchestration layer are TypeScript running on Node.js. The Tauri v2 desktop host is the narrow exception: it contains only the minimum Rust needed for the native shell and sidecar boundary.

## Scope Of The Harness

The TypeScript/Node harness should eventually own:

- Local API.
- Session orchestration.
- Workspace state.
- Job queue coordination.
- Resumable folder job manifests.
- Tool registry.
- Policy checks.
- Approval flow.
- Model runtime adapters.
- Document pipeline orchestration.
- Retrieval orchestration.
- Summary tree orchestration.
- Claim verification orchestration.
- Context compaction orchestration.
- Audit events.
- Export coordination.
- Diagnostics.
- Schema-versioned workspace migrations.
- Worker supervision and resource scheduling.
- MicroVM lifecycle and guest-image verification.
- Typed external-connection brokering.
- Deterministic document query and transformation routing.
- Bounded code-interpreter job orchestration and audit.

The harness should not directly become:

- A model runtime.
- An OCR engine.
- A vector database implementation.
- A UI framework.
- A privileged host-shell bridge.
- An unbounded host coding environment.

Those should be adapters, services, or tools behind typed boundaries.

## Sandbox Boundary

The harness coordinates a platform sandbox launcher behind one contract. Hostile document parsing may use disposable job-scoped microVMs; the M3 development agent uses a reusable session-scoped microVM. Both have no virtual network device. The launcher must not approximate network isolation by matching commands, executables, URLs, domains, addresses, or protocols.

The common microVM contract provides:

- A verified immutable guest image.
- Job-scoped read-only inputs for document work, or a live read-only source mount plus immutable attachments for the development agent.
- Bounded ephemeral document scratch, or the development agent's bounded persistent workspace and ephemeral runtime tmpfs.
- Versioned typed IPC over virtio-socket, Hyper-V socket, or the platform-equivalent host/guest channel.
- CPU, memory, time, storage, output-size, concurrency, cancellation, and termination controls.
- Configuration evidence that no virtual network adapter or general host-network proxy exists.

Research-derived platform targets are Apple Containerization or Virtualization.framework on macOS 26 Apple silicon, HCS/Hyper-V on supported Windows editions, and Firecracker/KVM when Linux desktop certification opens. M0 must validate exact APIs, packaging, edition requirements, licensing, and lifecycle behavior before implementation choices are locked.

Vault Core exposes no generic network service to the guest. Explicit external integrations use a separate typed broker that owns credentials, policy, approval, destination validation, limits, and audit. The broker cannot be invoked as an arbitrary fetch or forwarding service.

Hardware-accelerated inference remains host-native for the first runtime so Metal, CUDA, HIP, and Vulkan remain available. The inference process is supervised and OS-sandboxed, has no shell or executable tools, and receives no network capability, credentials, arbitrary workspace paths, or approval authority. This is a narrow accelerator exception, not an alternative hostile-work sandbox. See [adr/0012-worker-isolation-and-untrusted-documents.md](adr/0012-worker-isolation-and-untrusted-documents.md).

Agent-authored code uses a separate immutable guest role under the same no-NIC microVM contract. Each session receives a live read-only folder mount, immutable explicit attachments, pinned offline interpreters and tools, a persistent 128 MiB workspace, and a typed result schema. The guest cannot install dependencies or connect to a general model server. Vault Core mediates bounded completion requests over typed host/guest IPC, records observable source, commands, and results, validates workspace manifests, and keeps at most one warm idle VM. See [adr/0018-offline-dev-agent-first.md](adr/0018-offline-dev-agent-first.md).

## Local Process Boundary

Vault Core should run as a separate packaged sidecar process from the Tauri shell from the first implementation milestone. The versioned local JSON-RPC protocol uses a Unix domain socket on macOS and a named pipe on Windows behind one transport contract. TCP is not part of the desktop boundary.

The React webview calls only narrow typed Tauri commands. The minimal Rust host owns native window/dialog integration, validates its command surface, starts and verifies the exact Vault Core sidecar, and bootstraps the local connection. It owns no product workflow or policy.

The protocol must include request and job IDs, idempotency keys for mutations, cancellation, bounded streaming, backpressure, reconnect behavior, version negotiation, and structured errors. Unit tests may call the core API directly, but every milestone must also exercise new backend behavior through the daemon. See [adr/0010-electron-and-local-transport.md](adr/0010-electron-and-local-transport.md) and [adr/0014-tauri-desktop-shell.md](adr/0014-tauri-desktop-shell.md).

## Workspace State Principle

Authoritative workspace state, immutable artifacts, and derived indexes must be distinguishable by construction.

- A transactional, schema-versioned catalog owns jobs, manifests, sessions, approvals, evidence references, verification results, and migrations.
- Canonical documents and evidence artifacts are content-addressed and written atomically.
- LanceDB indexes, embeddings, summaries, and caches are rebuildable derived state.
- A single-writer lock, idempotent mutations, durable resume cursors, backup-before-migrate, and explicit cleanup protect recovery.
- Routine audit records avoid copying raw sensitive content when hashes, structured metadata, redacted previews, and artifact references are sufficient.

See [adr/0011-workspace-state-and-recovery.md](adr/0011-workspace-state-and-recovery.md).

## Why TypeScript Under Node

TypeScript under Node is the planned baseline because it gives:

- Strong typing for tool schemas and policy decisions.
- A product backend that remains independent from the Tauri webview and thin Rust host.
- Mature local API patterns.
- Straightforward streaming support.
- Broad ecosystem support for document, filesystem, worker, and observability integration.
- Easier cross-platform packaging than a server-only stack.

## Future Package Direction

Do not create packages yet.

When code begins, likely logical package boundaries include:

- Tauri desktop shell: React/TypeScript frontend plus minimal Rust host.
- Local API.
- Orchestrator.
- Tool registry.
- Policy engine.
- Audit events.
- Runtime adapters.
- Document adapters.
- Workflow definitions.
- Document-set manifests.
- Parser adapter contracts.
- Retrieval adapter contracts.
- Verifier contracts.
- Shared types.
- Test fixtures and evaluation harness.

These are logical boundaries only. They should be revisited before scaffolding.

## Runtime Adapter Principle

The Node harness should call local inference runtimes through stable adapter interfaces rather than embedding one vendor runtime deeply into the product.

Candidate adapter families (support status verified 2026-07-11; see [research/local-ai-runtimes.md](research/local-ai-runtimes.md)):

- node-llama-cpp (MIT) as the first supervised inference-worker adapter: loads Gemma 4 QAT GGUFs, enforces JSON-schema output via grammar-constrained sampling, and supports function calling, embeddings, reranking, speculative decoding, and multiple parallel context sequences on one loaded model (`sequences`, `sequencesLeft`, and a maximum-parallelism batch strategy), with Metal, CUDA, and Vulkan builds. Parallel generation is therefore bounded by KV-cache memory rather than by the runtime; V1 uses bounded extra sequences for sub-agents and plans to extend them to concurrent conversations. It runs behind Vault Core rather than inside the Tauri webview or Rust host.
- The pinned llama.cpp `llama-mtmd-cli` as the supervised on-demand image adapter for the current Gemma 4 model pair. It runs one bounded offline request after the resident node-llama-cpp chat worker unloads. Later document-vision models must use the same narrow adapter or a separately reviewed equivalent.
- MLX-family local serving on macOS.
- Ollama-compatible serving.
- Google LiteRT-LM's OpenAI-compatible local server as an emerging Google-first adapter to track.
- vLLM-compatible serving for appliances or stronger local servers.
- Hosted fallback adapters only when explicitly enabled.

ONNX Runtime GenAI has no official Node.js bindings as of July 2026 and is not a candidate primary runtime.

The first Windows and macOS certification uses node-llama-cpp and the pinned official QAT GGUF. MLX-family serving remains a later adapter-backed optimization rather than a parallel first implementation. See [adr/0013-first-desktop-runtime.md](adr/0013-first-desktop-runtime.md).

The first certified adapters should be evaluated against the hardware-derived Gemma 4 12B QAT budgets documented in [MODEL_STRATEGY.md](MODEL_STRATEGY.md) and [PERFORMANCE_AND_CONTEXT.md](PERFORMANCE_AND_CONTEXT.md).

## Structured Output Principle

Structured output from local models must be enforced at the sampler, not requested in the prompt. llama.cpp converts JSON Schema to GBNF grammar and masks invalid tokens, making malformed JSON mechanically impossible. The harness should:

- Define every tool and extraction schema once, in TypeScript (Zod or equivalent), and derive both the grammar and the validator from it.
- Also describe the schema in the prompt, because the grammar is not visible to the model.
- Keep validate-and-retry as a semantic backstop for content that is syntactically valid but wrong.
- Track first-attempt schema validity as a benchmark metric.

## Document Pipeline Principle

The Node harness should coordinate document processing without becoming the parser itself.

Planned adapter categories (tool choices verified 2026-07-11; see [research/document-tools-2026.md](research/document-tools-2026.md)):

- Native Node adapters for born-digital files: pdf.js text layer, mammoth for DOCX, ExcelJS or SheetJS for spreadsheets, officeParser, and mailparser. These run in microVM document workers and cover most files without a heavy Python pipeline.
- Granite-Docling GGUF adapter for layout-aware PDFs and complex documents, served by the same llama.cpp runtime family as Gemma.
- PaddleOCR-VL adapter for scanned pages and low-confidence extraction, also served under llama.cpp.
- One Python document-worker image hosting the remaining Python parsers (Docling full pipeline, MarkItDown, Unstructured) inside the same no-NIC microVM boundary, packaged without exposing Python dependencies to Vault Core.
- Native spreadsheet adapter for XLSX, XLS, CSV, formulas, sheets, rows, and cells.
- Gemma multimodal inspection adapter for ambiguous page regions.

Worker rule: document parsing and executable tools run inside the no-NIC microVM boundary with typed host/guest IPC, resource limits, cancellation, and staged inputs. Host-native GPU workers use the narrower OS-enforced accelerator exception and cannot execute tools or access networks. At most one Python worker image may host later Python parser fallbacks. See [adr/0012-worker-isolation-and-untrusted-documents.md](adr/0012-worker-isolation-and-untrusted-documents.md).

The harness should persist a document-set manifest so huge folder jobs can resume after failure.

## Hybrid Execution Principle

For V1, use the generic offline dev agent for folder and attachment work. Add typed deterministic operations after V1 only when measurements prove that a maintained operation materially improves speed, accuracy, evidence quality, or model cost. Such operations remain Vault Core-owned and cannot weaken guest isolation or grant host-write authority.

Only a request that cannot be expressed through supported operations may be routed by policy to the bounded code-interpreter microVM. Generated code is untrusted input to the verifier, not product authority. Its source, environment, inputs, outputs, logs, resource use, and termination are auditable, and any workspace write or export still crosses normal policy and approval boundaries.

OpenCode may be benchmarked against a minimal Vault Desk-owned guest loop. It is adopted only if it passes the same offline, no-NIC, typed-inference, cancellation, audit, result-schema, footprint, and packaging gates while reducing maintained code.

## Agent Loop Principle

The first accounting workflow should be an explicit, inspectable workflow rather than a generic agent loop. Deterministic document tools precede iterative model/tool use. Where bounded iterative read-tool use is needed, prefer a maintained framework only if it preserves the approval boundary and reduces code. Verified 2026-07-11: Vercel AI SDK 6 (Apache 2.0) is the primary candidate because its tool loop supports per-tool approval gating, typed tool schemas, and streaming. The fallback is a thin loop over the runtime adapter.

Framework rule: policy checks, approval decisions, audit events, and rollback stay in Vault Desk code behind the tool registry contract. The framework only drives the propose-approve-execute-observe cycle; it must not own policy.

Audit shape: define a small, versioned Vault Desk schema for agent invocation, model calls, and tool execution, persisted to a local append-only audit log with content hashes so sessions are replayable. Audit records are customer-owned local product data, not telemetry; the application configures no exporter and transmits nothing unless the user explicitly exports a scoped record.

## Retrieval And Verification Principle

The harness should coordinate:

- Qwen3-Embedding-0.6B indexing (via node-llama-cpp GGUF embeddings or the Transformers.js ONNX path).
- Lexical indexing.
- An embedded hybrid index (LanceDB is the verified primary candidate: in-process for Node, hybrid lexical-plus-dense search, binary quantization), with TurboQuant-based acceleration only if benchmarks justify it. See [RETRIEVAL_AND_VERIFICATION.md](RETRIEVAL_AND_VERIFICATION.md).
- Evidence pack assembly.
- Claim parsing.
- Citation checks.
- Deterministic spreadsheet and arithmetic checks.
- Contradiction search.
- Human review queues.

The verifier must be a separate workflow stage. It must not rely on a single "please verify" model prompt as proof of correctness.

## Context Compaction Principle

The harness should treat model context as a temporary working set, not durable application memory.

The harness should persist:

- Session summary.
- Task ledger.
- Evidence ledger.
- Artifact ledger.
- Preference ledger.
- Warning ledger.
- Compaction events.

Compaction should be triggered before active context pressure causes quality loss. Compacted state must be structured, inspectable, auditable, and safe to replay. It must not preserve hidden model reasoning.

## Tool Registry Principle

Every tool should have:

- A name.
- A version.
- A typed input schema.
- A typed output schema.
- Required permissions.
- Preview behavior.
- Approval behavior.
- Resource limits.
- Audit behavior.
- Rollback behavior when applicable.

The model can request a tool. The harness decides whether it is valid, allowed, previewed, approved, executed, logged, or rejected.

## Testing Direction

Future tests should cover:

- Policy decisions.
- Path scope enforcement.
- Tool schema validation.
- Approval flow.
- Audit event creation.
- Document pipeline routing.
- Retrieval reproducibility.
- Summary tree invalidation.
- Claim verification.
- Compaction state preservation.
- Export correctness.
- Runtime adapter failure handling.
- Offline mode.
- Workspace migration and crash recovery.
- Cross-platform daemon lifecycle and protocol compatibility.
- MicroVM lifecycle, zero-network-device configuration, typed socket confinement, resource limits, and hostile-document handling.
- Native accelerator OS-sandbox and network-capability denial.
- Tauri capability denial, sidecar identity, local-protocol bootstrap, platform-webview behavior, and packaged lifecycle.
- Deterministic-operation routing and exact folder-wide spreadsheet search without model use.
- Generated-code isolation, typed inference mediation, resource exhaustion, result verification, and audit replay.

See [IMPLEMENTATION_QUALITY_BAR.md](IMPLEMENTATION_QUALITY_BAR.md) for the minimal-code and minimal-test policy.

## Completed M1 Constraint

M0 completed on 2026-07-17. The M1 daemon, CLI health path, workspace state, persistence, RPC, current-user local transports, common worker protocol, and platform microVM runtimes are implemented, and both platform microVMs are certified. M1 completed on 2026-07-18 after the Windows named pipe was bound to the current user and verified with a restricted-token denial gate. The 2026-07-19 follow-up authenticates the pipe owner and DACL from the client handle, canonicalizes endpoint identity, anchors audit tails across schema migration, bounds and cancels input staging, and ties the pipe helper to daemon lifetime.

M2 was activated by the repository owner on 2026-07-19 and completed across macOS and Windows on 2026-07-20. The owner activated M3 Offline Dev-Agent Desktop V1 on 2026-07-20, and its macOS stage is complete. Generated binaries, downloaded models, packaged sidecars, guest images, build output, coverage, and dependency directories remain uncommitted artifacts.

## Revision History

| Date | Change |
|---|---|
| 2026-07-10 | Initial future TypeScript/Node harness direction created. |
| 2026-07-10 | Added future harness responsibilities for folder manifests, document adapters, retrieval acceleration, summary trees, and claim verification. |
| 2026-07-10 | Added context compaction ownership and linked Local 12 and Local 16 profile validation to the future harness plan. |
| 2026-07-11 | Added verified component choices: node-llama-cpp primary runtime adapter with llama-server vision companion, grammar-enforced structured output principle, native-Node-first parser adapters with a single Python sidecar rule, LanceDB as primary embedded index candidate, and the agent-loop principle around Vercel AI SDK 6 with policy kept in Vault Desk code. |
| 2026-07-11 | Linked the No-Code Constraint to IMPLEMENTATION_PLAN.md, whose milestone M0 formally lifts it. |
| 2026-07-11 | Added the early daemon boundary, authoritative workspace-state model, supervised worker isolation, single first runtime, and explicit-workflow-first rule from ADRs 0010-0013. |
| 2026-07-12 | Made the no-NIC microVM the hostile-work boundary, retained a narrow host-native accelerator exception, and prohibited command matching as network isolation. |
| 2026-07-13 | Replaced Electron with a thin Tauri v2 shell and added deterministic document tools with a bounded no-NIC code-interpreter fallback. |
| 2026-07-20 | Made the generic offline dev agent the V1 execution path and moved deterministic document specialization after launch. |
| 2026-07-16 | Replaced the no-code constraint with an M0-only implementation constraint after the explicit owner phase-change request. |
| 2026-07-17 | Replaced the proposed OpenTelemetry-shaped audit contract with a small Vault Desk-owned local schema and prohibited telemetry exporters. |
| 2026-07-19 | Hardened completed M1 recovery, endpoint authentication, audit truncation detection, and worker staging limits after follow-up review. |
| 2026-07-22 | Aligned the inference adapter boundary with automatic hardware memory and context fitting. |
| 2026-07-23 | Added the session-scoped agent VM, live read-only folder share, installed guest shell tools, and durable workspace manifests. |
| 2026-08-15 | Recorded the implemented bounded llama-mtmd-cli image adapter and the exclusive unload-before-inspection memory rule. |
| 2026-08-12 | Recorded node-llama-cpp parallel context sequences on one loaded model as a verified runtime capability, used for bounded sub-agent parallelism in V1. |
