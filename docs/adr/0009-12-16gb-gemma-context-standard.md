# ADR 0009: Local 12 And Local 16 Gemma Context Standard

Date: 2026-07-10

## Status

Accepted; amended 2026-08-01

## Context

The original plan defined manually selected Local 12 and Local 16 certification profiles. M3 initially implemented only an 8K context and the desktop always selected Local 12, leaving usable memory idle on larger systems.

The repository owner directed M3 to derive the inference envelope from hardware without exposing a configuration maze: supported Macs receive fixed total model-plus-context budgets, Windows generation may use the selected device's dedicated GPU VRAM, and 8 GB Macs must not start inference.

Official Gemma 4 documentation lists the 12B Q4_0 load estimate at 6.7 GB before KV cache and runtime overhead. The same documentation describes long-context capability, but the practical product constraint is stable active context under full workflow load.

## Decision

Vault Desk uses one Gemma 4 12B QAT model and selects the largest active context that fits a hardware-derived model-plus-context memory budget. The product does not expose profiles or token counts as user configuration.

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

On Windows, generation uses the complete dedicated VRAM capacity reported for one selected non-unified runtime device. Multi-device aggregates and readings that include unified or shared system memory are unsupported rather than treated as a larger budget. A supported GPU with a positive finite dedicated capacity is required; there is no smaller product-selected VRAM budget. Windows GPUs through 24 GB dedicated VRAM receive a 64K context cap and GPUs above 24 GB receive 128K. The terminal response reports detected dedicated VRAM independently so the physical canary can require exact equality with the applied budget.

Automatic generation context starts from the existing 8K floor and may grow through the applicable 64K or 128K product cap, not the model's 256K trained maximum. On macOS, Vault Desk searches the pinned runtime's CPU and GPU estimates for the largest aligned context whose combined model-plus-context allocation fits, then rejects a created context if its measured total exceeds the tier budget. A Mac requires more than 32 GB unified memory for 128K because inference shares memory with the operating system, desktop, and agent guests. On Windows, the pinned runtime chooses the largest allocation within the full-VRAM budget and applicable context cap; discrete GPU VRAM above 24 GB unlocks 128K without consuming the host RAM pool. The terminal inference response records the actual allocated context and memory budget. These results still require physical-platform stability evidence before public support claims.

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

- Benchmark every automatic macOS tier and representative Windows GPU VRAM sizes.
- Validate the automatically selected active context with the complete product workload.
- Validate context compaction through long-running folder workflows.
- Keep future profile docs aligned with this ADR unless a later ADR supersedes it.

## References

- [MODEL_STRATEGY.md](../MODEL_STRATEGY.md)
- [PERFORMANCE_AND_CONTEXT.md](../PERFORMANCE_AND_CONTEXT.md)
- [research/edge-ai-2026.md](../research/edge-ai-2026.md)

## Revision History

| Date | Change |
|---|---|
| 2026-07-10 | Accepted Local 12 and Local 16 as first Gemma 4 12B QAT certification profiles. |
| 2026-07-22 | Replaced the fixed 8K implementation and manually selected product profile with automatic macOS memory tiers, full Windows GPU VRAM use, and runtime-fitted context up to 256K. |
| 2026-08-01 | Replaced the 256K ceiling with 64K and 128K caps using a higher threshold for shared Mac memory than discrete Windows VRAM. |
| 2026-08-04 | Required one Windows device's dedicated VRAM and rejected multi-device aggregates or unified and shared memory readings. |
