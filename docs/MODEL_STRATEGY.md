# Model Strategy

The current desktop target is Qwen3.8 27B Q4 with its F16 image projector and the existing Qwen3 embedding encoder. [ADR 0019](adr/0019-qwen38-private-server.md) defines the fixed profile and private server transport. Physical Mac verification is pending.

The managed [catalog](../assets/models.json) pins each immutable revision, file size, and SHA-256 hash. The [runtime manifest](../assets/inference-runtime.json) pins the CUDA, Vulkan, and Metal archives and their dependencies. A changed hash fails installation.

Text uses a 32K context and one slot. Image inspection uses an 8K context after generation unload. The same server provides structured output and embeddings. The scheduler, Core authority, no-network microVM, and stored conversation formats remain in place. Reasoning stays transient.

Larger profiles and document-intelligence work remain research.

## Deferred Larger Profiles

Larger workstation and appliance profiles are deferred until the automatic desktop tiers are stable.

Later validation may revisit:

- Gemma 4 12B QAT with larger context and concurrency on 64 GB systems.
- Gemma 4 31B dense for higher-quality synthesis.
- Gemma 4 26B A4B for throughput and concurrent office use.

Those profiles should not change the first implementation architecture.

## Encoder

Qwen3-Embedding-0.6B is the product-managed dense encoder, per [ADR 0016](adr/0016-model-agnostic-defaults-and-managed-downloads.md): Apache 2.0, official GGUF, strong multilingual retrieval (100+ languages), 32K input context, and served by the same pinned llama.cpp server as generation. It is bundled in every build flavor and never user-selected. EmbeddingGemma remains a validated alternative with a Gemma Terms of Use distribution burden.

Recommended retrieval shape:

- Store canonical text chunks with stable source anchors.
- Embed title, heading, page, table, row, and paragraph-aware chunks.
- Use Qwen3-Embedding-0.6B dense vectors.
- Start with 768-dimensional embeddings for quality (the encoder supports 32 to 1024 output dimensions).
- Evaluate dimension reductions from 768 toward 128 only after recall tests on Garden Desk corpora.
- Size chunks by retrieval quality tests, not by the encoder's 32K input maximum; structure-aware chunks in the sub-2K range remain the starting point.
- Pair dense retrieval with lexical BM25 search.
- Use metadata filters for workspace, file type, date, page, sheet, table, and permission scope.
- Use vector compression only as an acceleration layer, not as the sole evidence store.

Qwen3-Embedding retrieval quality on Garden Desk corpora is research-derived until the post-V1 document-intelligence gate measures it.

See [RETRIEVAL_AND_VERIFICATION.md](RETRIEVAL_AND_VERIFICATION.md).

## DiffusionGemma Role

DiffusionGemma is relevant because diffusion language models can generate text by iterative denoising rather than left-to-right token prediction and may improve latency for some generation workloads.

For Garden Desk, it should be treated as:

- An experimental fast-draft model.
- A possible local autocomplete or first-pass summarization model.
- Not the first model for audited extraction, legal summaries, accounting reconciliation, or final cited answers.

DiffusionGemma remains outside the active desktop scope.

## Multi-Token Prediction Role

Gemma 4 Multi-Token Prediction is a first-party feature: each Gemma 4 size ships a paired lightweight drafter model, and draft-and-verify decoding produces output identical to standard decoding. Runtime support was verified on 2026-07-11: llama.cpp merged Gemma 4 MTP on 2026-06-07 (roughly 1.4x to 2.2x decode speedup for dense models), vLLM supports all variants, and Ollama supports it on the MLX backend.

For Garden Desk, MTP should be treated as:

- An optional decode-speed optimization.
- Not required for correctness (draft-and-verify output is provably identical, so the risk is memory and stability, not answer quality).
- A roughly 2 GB additional memory cost for the drafter, which competes directly with the automatically fitted active context.
- Not allowed to reduce the certified active context target.
- Not allowed to change citation, extraction, or verification behavior.
- Validated jointly with KV-cache quantization per pinned runtime build, because q8_0 KV-cache quantization initially broke MTP acceptance in llama.cpp.
- Disabled by default until it passes the same workflow benchmark suite as baseline decoding.


## Runtime Policy

Use runtime adapters:

- The pinned llama.cpp server is the current desktop runtime. It uses the private transport and fixed Qwen3.8 Q4 profile from ADR 0019.
- Ollama-compatible serving only when model packaging and context behavior are explicit, telemetry is absent or provably disabled, and no telemetry network path exists. Ollama's MLX backend currently has the most mature Gemma 4 MTP support on Apple Silicon.
- MLX-family serving is a later Apple Silicon optimization candidate and must pass the same packaged workflow, citation, verification, compaction, and offline suite before certification.
- Google LiteRT-LM as an emerging Google-first alternative to track: it ships an OpenAI-compatible local server and a JS/WASM API, added Gemma 4 12B support, and is Google's own optimized MTP test surface. MediaPipe LLM Inference is maintenance-only; do not build on it.
- [PrismML Bonsai](https://prismml.com/news/bonsai-8b) as a research-derived post-V1 candidate to track: its low-bit model formats may suit the supported desktop budgets, but evaluation waits until the formats and required upstream runtime backends are stable in pinned releases. It must pass the same licensing, redistribution, offline packaging, cross-platform, memory, context, structured-output, agent-task, and security gates before certification; it does not change the current default.
- vLLM-class serving for later office appliances and high-throughput profiles after Gemma 4 QAT support is verified.
- Avoid runtime-specific features in core workflow logic.
- Pin runtime builds. QAT, KV-cache quantization, and MTP interact per build and must be certified together.

## Evaluation Gates

Each certified profile needs:

- First-token latency.
- Tokens per second.
- Peak VRAM and RAM.
- Context-length stability.
- Compaction stability over long sessions.
- Multimodal page inspection quality.
- Extraction accuracy.
- Citation precision.
- Unsupported-claim rate.
- Tool-call schema validity.
- Summary coverage.
- Folder-level report quality.
- Soak tests over repeated large-folder runs.

## Research Links

- [Gemma releases log](https://ai.google.dev/gemma/docs/releases)
- [Gemma core docs](https://ai.google.dev/gemma/docs/core)
- [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4)
- [Gemma 4 QAT announcement](https://blog.google/innovation-and-ai/technology/developers-tools/quantization-aware-training-gemma-4/)
- [Gemma 4 Multi-Token Prediction](https://ai.google.dev/gemma/docs/mtp/overview)
- [llama.cpp Gemma 4 MTP PR](https://github.com/ggml-org/llama.cpp/pull/23398)
- [Qwen3-Embedding blog](https://qwenlm.github.io/blog/qwen3-embedding/)
- [Qwen3-Embedding-0.6B-GGUF](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF)
- [EmbeddingGemma docs](https://ai.google.dev/gemma/docs/embeddinggemma) (validated alternative)
- [Gemma function calling docs](https://ai.google.dev/gemma/docs/core/function-calling)
- [DiffusionGemma announcement](https://blog.google/innovation-and-ai/technology/developers-tools/diffusion-gemma-faster-text-generation/)
- [node-llama-cpp](https://node-llama-cpp.withcat.ai)
- [LiteRT-LM overview](https://ai.google.dev/edge/litert-lm/overview)
- [research/gemma-2026.md](research/gemma-2026.md) for the full verified July 2026 baseline.
