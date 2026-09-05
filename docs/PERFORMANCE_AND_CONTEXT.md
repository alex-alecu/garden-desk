# Performance And Context

Created: 2026-07-10

This document is the performance and context-management specification for the first Garden Desk implementation phase. It is planning material only and does not create implementation scaffolding.

Research claims in this document are research-derived until validated on target hardware.

## Decision

[ADR 0019](adr/0019-qwen38-private-server.md) defines the current Qwen3.8 Q4 target: 32,768 context tokens, one slot, all weights and active context state on one GPU, and a 16 GiB inference budget. Mac requires 24 GiB installed memory. Windows retains the 16 billion byte dedicated-GPU threshold; integrated GPUs need 16 GiB usable allocation and host memory for one microVM.

## Performance Thesis

Maximum performance for Garden Desk is not maximum tokens per second.

The V1 product benchmark is how quickly and reliably the user gets a useful, reviewable result from the offline agent over local files.

Primary performance levers, in order:

1. Keep host-native inference loaded while executable work stays in a separate no-network guest.
2. Bound agent turns, observations, code, logs, and artifacts so context and latency remain predictable.
3. Reuse safe prompt prefixes and session summaries without treating hidden reasoning as durable state.
4. Prefer the fixed offline guest libraries over large generated reimplementations.
5. Measure time to first useful observation and time to completed task, not tokens per second alone.
6. Then tune decode speed with runtime features such as KV-cache quantization, prompt caching, chunked prefill, and Multi-Token Prediction.

Post-V1 document intelligence adds parsing, retrieval, evidence-pack, citation, and cache metrics when those capabilities exist.

## Active Context And Memory

Generation uses a fixed 32K context. Core keeps its existing compaction policy. Image inspection uses an 8K context after generation unload. Embedding context and input limits stay unchanged.

Report load time, first-token delay, evaluated prompt rate, generation rate including reasoning, and peak memory separately. Count cached input in context usage. Omit unavailable allocation measurements. Do not add CPU and GPU views of shared physical pages. Full GPU layer offload alone does not prove that all weights are in physical VRAM.

The Windows target is at least 20 generated tokens per second near the context limit. Mac physical memory must remain within 16 GiB. Fixed profile changes or retries require owner approval.

## Runtime Optimization Policy

Runtime adapters may use different engines, but they must expose the same product behavior.

Required validation areas:

- GGUF QAT path for llama.cpp-compatible serving.
- MLX conversion path for Apple Silicon if Gemma 4 QAT support is stable.
- Ollama-compatible path only when model format and context behavior are explicit, telemetry is absent or provably disabled, and no telemetry network path exists.
- vLLM-class serving only for later appliance or server profiles, not as a desktop assumption.

Optimization candidates:

- Quantized weights: required for every supported desktop tier. Ship official pre-converted QAT Q4_0 GGUFs only; self-conversion destroys the QAT quality benefit.
- KV-cache quantization: preferred if accuracy and citation precision are unchanged.
- Prompt or prefix caching: preferred for repeated folder questions and stable system/workflow prompts.
- Chunked prefill: preferred if it improves long evidence-pack latency without changing outputs.
- Multi-Token Prediction: allowed only if the matching drafter model (roughly 2 GB additional memory, verified 2026-07-11) fits the same profile without reducing the certified context target. Draft-and-verify output is identical to baseline decoding, so the certification risk is memory and stability, not answer quality.
- CPU or RAM offload: allowed only as a compatibility fallback, not as a certified performance path.

Every optimization must be benchmarked against the same workflow suite before being enabled by default.

Interaction warning: KV-cache quantization and MTP have already interacted badly in llama.cpp (q8_0 KV quantization initially broke MTP acceptance; later fixed). Certify QAT weights, KV-cache quantization, and MTP as a pinned combination per runtime build, never independently.

## Evidence Pack Budget

The prompt builder must assemble a bounded evidence pack.

Baseline evidence-pack shape:

- System and workflow instructions.
- Current user request.
- Output schema.
- Active task state.
- Retrieved chunks with citation IDs.
- Relevant summary nodes.
- Exact lexical matches for identifiers, dates, amounts, and names.
- Known parser warnings and contradictions.
- Verification instructions.

Larger memory budgets may include more evidence tokens per pack, but candidate retrieval, ranking criteria, verification strictness, and workflow behavior must remain the same.

## Context Is Not Memory

The live model context is a temporary working set. Durable product state lives outside the prompt.

The control plane must preserve:

- Session manifest.
- User-visible conversation history.
- Current task state.
- Selected files and folder manifest.
- Evidence pack IDs.
- Source anchors.
- Tool proposals and results.
- Approvals, rejections, and exports.
- Verification outcomes.
- Warnings and unresolved issues.

The model should never be the only holder of important state.

## Compaction Model

M3 uses one model-written anchored summary when the live context reaches its limit. It does not implement structured compaction records.

The following records are post-V1 research ideas. They are not active M3 requirements:

- Session summary: user goal, decisions made, constraints, and current status.
- Task ledger: active workflow, pending steps, completed steps, blockers, approvals, and next action.
- Evidence ledger: cited chunks, source anchors, conflicting evidence, and verification outcomes.
- Artifact ledger: draft outputs, exports, diffs, and generated reports.
- Preference ledger: explicit user preferences stated in the current session.
- Warning ledger: low-confidence extraction, missing files, parser disagreements, unsupported claims, and unresolved risks.

