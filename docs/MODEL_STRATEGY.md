# Model Strategy

Created: 2026-07-10

Vault Desk's product contracts are model-agnostic, with per-model certification and strong defaults, per [ADR 0016](adr/0016-model-agnostic-defaults-and-managed-downloads.md). Gemma 4 12B QAT is the default and first certified generation model. The first product should vary active context before it varies model, model size, retrieval policy, verification policy, or workflow eligibility.

## Current Recommendation

- Gemma 4 12B QAT as the default generation model on every supported desktop tier.
- Derive the model-plus-context budget from hardware and vary only the automatically fitted active context.
- Qwen3-Embedding-0.6B (Apache 2.0, official GGUF) as the product-managed dense encoder in every build flavor. EmbeddingGemma remains a validated alternative but carries Gemma Terms of Use distribution obligations and must not ship without a dedicated review.
- Gemma 4 native function calling for tool proposals on the default model; tool-proposal contracts remain model-agnostic.
- ShieldGemma or Gemma-family safety classifiers for local safety gates where licensing and runtime support fit.
- Multi-Token Prediction as an optional latency optimization only after memory, context, and correctness validation.
- DiffusionGemma, Gemma 4 26B A4B, and Gemma 4 31B as later research paths, not first-product requirements.

The design goal is a small set of certified, hardware-fit models with predictable behavior — defaults chosen for the user, additional models installable through the managed download experience defined in ADR 0016, and never a marketplace of arbitrary local models.

The first cross-platform desktop runtime is also singular: node-llama-cpp with the pinned official Gemma 4 12B QAT GGUF on Windows and macOS. MLX remains a later adapter-backed Apple Silicon optimization. See [ADR 0013](adr/0013-first-desktop-runtime.md).

## Certified Profiles

| Hardware | Budget | Context cap | Main model | Intended use |
|---|---:|---:|---|---|
| 8 GB Mac | Unsupported | None | None | Keep the product available to explain that local inference cannot run |
| More than 8 GB through 16 GB Mac | 10 GiB total | 64K | Gemma 4 12B QAT (default) | Automatically fitted local generation |
| More than 16 GB through 24 GB Mac | 12 GiB total | 64K | Gemma 4 12B QAT (default) | Automatically fitted local generation |
| More than 24 GB through 32 GB Mac | 16 GiB total | 64K | Gemma 4 12B QAT (default) | Automatically fitted local generation |
| More than 32 GB Mac | 16 GiB total | 128K | Gemma 4 12B QAT (default) | Automatically fitted local generation |
| Windows through 24 GB dedicated GPU VRAM | One device's complete dedicated VRAM | 64K | Gemma 4 12B QAT (default) | Automatically fitted GPU generation |
| Windows above 24 GB dedicated GPU VRAM | One device's complete dedicated VRAM | 128K | Gemma 4 12B QAT (default) | Automatically fitted GPU generation |
| Retrieval | Separate bounded reservation | 32K | Qwen3-Embedding-0.6B | Dense retrieval and semantic search over local document corpora |

Google's current Gemma 4 documentation lists approximate Q4_0 inference-load memory of 6.7 GB for 12B, 14.4 GB for 26B A4B, and 17.5 GB for 31B. Those numbers are model-load estimates, not whole-product budgets. Vault Desk still needs room for KV cache, runtime overhead, embeddings, document parsers, OCR, indexes, UI, and operating-system memory.

Gemma 4's medium models support up to 256K context according to the current docs, but Vault Desk does not expose that trained maximum. The product caps automatic allocation at 64K or 128K according to hardware. Gemma 4's hybrid attention (interleaved local sliding-window plus global) keeps KV-cache growth sublinear at long context, which strengthens the hardware-derived budget strategy but is still research-derived until measured under full product load.

