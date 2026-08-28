# Edge AI Research Review 2026

Created: 2026-07-10

This document records the July 10, 2026 research review used to challenge the Garden Desk planning docs. Claims here are research-derived until independently validated on Garden Desk hardware and document corpora.

A newer live-web revalidation pass ran on 2026-07-11; see [gemma-2026.md](gemma-2026.md), [document-tools-2026.md](document-tools-2026.md), [local-ai-runtimes.md](local-ai-runtimes.md), and [competitive-landscape.md](competitive-landscape.md) for the current verified baseline. This file is kept as a dated snapshot.

## Sources Reviewed

Gemma and local inference:

- [Gemma 4 model overview](https://ai.google.dev/gemma/docs/core)
- [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4)
- [Gemma 4 Multi-Token Prediction](https://ai.google.dev/gemma/docs/mtp/overview)
- [Gemma llama.cpp integration](https://ai.google.dev/gemma/docs/integrations/llamacpp)
- [Gemma MLX integration](https://ai.google.dev/gemma/docs/integrations/mlx)
- [EmbeddingGemma docs](https://ai.google.dev/gemma/docs/embeddinggemma)
- [DiffusionGemma announcement](https://blog.google/innovation-and-ai/technology/developers-tools/diffusion-gemma-faster-text-generation/)

Document processing:

- [Microsoft MarkItDown](https://github.com/microsoft/markitdown)
- [Docling](https://github.com/docling-project/docling)
- [Unstructured partitioning docs](https://docs.unstructured.io/open-source/core-functionality/partitioning)

Inference and long-context research:

- [PagedAttention paper](https://arxiv.org/abs/2309.06180)
- [StreamingLLM paper](https://arxiv.org/abs/2309.17453)
- [Lost in the Middle paper](https://arxiv.org/abs/2307.03172)
- [RULER benchmark paper](https://arxiv.org/abs/2404.06654)

## Most Relevant Breakthroughs

### Gemma 4 QAT Makes 12 GB Worth Testing

The official Gemma 4 docs list a 6.7 GB Q4_0 load estimate for 12B. That makes a 12 GB profile plausible, but not guaranteed, because KV cache, prefill buffers, runtime allocator behavior, multimodal inputs, and operating overhead still matter.

Product implication:

- Certify Local 12 and Local 16 with the same Gemma 4 12B QAT model.
- Make active context the only capability delta.
- Treat every higher-context claim as a benchmark result, not a marketing assumption.

### 256K Context Is A Ceiling, Not A Strategy

Gemma 4 medium models advertise long context, and the 12B model card describes a unified multimodal architecture with hybrid attention. That is useful, but long-context benchmarks and "lost in the middle" work show that longer input does not automatically mean reliable use of all evidence.

Product implication:

- Use long context for selected evidence, not raw folders.
- Keep retrieval, summaries, and verification as first-class architecture.
- Benchmark active context at the full workflow level, including compaction.

### Multi-Token Prediction Is A Latency Optimization

Gemma 4 supports Multi-Token Prediction through a separate prediction model. This can improve generation speed when the runtime supports it and the extra memory fits.

Product implication:

- Treat MTP like an optional turbo path.
- Do not make MTP required for correctness.
- Do not enable it if it reduces certified active context or breaks reproducibility.

### KV Cache And Prompt Cache Matter More Than Model Swapping

PagedAttention and related serving work highlight that KV cache management is a first-order performance concern for long prompts. For local desktop profiles, the highest leverage is stable prefill, cache reuse, and bounded evidence packs.

Product implication:

- Benchmark KV-cache behavior directly.
- Prefer prompt or prefix cache for stable system and workflow instructions.
- Use compaction so long sessions do not require ever-growing live context.

### Streaming And Compaction Are Required For Long Work

StreamingLLM-style research and practical long-context benchmarks both point to the same product issue: a session must keep working after the initial window fills. The product cannot rely on hidden model state.

Product implication:

- Store task state, evidence, approvals, warnings, and artifacts outside the prompt.
- Compact proactively before context pressure degrades answers.
- Make compacted state inspectable and auditable.

### Document Layout Tools Are Improving, But Still Need Routing

MarkItDown is attractive as a broad first-pass converter. Docling is stronger where layout, tables, and page structure matter. Unstructured remains useful as a fallback and comparison path.

Product implication:

- Use a parser router rather than one universal converter.
- Compare parser outputs for high-value documents.
- Keep OCR and multimodal inspection as escalations, not defaults.

### EmbeddingGemma Is A Good Family Fit, But Hybrid Search Still Wins

EmbeddingGemma is small enough to run locally and stays inside the Gemma family. Professional documents still require exact matching for names, dates, amounts, record identifiers, clause references, and account IDs.

Product implication:

- Use EmbeddingGemma for dense retrieval.
- Pair it with lexical indexing and metadata filters.
- Do not use compressed vectors as the only evidence store.

## Architecture Challenges

### Challenge 1: The 16 GB And 64 GB Plan Was Too Wide

The earlier plan encouraged premature larger-model work. The document engine and verifier need to be proven first.

Resolution:

- Make Local 12 and Local 16 the main validation pair.
- Keep 64 GB appliance profiles as later research.

### Challenge 2: The Model Strategy Was Too Generous

Gemma 4 26B A4B, Gemma 4 31B, and DiffusionGemma are interesting, but they create validation branches before the core product is stable.

Resolution:

- Keep Gemma 4 12B QAT as the only first-product generation model.
- Use EmbeddingGemma for retrieval.
- Revisit larger or diffusion models only after the document workflow benchmark suite exists.

### Challenge 3: The Runtime Plan Must Not Leak Into Product Logic

llama.cpp, MLX, Ollama-compatible serving, and vLLM-class serving have different strengths. The product should not embed runtime-specific assumptions into workflows.

Resolution:

- Keep runtime adapters thin.
- Certify behavior, not runtime brand.
- Store runtime-specific performance data in benchmark records.

### Challenge 4: Context Compaction Was Under-Specified

The prior docs said to use bounded active context and summaries, but they did not define how a session keeps working after the context fills.

Resolution:

- Add structured session, task, evidence, artifact, preference, and warning ledgers.
- Trigger compaction before context pressure.
- Add a 30-minute multi-compaction acceptance test.

### Challenge 5: "Least Code" Needs Enforcement

The architecture lists many logical services. Without a quality bar, that can turn into unnecessary packages and tests.

Resolution:

- Treat services as contracts, not folders.
- Add code only when it implements a product responsibility.
- Test privacy, approval, audit, retrieval, verification, compaction, and recovery invariants first.

## Research Backlog

Validate before implementation:

- Maximum stable active context for Local 12 with Gemma 4 12B QAT.
- Maximum stable active context for Local 16 with the same model and workflow policy.
- Whether KV-cache quantization preserves citation precision and structured-output validity.
- Whether MTP improves end-to-end workflow latency enough to justify memory cost.
- llama.cpp GGUF behavior for Gemma 4 12B QAT on 12 GB and 16 GB NVIDIA cards.
- MLX behavior for Gemma 4 12B QAT on Apple Silicon memory envelopes equivalent to Local 12 and Local 16.
- OCR and parser throughput while the model runtime is loaded.
- Docling versus MarkItDown versus Unstructured agreement on accounting and legal PDFs.
- Hybrid retrieval recall with EmbeddingGemma plus lexical search.
- Multi-compaction answer consistency over long folder sessions.