Do not carry forward hidden chain-of-thought or model-private reasoning. Only store inspectable task state, final responses, cited evidence, and tool results.

## Compaction Triggers

M3 uses the worker's reported allocation and used context. Used context is the total token position in the active model sequence. The performance prompt-token count measures only input tokens evaluated for the latest request, so cache reuse can make that value decrease while used context grows.

- At 80 percent used context, add one no-tool summarization turn.
- Replace the older conversation head with the anchored summary.
- Keep the current user request and the last two assistant/tool turns verbatim.
- Keep durable messages, executions, traces, artifacts, approvals, and audit records outside compaction.

A manual compact command is not part of the active M3 desktop contract. If added later, it must use the same ledgers and must not discard citations, pending work, or approvals.

### Current M3 Session Summary

The session-summary queue starts only after a completed run reports a measured chat allocation. It requires at least 16,384 tokens. It does not use a model-status, profile, or estimated-allocation fallback.

The queue keeps one ordered non-fatal sequence per session. Each summary attempt has a new request identity and a new trace. Core retries once only for an approved worker failure. A summary failure records its outcome but does not fail its completed run. Core cancels pending queue work during shutdown.

Golden-task results are separate from platform certification and do not make an unrun platform gate pass.

## Post-V1 Long-Running Session Research

The following scenario is not an active M3 gate:

Before implementation can claim reliable compaction, the product must pass this scenario on every supported memory tier:

1. Ingest a mixed folder containing PDFs, DOCX files, XLSX workbooks, CSVs, emails, images, duplicates, and low-confidence scans.
2. Run document QA, extraction, comparison, and export tasks for at least 30 minutes.
3. Force at least three compaction events.
4. Ask follow-up questions that depend on pre-compaction decisions, citations, and tool results.
5. Verify that answers cite the same source anchors or clearly report when evidence changed.
6. Verify that unsupported-claim and calculation checks still run.
7. Verify that pending approvals and warnings are not lost.

The research target is that the user can continue productive work after context turnover without reloading the folder or restating decisions.

## Document Pipeline Performance Rules

The document engine should be optimized before the model prompt grows.

Required rules:

- Inventory, hashing, and MIME detection must run before parser selection.
- Use the narrowest parser capable of the file type.
- Avoid OCR unless native extraction is missing, low-confidence, or contradicted.
- Use page-region multimodal inspection only for unresolved regions.
- Stream or shard huge documents by page, section, sheet, row window, table region, or attachment group.
- Cache parser outputs by file hash, parser version, and options.
- Cache embeddings by chunk hash, encoder version, and dimension.
- Cache summaries by source hash, prompt version, model profile, and evidence IDs.
- Make every long job resumable from the manifest.

The first implementation should not include a custom parser, OCR engine, vector database, or model runtime when a maintained local tool can satisfy the adapter contract.

## Benchmark Gates

Each certified profile must publish an internal benchmark record before being called supported:

- Cold start time.
- Warm start time.
- First-token latency.
- Tokens per second.
- Prefill latency for 8K, 16K, 32K, 64K, and any higher certified contexts.
- Peak VRAM and RAM at each context length.
- Time to ingest benchmark folder.
- Time to answer first cited question after ingestion.
- Retrieval recall on exact identifiers, dates, amounts, names, and clauses.
- Citation precision.
- Unsupported-claim rate.
- Spreadsheet calculation accuracy.
- Compaction loss rate.
- Crash recovery time.
- Export correctness.

Tokens per second is a runtime metric. It is not a product acceptance criterion by itself.

V1 certification sequencing is strict: real multi-step agent tasks, bounded model mediation, microVM resource enforcement, session recovery, cancellation, and the packaged zero-download desktop build must pass on the physical macOS tiers and representative Windows GPUs before those configurations are called certified. Post-V1 OCR, retrieval, or citation measurements extend certification only when those capabilities are implemented.

## Red Lines

Do not:

- Use raw context stuffing as the document engine.
- Treat a 256K context claim as a substitute for retrieval and verification.
- Make lower-memory systems use a smaller or lower-quality reasoning model.
- Disable claim verification or citations to fit memory.
- Let parser workers compete with generation for VRAM by default.
- Add speculative runtimes, rerankers, or vector systems before the baseline pipeline is measured.
- Store only a prose summary when compacting state.
- Add cloud fallback without an explicit user opt-in and audit record.

## Research Links

- [Gemma 4 model overview](https://ai.google.dev/gemma/docs/core)
- [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4)
- [Gemma 4 Multi-Token Prediction](https://ai.google.dev/gemma/docs/mtp/overview)
- [Qwen3-Embedding blog](https://qwenlm.github.io/blog/qwen3-embedding/)
- [PagedAttention paper](https://arxiv.org/abs/2309.06180)
- [StreamingLLM paper](https://arxiv.org/abs/2309.17453)
- [Lost in the Middle paper](https://arxiv.org/abs/2307.03172)
- [RULER benchmark paper](https://arxiv.org/abs/2404.06654)