Licensing (verified 2026-07-15): Gemma 4 is Apache 2.0 and Qwen3-Embedding-0.6B is Apache 2.0, so the default shipped stack is fully Apache 2.0. EmbeddingGemma remains under the Gemma Terms of Use; that burden is why it is no longer the default encoder (ADR 0016).

Packaging rule (verified 2026-07-11): ship or pin the official pre-converted QAT Q4_0 GGUF checkpoints. Self-converting QAT checkpoints to GGUF destroys the QAT quality benefit.

Development fetch sources (verified 2026-07-15): the hash-pinned development fetcher pulls from the official publisher repositories on Hugging Face and from no other host. All three repositories are Apache 2.0 and ungated; anonymous download was verified live (HTTP 200 without a token), so neither developers nor CI need Hugging Face accounts.

### Pinned Default Assets

The canonical machine-readable values live in [the model manifest](../assets/models.json), which pins each repository revision, literal file name, exact byte length, and SHA-256 digest. This table mirrors the current manifest; development source access was first verified on 2026-07-15. Download URLs follow the pattern `https://huggingface.co/<repository>/resolve/main/<file>`.

| Role | Repository | File | Size | SHA-256 |
|---|---|---|---|---|
| Default generation (12B, manifest status `candidate_to_ship`) | `google/gemma-4-12B-it-qat-q4_0-gguf` | `gemma-4-12b-it-qat-q4_0.gguf` | 6.98 GB | `faff1a63667fac17ac5e777f47114688fcefea96e220e211aaa8d62c2c4561f1` |
| 12B multimodal projector (paired with the above) | `google/gemma-4-12B-it-qat-q4_0-gguf` | `mmproj-gemma-4-12b-it-qat-q4_0.gguf` | 0.18 GB | `e70b0e5cd80323d5d588b4ed06780356b7b1ba03995a4b8164c6ae9db0ff5989` |
| Development test model (E2B, manifest status `development`, never shipped) | `google/gemma-4-E2B-it-qat-q4_0-gguf` | `gemma-4-E2B_q4_0-it.gguf` | 3.35 GB | `3646b4c147cd235a44d91df1546d3b7d8e29b547dbe4e1f80856419aa455e6fd` |
| E2B multimodal projector (paired with the above) | `google/gemma-4-E2B-it-qat-q4_0-gguf` | `gemma-4-E2B-it-mmproj.gguf` | 0.99 GB | `58c187648007cab392bd5678b87e862c3e8794017deb945feea2cf256195e96a` |
| Default encoder (manifest status `candidate_to_ship`) | `Qwen/Qwen3-Embedding-0.6B-GGUF` | `Qwen3-Embedding-0.6B-Q8_0.gguf` | 0.64 GB | `06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439` |

Notes:

- The E2B file name does not follow the 12B naming pattern (`gemma-4-E2B_q4_0-it.gguf`, underscore before `q4_0`); the manifest must use these literal file names, not a derived pattern.
- The Q8_0 encoder quantization remains the pinned development reference. Retrieval quality is measured only when the post-V1 document-intelligence follow-up is activated.
- Multimodal projectors remain post-V1 assets and are not fetched or packaged for M3.
- A digest mismatch on fetch is a hard failure: the upstream file changed and the pin must be re-reviewed deliberately, never auto-updated.

Vault Desk does not mirror or rehost model weights during development. GitHub is unsuitable regardless of preference: release assets cap at 2 GiB and Git LFS at 2-5 GB per file, below the 12B GGUF. The official repositories also keep provenance verifiable: the fetcher pins the upstream SHA-256 per file, so a silent upstream change fails the fetch instead of entering the cache. The same official repositories later serve as the allowlisted sources for the ADR 0016 model-download build, behind the typed broker and signed catalog.

See [PERFORMANCE_AND_CONTEXT.md](PERFORMANCE_AND_CONTEXT.md) and [adr/0009-12-16gb-gemma-context-standard.md](adr/0009-12-16gb-gemma-context-standard.md).

## Automatic Hardware Profiles

