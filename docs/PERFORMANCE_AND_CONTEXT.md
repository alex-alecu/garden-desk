# Performance And Context

Created: 2026-07-10

This document is the performance and context-management specification for the first Vault Desk implementation phase. It is planning material only and does not create implementation scaffolding.

Research claims in this document are research-derived until validated on target hardware.

## Decision

The implemented product policy is:

| Hardware | Model-plus-context budget | Context cap | Main model | Required behavior |
|---|---:|---:|---|---|
| 8 GB Mac | None | None | None | Do not start inference and explain the hardware requirement |
| More than 8 GB through 16 GB Mac | 10 GiB | 64K | Gemma 4 12B QAT | Automatically fit the largest context inside the budget and cap |
| More than 16 GB through 24 GB Mac | 12 GiB | 64K | Gemma 4 12B QAT | Automatically fit the largest context inside the budget and cap |
| More than 24 GB through 32 GB Mac | 16 GiB | 64K | Gemma 4 12B QAT | Preserve shared memory for the host and agent guests |
| More than 32 GB Mac | 16 GiB | 128K | Gemma 4 12B QAT | Automatically fit the largest context inside the budget and cap |
| Windows through 24 GB dedicated GPU VRAM | One device's dedicated GPU VRAM | 64K | Gemma 4 12B QAT | Reject aggregate, unified, or shared memory readings |
| Windows above 24 GB dedicated GPU VRAM | One device's dedicated GPU VRAM | 128K | Gemma 4 12B QAT | Reject aggregate, unified, or shared memory readings |

Hardware tiers differ only in the memory available to model weights, runtime overhead, and active context. Do not create a lower-quality product by changing the model, weakening verification, skipping citations, disabling compaction, or reducing supported workflows.

## Why This Changes The Previous Plan

The earlier architecture treated 16 GB and 64 GB as the main validation pair. That is too broad for the first product and encourages speculative larger-model work before the document engine has proven itself.

The revised strategy is narrower:

- Prove Gemma 4 12B QAT under every automatic macOS budget and representative Windows GPU VRAM sizes.
- Keep model behavior identical across those profiles.
- Use retrieval, summaries, citation verification, and compaction to handle large folders.
- Treat 64 GB, 26B A4B, and 31B dense as later appliance research, not MVP architecture.

This makes the product easier to certify, easier to explain, and harder to accidentally overbuild.

## Performance Thesis

Maximum performance for Vault Desk is not maximum tokens per second.

The V1 product benchmark is how quickly and reliably the user gets a useful, reviewable result from the offline agent over local files.

Primary performance levers, in order:

1. Keep host-native inference loaded while executable work stays in a separate no-NIC guest.
2. Bound agent turns, observations, code, logs, and artifacts so context and latency remain predictable.
3. Reuse safe prompt prefixes and session summaries without treating hidden reasoning as durable state.
4. Prefer the fixed offline guest libraries over large generated reimplementations.
5. Measure time to first useful observation and time to completed task, not tokens per second alone.
6. Then tune decode speed with runtime features such as KV-cache quantization, prompt caching, chunked prefill, and Multi-Token Prediction.

Post-V1 document intelligence adds parsing, retrieval, evidence-pack, citation, and cache metrics when those capabilities exist.

## Active Context Targets

The advertised Gemma 4 12B context window is a trained capability, not the product ceiling.

The runtime now fits context automatically after applying the hardware budget:

| Minimum | Maximum | Rule |
|---:|---:|---|
| 8K active tokens | 64K active tokens | Macs through 32 GB unified memory and Windows GPUs through 24 GB dedicated VRAM |
| 8K active tokens | 128K active tokens | Macs above 32 GB unified memory and Windows GPUs above 24 GB dedicated VRAM |

On macOS, the worker searches the pinned runtime's CPU and GPU context estimates for the largest aligned context whose combined model-plus-context allocation fits both the tier budget and hardware context cap, then checks the measured allocation after creation. An over-budget allocation is rejected. The selected 10/12/16 GiB value is a ceiling, so the desktop reports budget, measured CPU RAM and GPU or unified-memory allocation, and their total separately. The Mac requires more than 32 GB unified memory for 128K because its model, context, operating system, desktop, and agent guests share one memory pool. On Windows, the runtime fits context against a generation cap equal to one selected non-unified device's separately reported dedicated VRAM; 128K requires more than 24 GB dedicated VRAM. Multi-device aggregates and readings that include unified or shared system memory are unsupported. The terminal inference response records the measured allocations, actual allocated context, hardware cap, and the threshold rule that selected it. Automatic selection is implemented behavior, not by itself a public stability claim; each hardware tier still needs the full workload suite. Long context without evidence selection is not a document strategy.

