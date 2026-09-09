# ADR 0019: Qwen3.8 and a private inference server

Status: owner-approved migration. Bounded Windows and Mac checks passed; see [current status](../M3_STATUS.md). This decision replaces the model, runtime, and memory profiles in ADRs 0009, 0013, and 0016. It amends the native inference transport in ADR 0012. Their other contracts stay in effect.

Use Qwen3.8-27B `UD-IQ4_XS` and its F16 image projector on both platforms. Keep the Qwen3 embedding encoder. The managed catalog pins each file, revision, size, and hash. Use the verified `llama.cpp b10816` server for all inference.

Use a private Unix socket. Windows uses the existing no-capability AppContainer and one-process job, with an opaque native pipe relay. Mac permits only the exact socket in its native sandbox. TypeScript owns HTTP, arguments, limits, and parsing. Core retains model resolution, scheduling, tool authority, cancellation, and stored message formats.

Use one slot. Keep all weights and context state on one GPU. Use Flash Attention and disable context shifting.

Text generation on a Windows dedicated GPU uses the former Gemma automatic context rule. At each model load, fit the largest context to the device's current free memory. Use the complete isolated device memory as the budget and leave a 512 MiB margin. Start at 8K, or a smaller requested size. Cap context at 64K through 24 GiB dedicated memory and 128K above it. Keep the selected context until unload. Preserve the original position encoding and report the actual context to Core and the desktop. Stop if fitting fails. Never move weights to CPU to fit.

Mac and Windows integrated GPUs also fit text context at each model load, up to 64K. Limit model and context memory to the shared memory budget below and the driver's available GPU allocation. On Mac, also limit it to current free RAM because Metal reports its recommended allocation limit. Read GPU memory with the isolated runtime before loading the model. Adjust the fitting margin to leave 512 MiB within that limit. Report the actual context and stop if fitting fails. Keep all model layers on the GPU.

Use a 512-token batch and 256-token microbatch. Windows uses Q4/Q4 context cache; Mac uses Q8/Q8, as Metal Flash Attention requires matching cache types. Limit checkpoints to two and disable the saved RAM prompt cache. Keep the model's default reasoning effort and the existing per-request reasoning budget.

Keep multi-token prediction (MTP) disabled to leave memory available for context.

Image inspection unloads generation first. It uses an 8K context, at most 2,048 image tokens and 2,048 output tokens, with thinking disabled. Core supplies inline image bytes. Embeddings use last-token pooling and normalized vectors; their batch and microbatch cover the accepted input context.

Keep reasoning only in memory during one user task. Clear it at completion, cancellation, and compaction. Keep task time fixed across tool turns. Never store reasoning or raw server logs in traces or exports. Report total input usage for context and evaluated input tokens for performance. Read numeric CPU and GPU buffer allocations from the server's memory reports. Omit unavailable allocation measurements.

Keep `auto` and `local16`. Mac and Windows integrated GPUs require at least 24 GiB installed memory; reject 16 GiB systems. Use a model and context budget of up to 16 GiB below 36 GiB installed memory, including 24 and 32 GiB systems. Use up to 24 GiB on systems with 36 GiB or more. An integrated GPU still requires 16 GiB usable runtime allocation; reduce its budget if the runtime permits less than the RAM tier. Reserve the selected budget from shared RAM, then a further 4 GiB for the host before admitting 4 GiB microVMs. Windows retains the 16 billion byte dedicated-GPU threshold, CUDA preference on the same device, Vulkan, and device identity checks. On Windows with a dedicated GPU, retain the separate 20 GiB process memory limit and host reservation.

The app returns an unsupported outcome if the remaining memory cannot hold one microVM. A Windows host with a dedicated GPU thus requires at least 28 GiB installed memory.

These settings are certification targets. Keep the migration PR in draft until bounded Windows and Mac checks pass. Do not change Q4 or add automatic retries to make a check pass.