Every supported tier uses:

- Gemma 4 12B QAT as the main local model.
- Retrieval-first prompting.
- Bounded active context.
- Page, section, and table summary trees.
- Evidence packs rather than raw folder stuffing.
- Claim-level verification.
- One Gemma generation at a time through the shared resident worker; independent conversations may overlap microVM work within the hardware-derived RAM cap.
- Conservative multimodal page inspection.
- The same supported workflows.
- The same citation and approval requirements.
- The same context-compaction architecture.

The runtime fits the active generation context from an 8K minimum through the applicable 64K or 128K cap after applying the tier budget. macOS fitting uses combined CPU and GPU estimates and rejects a measured allocation above the selected total budget. Macs require more than 32 GB unified memory for the 128K cap because inference shares memory with the operating system, desktop, and agent guests. Windows requires more than 24 GB dedicated VRAM on one selected non-unified device for 128K; multi-device aggregates and readings that include unified or shared system memory are unsupported. The typed response records measured CPU RAM and GPU VRAM allocation, the memory budget, allocated context, hardware cap, and the exact threshold rule that selected that cap. Stability remains a validation question until measured on physical hardware under the full workload.

The goal is reliability on professional documents, not maximum context-window marketing.

## Deferred Larger Profiles

Larger workstation and appliance profiles are deferred until the automatic desktop tiers are stable.

Later validation may revisit:

- Gemma 4 12B QAT with larger context and concurrency on 64 GB systems.
- Gemma 4 31B dense for higher-quality synthesis.
- Gemma 4 26B A4B for throughput and concurrent office use.

Those profiles should not change the first implementation architecture.

## Encoder

Qwen3-Embedding-0.6B is the product-managed dense encoder, per [ADR 0016](adr/0016-model-agnostic-defaults-and-managed-downloads.md): Apache 2.0, official GGUF, strong multilingual retrieval (100+ languages), 32K input context, and served by the same node-llama-cpp runtime as generation. It is bundled in every build flavor and never user-selected. EmbeddingGemma remains a validated alternative with a Gemma Terms of Use distribution burden.

Recommended retrieval shape:

- Store canonical text chunks with stable source anchors.
- Embed title, heading, page, table, row, and paragraph-aware chunks.
- Use Qwen3-Embedding-0.6B dense vectors.
- Start with 768-dimensional embeddings for quality (the encoder supports 32 to 1024 output dimensions).
- Evaluate dimension reductions from 768 toward 128 only after recall tests on Vault Desk corpora.
- Size chunks by retrieval quality tests, not by the encoder's 32K input maximum; structure-aware chunks in the sub-2K range remain the starting point.
- Pair dense retrieval with lexical BM25 search.
- Use metadata filters for workspace, file type, date, page, sheet, table, and permission scope.
- Use vector compression only as an acceleration layer, not as the sole evidence store.

Qwen3-Embedding retrieval quality on Vault Desk corpora is research-derived until the post-V1 document-intelligence gate measures it.

See [RETRIEVAL_AND_VERIFICATION.md](RETRIEVAL_AND_VERIFICATION.md).

## DiffusionGemma Role

DiffusionGemma is relevant because diffusion language models can generate text by iterative denoising rather than left-to-right token prediction and may improve latency for some generation workloads.

For Vault Desk, it should be treated as:

- An experimental fast-draft model.
- A possible local autocomplete or first-pass summarization model.
- Not the first model for audited extraction, legal summaries, accounting reconciliation, or final cited answers.

Correctness workflows should remain anchored on Gemma 4 QAT profiles until DiffusionGemma is validated against the same citation, extraction, and verifier suite.

## Multi-Token Prediction Role

Gemma 4 Multi-Token Prediction is a first-party feature: each Gemma 4 size ships a paired lightweight drafter model, and draft-and-verify decoding produces output identical to standard decoding. Runtime support was verified on 2026-07-11: llama.cpp merged Gemma 4 MTP on 2026-06-07 (roughly 1.4x to 2.2x decode speedup for dense models), vLLM supports all variants, and Ollama supports it on the MLX backend.