## Memory Budget Rules

Official Gemma 4 documentation lists the 12B Q4_0 load estimate at 6.7 GB before context and runtime overhead. Vault Desk applies the macOS 10/12/16 GiB total budgets or one selected Windows device's complete dedicated VRAM capacity, then lets the pinned runtime use the remainder for:

- KV cache for prompt and generated tokens.
- Runtime allocator overhead and graph buffers.
- Multimodal tokenization and visual inputs when used.
- Prompt or prefix cache when supported.
- GPU-side embedding or reranking work only if it does not steal the generation budget.

Certification must record:

- Static model load.
- Peak prefill VRAM.
- Peak decode VRAM.
- Peak VRAM after a 30-minute session.
- Peak VRAM during multimodal page-region inspection.
- Peak VRAM during recovery after cancellation or failure.
- CPU RAM pressure from parser, OCR, indexing, and cache workers.

If a runtime requires lowering active context to remain stable, lower context first. Do not switch models, weaken verification, or silently fall back to cloud processing.

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

Vault Desk must support long-running sessions that continue for many minutes after the first live context fills.

Compaction should produce structured state, not a vague chat summary.

Required compacted records:

- Session summary: user goal, decisions made, constraints, and current status.
- Task ledger: active workflow, pending steps, completed steps, blockers, approvals, and next action.
- Evidence ledger: cited chunks, source anchors, conflicting evidence, and verification outcomes.
- Artifact ledger: draft outputs, exports, diffs, and generated reports.
- Preference ledger: explicit user preferences stated in the current session.
- Warning ledger: low-confidence extraction, missing files, parser disagreements, unsupported claims, and unresolved risks.

Do not carry forward hidden chain-of-thought or model-private reasoning. Only store inspectable task state, final responses, cited evidence, and tool results.

## Compaction Triggers

The context manager should compact proactively:

- At 70 percent of the certified active context, refresh the structured task state.
- At 85 percent, compact before adding new large evidence.
- At 95 percent, compact before the next model turn unless the current turn is already ending.
- After any long tool run, update the task and evidence ledgers before asking the model to continue.
- After every export or approval, freeze the relevant ledger entries for audit.

Manual user compact should be supported as a normal command. Manual compact must not discard citations, pending work, or approvals.

## Long-Running Session Acceptance Test

Before implementation can claim reliable compaction, the product must pass this scenario on every supported memory tier:

1. Ingest a mixed folder containing PDFs, DOCX files, XLSX workbooks, CSVs, emails, images, duplicates, and low-confidence scans.
2. Run document QA, extraction, comparison, and export tasks for at least 30 minutes.
3. Force at least three compaction events.
4. Ask follow-up questions that depend on pre-compaction decisions, citations, and tool results.
5. Verify that answers cite the same source anchors or clearly report when evidence changed.
6. Verify that unsupported-claim and calculation checks still run.
7. Verify that pending approvals and warnings are not lost.

Passing means the user can continue productive work after context turnover without reloading the folder or restating decisions.

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

## Revision History

| Date | Change |
|---|---|
| 2026-07-10 | Added 12 GB and 16 GB Gemma 4 12B QAT performance, context, compaction, and benchmark specification. |
| 2026-07-11 | Added official-GGUF packaging rule, verified MTP drafter memory cost, and joint QAT/KV-quant/MTP certification warning. |
| 2026-07-11 | Made product workflow, compaction, recovery, and packaged offline operation explicit prerequisites for Local 12 and Local 16 certification. |
| 2026-07-22 | Replaced the fixed 8K product context with hardware-derived macOS budgets, complete detected Windows GPU VRAM use, and automatic context fitting up to 256K. |
| 2026-08-01 | Replaced the 256K product ceiling with 64K and 128K caps derived from Mac unified memory or Windows GPU VRAM and exposed the measured allocations, selected cap, and threshold reason in Technical details. |
| 2026-08-04 | Restricted Windows automatic budgets and context tiers to one device's dedicated VRAM. |
