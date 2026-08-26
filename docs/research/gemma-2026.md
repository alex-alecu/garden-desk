# Gemma Research 2026

Created: 2026-07-10

This document captures the current research baseline for the Gemma-family strategy. It was revalidated against live web sources on 2026-07-11. Claims marked research-derived should still be revalidated before public marketing, packaging, or hardware certification.

## Sources Reviewed

Primary Google sources:

- [Gemma releases log](https://ai.google.dev/gemma/docs/releases)
- [Gemma core docs](https://ai.google.dev/gemma/docs/core)
- [Gemma 4 announcement](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)
- [Gemma 4 12B announcement](https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/)
- [Gemma 4 QAT announcement](https://blog.google/innovation-and-ai/technology/developers-tools/quantization-aware-training-gemma-4/)
- [Gemma 4 Multi-Token Prediction docs](https://ai.google.dev/gemma/docs/mtp/overview)
- [Gemma 4 MTP announcement](https://blog.google/innovation-and-ai/technology/developers-tools/multi-token-prediction-gemma-4/)
- [EmbeddingGemma docs](https://ai.google.dev/gemma/docs/embeddinggemma)
- [EmbeddingGemma paper](https://arxiv.org/abs/2509.20354)
- [Gemma function calling docs](https://ai.google.dev/gemma/docs/core/function-calling)
- [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4)
- [DiffusionGemma announcement](https://blog.google/innovation-and-ai/technology/developers-tools/diffusion-gemma-faster-text-generation/)
- [LiteRT-LM overview](https://ai.google.dev/edge/litert-lm/overview)

Runtime and ecosystem sources:

- [llama.cpp Gemma 4 MTP PR](https://github.com/ggml-org/llama.cpp/pull/23398)
- [vLLM Gemma 4 MTP PR](https://github.com/vllm-project/vllm/pull/41745)
- [Ollama MLX MTP announcement](https://ollama.com/blog/faster-gemma-4-mlx-mtp)
- [node-llama-cpp](https://node-llama-cpp.withcat.ai)
- [Unsloth Gemma 4 QAT notes](https://unsloth.ai/docs/models/gemma-4/qat)

## Verified Family Status (July 2026)

Gemma 4 is the current generation. The official releases log lists the initial release on 2026-03-31 (announced 2026-04-02), the MTP drafter models on 2026-04-16, the 12B Unified model on 2026-06-03, and family-wide QAT checkpoints on 2026-06-05.

Verified lineup:

| Variant | Params | Architecture | Context | Modalities |
|---|---|---|---|---|
| E2B | ~2.3B effective (Per-Layer Embeddings) | Efficient edge | 128K | Text, image, audio |
| E4B | ~4.5B effective (PLE) | Efficient edge | 128K | Text, image, audio |
| 12B | 11.95B | Unified encoder-free multimodal | 256K | Text, image, audio |
| 26B A4B | 26B total, ~4B active | Mixture of experts | 256K | Text, image |
| 31B | 30.7B | Dense | 256K | Text, image |

Verified facts that matter to Vault Desk:

- Gemma 4 is licensed under Apache 2.0, a change from the custom Gemma Terms of Use used through Gemma 3. This simplifies the open-source boundary for the generation model.
- The 12B Unified model is encoder-free multimodal: image patches and 16 kHz audio are projected directly into the decoder embedding space. It approaches 26B A4B quality at under half the memory footprint.
- Hybrid attention (interleaved local sliding-window plus global) keeps KV-cache growth sublinear at long context. RULER at 128K improved from 13.5 percent (Gemma 3) to 66.4 percent (Gemma 4). Long-context claims remain research-derived until validated on Vault Desk workloads.
- Instruction-tuned variants support system roles, configurable thinking modes, and built-in function calling.
- There is no "Gemma 4.5" and no "EmbeddingGemma 2" as of 2026-07-11. Claims to the contrary on aggregator sites are unverified.

## QAT Status

Official QAT checkpoints for all five Gemma 4 sizes were released 2026-06-05, in Q4_0 GGUF (llama.cpp), compressed-tensors (vLLM), unquantized QAT research checkpoints, and a mobile format.

- Gemma 4 12B QAT Q4_0 loads at approximately 6.6 to 7 GB of weights. Community figures for the rest of the family: E2B ~3 GB, E4B ~5 GB, 26B A4B ~15 GB, 31B ~18 GB (research-derived).
- Google claims QAT quality above standard post-training quantization baselines. Community reports of 1 to 2 percent degradation versus BF16 are research-derived.
- Packaging warning: self-converting QAT checkpoints to GGUF Q4_0 destroys the QAT quality benefit (Unsloth report). Vault Desk must ship or pin the official pre-converted QAT GGUFs, not perform its own conversion.
- 26B A4B QAT at ~15 GB is marginal on 16 GB systems and not viable on 12 GB. This supports keeping 12B QAT as the only first-product generation model.

## Multi-Token Prediction Status

Gemma 4 MTP is a first-party feature: each size ships a paired lightweight drafter that shares the target model's embedding table and last-layer activations. Output is provably identical to standard decoding.

Runtime support as of July 2026:

- llama.cpp: merged 2026-06-07 (`--spec-type draft-mtp`). Roughly 1.4x to 2.2x decode speedup for dense models; little gain for the 26B MoE at batch size 1. The drafter needs roughly 2 GB additional memory.
- vLLM: supported for all variants.
- Ollama: supported on the MLX backend on Apple Silicon.
- LM Studio: runtime support exists but drafter selection is buggy as of July 2026.
- node-llama-cpp: generic speculative decoding is supported; explicit Gemma 4 MTP drafter support is unverified. Treat as a validation question.

Known interaction warning: q8_0 KV-cache quantization initially broke MTP acceptance in llama.cpp (later fixed). Every combination of QAT weights, KV-cache quantization, and MTP must be validated together per runtime build before being enabled.

## EmbeddingGemma Status

EmbeddingGemma remains the 2025-09-04 308M model. Verified profile:

- Gemma 3 backbone with bidirectional attention, 2K token input context, 100+ languages.
- Matryoshka output dimensions: 768 truncatable to 512, 256, or 128.
- Best open multilingual embedding model under 500M params on MTEB (Multilingual v2 61.15, English v2 69.67).
- QAT checkpoints in int4 and int8; under 200 MB RAM quantized; near-lossless at int8 and int4.
- Runs in sentence-transformers, llama.cpp, MLX, Ollama, LiteRT, transformers.js, and LM Studio.
- License caveat: EmbeddingGemma remains under the Gemma Terms of Use, not Apache 2.0. The open-source boundary must account for this difference from Gemma 4.

## Performance Baselines (Research-Derived)

Community-reported figures, not vendor lab results:

- RTX 3060 12 GB, 12B QAT Q4, ~4K context: ~33 tokens per second decode, over 1000 tokens per second prefill.
- RTX 4060 8 GB, 12B QAT Q4 with partial offload at 48K context: 20+ tokens per second decode; MTP added 25 to 40 percent.
- RTX 4060 Ti 16 GB: no published figure found; treat as an open benchmark item.
- Apple Silicon M2/M3 class: ~30 to 60 tokens per second at Q4; MTP on newer chips reported near 2.8x throughput.
- Hybrid attention keeps KV growth sublinear: community VRAM tables show 26B A4B growing only 18 GB at 4K to 23 GB at 256K.

These support the Local 12 and Local 16 thesis: 12B QAT weights leave roughly 4 to 5 GB of KV headroom on 12 GB cards and 8 to 9 GB on 16 GB cards before product overhead.

## Product Implications

Gemma 4 12B QAT remains the right product anchor for Local 12 and Local 16. Official memory claims for QAT weights do not remove KV cache, runtime overhead, multimodal components, indexing, OCR, or document workers from the product memory budget, so Vault Desk still needs retrieval-first prompting, bounded active context, and context compaction on local hardware.

The 256K context capability is a ceiling to validate, not a default. Use the context window for selected evidence, cached summaries, compacted task state, and verification passes, not for raw ingestion of every page in a folder.

## Recommended Model Policy

Use:

- Gemma 4 12B QAT (official pre-converted Q4_0 GGUF) as the product default on Local 12 and Local 16.
- Context size as the only product capability difference between Local 12 and Local 16.
- EmbeddingGemma as the dense retrieval encoder, with its Gemma Terms of Use license tracked at the open-source boundary.
- Gemma 4 native function calling for tool proposals.
- Multi-Token Prediction as an optional latency optimization after joint validation with KV-cache quantization per runtime build.
- DiffusionGemma, Gemma 4 31B dense, and Gemma 4 26B A4B only as later research paths until the Local 12 and Local 16 workflow suite is stable.

## Validation Questions

- Does node-llama-cpp load and run the Gemma 4 MTP drafter, or only generic draft-model speculative decoding?
- What is the maximum stable active context on 12 GB after document workers, embedding, UI, and indexing are included?
- What is the maximum stable active context on 16 GB under the same workflow policy?
- Does KV-cache quantization preserve citation precision and structured-output validity, and does it remain compatible with MTP on the pinned runtime build?
- Does MTP improve end-to-end document workflow latency enough to justify roughly 2 GB drafter memory on Local 12?
- What are real RTX 4060 Ti 16 GB numbers under full product load?
- Can DiffusionGemma preserve citation discipline and structured output reliability?
- When the desktop workflow suite is stable, is 31B dense quality or 26B A4B throughput worth a 64 GB appliance SKU?