For Vault Desk, MTP should be treated as:

- An optional decode-speed optimization.
- Not required for correctness (draft-and-verify output is provably identical, so the risk is memory and stability, not answer quality).
- A roughly 2 GB additional memory cost for the drafter, which competes directly with the automatically fitted active context.
- Not allowed to reduce the certified active context target.
- Not allowed to change citation, extraction, or verification behavior.
- Validated jointly with KV-cache quantization per pinned runtime build, because q8_0 KV-cache quantization initially broke MTP acceptance in llama.cpp.
- Disabled by default until it passes the same workflow benchmark suite as baseline decoding.

Open validation item: node-llama-cpp supports generic draft-model speculative decoding, but explicit Gemma 4 MTP drafter support through the Node bindings is unverified.

## Runtime Policy

Use runtime adapters:

- node-llama-cpp in a supervised inference worker is the first hardware-aware desktop path on Windows and macOS. It loads the pinned official Gemma 4 QAT GGUFs, enforces JSON-schema outputs, supports function calling and embeddings, and covers Metal, CUDA, and Vulkan while keeping runtime-specific types outside Vault Core.
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

## Revision History

| Date | Change |
|---|---|
| 2026-07-10 | Initial Gemma-family model strategy created from current research. |
| 2026-07-10 | Added Gemma 4 Q4_0 memory numbers, 256K context caveat, and EmbeddingGemma dimensionality guidance. |
| 2026-07-10 | Recentered first certification on Local 12 and Local 16 using the same Gemma 4 12B QAT model, with context size as the only product capability difference. |
| 2026-07-11 | Revalidated against live sources: Apache 2.0 licensing, EmbeddingGemma license caveat, official QAT GGUF packaging rule, verified MTP runtime support and memory cost, node-llama-cpp and LiteRT-LM runtime guidance, and joint QAT/KV-quant/MTP certification rule. |
| 2026-07-11 | Selected node-llama-cpp and the official QAT GGUF as the single first Windows/macOS runtime target through ADR 0013. |
| 2026-07-15 | Recorded the official Google Hugging Face repositories as the only development fetch sources, the per-identity EmbeddingGemma gating procedure, and the decision not to mirror weights on GitHub or elsewhere before the V1 packaging gate. |
| 2026-07-15 | Applied ADR 0016: model-agnostic contracts with Gemma 4 12B QAT as default generation model, Qwen3-Embedding-0.6B replacing EmbeddingGemma as the product-managed encoder (ungated fetch, fully Apache 2.0 shipped stack), and the managed model-download build flavor. |
| 2026-07-15 | Pinned the exact default assets for the M0 manifest — repository names, literal file names, sizes, and SHA-256 digests read from the Hugging Face API and verified anonymously downloadable — covering 12B QAT, E2B QAT, their multimodal projectors, and the Q8_0 encoder. |
| 2026-07-15 | Added PrismML Bonsai as a research-derived later candidate, pending stable upstream runtime support and the complete certification suite. |
| 2026-07-20 | Moved embedding and multimodal document certification after V1 and aligned model evaluation with the generic agent product gate. |
| 2026-07-22 | Aligned the 12B and E2B QAT SHA-256 digests with their pinned revisions in the canonical model manifest. |
| 2026-07-22 | Replaced the fixed 8K product context with automatic macOS memory tiers, complete detected Windows GPU VRAM use, and runtime-fitted context up to 256K. |
| 2026-08-01 | Capped automatic context at 64K or 128K using separate Mac unified-memory and Windows VRAM thresholds and exposed the measured allocations, selected cap, and threshold reason through the typed runtime status. |
| 2026-08-04 | Restricted Windows automatic budgets and context tiers to one device's dedicated VRAM. |
