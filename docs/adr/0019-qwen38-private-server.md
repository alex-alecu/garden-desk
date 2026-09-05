# ADR 0019: Qwen3.8 and a private inference server

Status: owner-approved migration. Physical Mac verification is pending. This decision replaces the model, runtime, and memory profiles in ADRs 0009, 0013, and 0016. It amends the native inference transport in ADR 0012. Their other contracts stay in effect.

Use Qwen3.8-27B `UD-IQ4_XS` and its F16 image projector on both platforms. Keep the Qwen3 embedding encoder. The managed catalog pins each file, revision, size, and hash. Use the verified `llama.cpp b10816` server for all inference.

Use a private Unix socket. Windows uses the existing no-capability AppContainer and one-process job, with an opaque native pipe relay. Mac permits only the exact socket in its native sandbox. TypeScript owns HTTP, arguments, limits, and parsing. Core retains model resolution, scheduling, tool authority, cancellation, and stored message formats.

Use one slot, 32,768 context tokens, all weights and context state on one GPU, Flash Attention, and no automatic fitting or context shifting. Use a 512-token batch and 256-token microbatch. Windows uses Q4/Q4 context cache; Mac uses Q8/F16. Limit checkpoints to two and disable the saved RAM prompt cache. Keep the model's default reasoning effort and the existing per-request reasoning budget.

Image inspection unloads generation first. It uses an 8K context, at most 2,048 image tokens and 2,048 output tokens, with thinking disabled. Core supplies inline image bytes. Embeddings use last-token pooling and normalized vectors; their batch and microbatch cover the accepted input context.

Keep reasoning only in memory during one user task. Clear it at completion, cancellation, and compaction. Keep task time fixed across tool turns. Never store reasoning or raw server logs in traces or exports. Report total input usage for context and evaluated input tokens for performance. Omit unavailable allocation measurements.

Keep `auto` and `local16`. Mac requires 24 GiB installed memory: 16 GiB for inference, 4 GiB for one microVM, and 4 GiB for the host. Windows retains the 16 billion byte dedicated-GPU threshold, CUDA preference on the same device, Vulkan, and device identity checks. An integrated GPU requires 24 GiB installed memory and 16 GiB usable runtime allocation. Reserve 16 GiB of host memory for inference and 4 GiB for the host before admitting 4 GiB microVMs.

These settings are certification targets. Keep the migration PR in draft until bounded Windows and Mac checks pass. Do not change Q4, reduce context, or add automatic retries to make a check pass.
