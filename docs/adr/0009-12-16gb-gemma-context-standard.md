# ADR 0009: Local 12 And Local 16 Gemma Context Standard

Date: 2026-07-10

## Status

The current model, runtime, and memory profile is defined in [ADR 0019](0019-qwen38-private-server.md). This document preserves the prior decision and its remaining contracts.

Accepted; amended 2026-08-17

## Context

The original plan defined manually selected Local 12 and Local 16 certification profiles. M3 initially implemented only an 8K context and the desktop always selected Local 12, leaving usable memory idle on larger systems.

The repository owner directed M3 to derive the inference envelope from hardware without exposing a configuration maze. Supported Macs receive fixed total model-plus-context budgets. Windows uses one isolated dedicated GPU when possible and one integrated GPU otherwise. GPU brand and measured speed do not decide support.

Official Gemma 4 documentation lists the 12B Q4_0 load estimate at 6.7 GB before KV cache and runtime overhead. The same documentation describes long-context capability, but the practical product constraint is stable active context under full workflow load.

## Decision

Garden Desk uses one Gemma 4 12B QAT model and selects the largest active context that fits a hardware-derived model-plus-context memory budget. The product does not expose profiles or token counts as user configuration.

All supported hardware tiers use:

- Gemma 4 12B QAT as the main generation and reasoning model.
- Qwen3-Embedding-0.6B as the default dense retrieval encoder.
- The same parser routing strategy.
- The same hybrid retrieval strategy.
- The same citation and claim-verification policy.
- The same approval and audit policy.
- The same compaction architecture.
- The same workflow eligibility.

The automatic macOS policy is:

| Physical memory | Model-plus-context budget | Context cap | Product behavior |
|---:|---:|---:|---|
| 8 GB | None | None | Do not start inference; explain that the Mac is unsupported |
| More than 8 GB through 16 GB | 10 GiB | 64K | Fit the largest stable context inside the budget and cap |
| More than 16 GB through 24 GB | 12 GiB | 64K | Fit the largest stable context inside the budget and cap |
| More than 24 GB through 32 GB | 16 GiB | 64K | Preserve unified memory for the host and agent guests |
| More than 32 GB | 16 GiB | 128K | Fit the largest stable context inside the budget and cap |

The automatic Windows policy is:

| Selected memory | Hardware rule | Maximum model-plus-context budget | Context cap |
|---|---|---:|---:|
| Dedicated | At least 8 GiB isolated device memory | Complete isolated device memory | 64K through 24 GiB; 128K above 24 GiB |
| Integrated | Less than 16 GiB installed RAM | Unsupported | None |
| Integrated | Exactly 16 GiB installed RAM | 8 GiB | 64K |
| Integrated | More than 16 GiB through 24 GiB installed RAM | 12 GiB | 64K |
| Integrated | More than 24 GiB through 32 GiB installed RAM | 16 GiB | 64K |
| Integrated | More than 32 GiB installed RAM | 16 GiB | 128K |

The worker selects one usable dedicated adapter before an integrated adapter. It selects the largest usable memory in that type and uses CUDA before Vulkan for the same adapter. Installed RAM sets the maximum integrated tier. The isolated runtime capacity selects the highest 8, 12, or 16 GiB tier that does not exceed that maximum or the detected capacity. An integrated capacity below 8 GiB is unsupported. Missing, changed, or ambiguous identity and multi-device visibility are unsupported. The worker does not add memory across devices.

Automatic generation context starts from the existing 8K floor and may grow through the applicable 64K or 128K product cap, not the model's 256K trained maximum. macOS and Windows integrated profiles use combined CPU and GPU estimates, post-creation checks, and sequence-count fitting. They reserve the complete inference budget from host RAM. Windows dedicated profiles fit device memory and keep the small host reservation. The terminal response records the actual context, budget, memory kind, backend, and one selected device. These results still require exact physical and packaged evidence before a configuration is Certified.

## Consequences

Positive:

- Keeps the first implementation focused.
- Makes product behavior follow available hardware without user tuning.
- Uses memory that was previously left idle by the fixed 8K implementation.
- Avoids premature 26B, 31B, and 64 GB appliance branching.
- Forces retrieval, verification, and compaction to solve document work instead of relying on larger context.

Negative:

- Larger automatic contexts increase allocation time and memory pressure.
- 64 GB appliance positioning remains less detailed until after MVP validation.
- Larger Gemma models may provide quality gains that are intentionally deferred.

## Non-Decisions

This ADR does not decide:

- Exact runtime adapter to certify first.
- Exact GGUF, MLX, or other model packaging format.
- Whether later appliance products use Gemma 4 26B A4B, Gemma 4 31B, or another Gemma-family profile.
- Whether Multi-Token Prediction is enabled by default.
- Whether KV-cache quantization is enabled by default.

## Required Follow-Up

- Benchmark every automatic macOS and Windows memory tier.
- Validate the automatically selected active context with the complete product workload.
- Validate context compaction through long-running folder workflows.
- Keep future profile docs aligned with this ADR unless a later ADR supersedes it.

## Parallel Sequences

The runtime may allocate additional parallel context sequences on the single loaded model for
concurrent turns such as sub-agents. Extra sequences never reduce the primary sequence's certified
context: sequence 0 always receives the full context this ADR selects, and additional sequences are
added only when their per-sequence KV cache fits within the memory budget alongside it. On hardware
where that headroom is zero, the runtime degrades to a single sequence and the certified context is
unchanged.

## References

- [MODEL_STRATEGY.md](../MODEL_STRATEGY.md)
- [PERFORMANCE_AND_CONTEXT.md](../PERFORMANCE_AND_CONTEXT.md)
- [research/edge-ai-2026.md](../research/edge-ai-2026.md)
