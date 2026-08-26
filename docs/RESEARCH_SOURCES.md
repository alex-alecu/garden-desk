# Research Sources

Created: 2026-07-10

This repository was initialized from supplied local materials rather than live web research.

## Supplied Materials

Primary source files used:

- `/Users/alex/.codex/attachments/10d6a267-9747-4f08-88fa-d711354c012a/pasted-text-1.txt`
- `/Users/alex/Desktop/deep-research-report.md`

The pasted text provided the product, market, business, hardware, roadmap, and private repository structure direction.

The deep research report provided the model, runtime, document pipeline, benchmark, and architecture recommendations.

## Current Web Sources Reviewed

- [Gemma core docs](https://ai.google.dev/gemma/docs/core)
- [Gemma 4 QAT announcement](https://blog.google/innovation-and-ai/technology/developers-tools/quantization-aware-training-gemma-4/)
- [EmbeddingGemma docs](https://ai.google.dev/gemma/docs/embeddinggemma)
- [Qwen3-Embedding blog](https://qwenlm.github.io/blog/qwen3-embedding/)
- [Qwen3-Embedding-0.6B-GGUF](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF)
- [Gemma function calling docs](https://ai.google.dev/gemma/docs/core/function-calling)
- [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4)
- [Gemma 4 Multi-Token Prediction](https://ai.google.dev/gemma/docs/mtp/overview)
- [DiffusionGemma announcement](https://blog.google/innovation-and-ai/technology/developers-tools/diffusion-gemma-faster-text-generation/)
- [Microsoft MarkItDown](https://github.com/microsoft/markitdown)
- [Docling](https://github.com/docling-project/docling)
- [Unstructured partitioning docs](https://docs.unstructured.io/open-source/core-functionality/partitioning)
- [turbovec](https://github.com/RyanCodrai/turbovec)
- [PagedAttention paper](https://arxiv.org/abs/2309.06180)
- [StreamingLLM paper](https://arxiv.org/abs/2309.17453)
- [Lost in the Middle paper](https://arxiv.org/abs/2307.03172)
- [RULER benchmark paper](https://arxiv.org/abs/2404.06654)
- [Tauri](https://github.com/tauri-apps/tauri)
- [Tauri v2 sidecar documentation](https://v2.tauri.app/develop/sidecar/)
- [Tauri distribution documentation](https://v2.tauri.app/distribute/)
- [OpenCode server documentation](https://opencode.ai/docs/server/)
- [OpenCode tools and permissions](https://opencode.ai/docs/tools/)
- [Everything Claude Code](https://github.com/affaan-m/ECC)
- [ECC cross-harness architecture](https://github.com/affaan-m/ECC/blob/main/docs/architecture/cross-harness.md)
- [Developer Certificate of Origin 1.1](https://developercertificate.org/)
- [DCO GitHub App](https://github.com/apps/dco)
- [GitHub commit sign-off policy](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-commit-signoff-policy-for-your-repository)

## 2026-07-11 Live Revalidation

On 2026-07-11 a full live-web revalidation pass was run across the model stack, document tooling, retrieval components, agent-loop frameworks, and competitive landscape. Findings and source links were folded into:

- [research/gemma-2026.md](research/gemma-2026.md) — Gemma 4 timeline, licensing, QAT, MTP, EmbeddingGemma, and performance baselines.
- [research/local-ai-runtimes.md](research/local-ai-runtimes.md) — verified runtime support matrix including node-llama-cpp and LiteRT-LM.
- [research/document-tools-2026.md](research/document-tools-2026.md) — parser license posture, Granite-Docling GGUF, PaddleOCR-VL, native Node parsers, LanceDB and sqlite-vec.
- [research/competitive-landscape.md](research/competitive-landscape.md) — twelve incumbents and six newcomers with verified license, telemetry, OCR, approval, and audit findings.
- [RETRIEVAL_AND_VERIFICATION.md](RETRIEVAL_AND_VERIFICATION.md) — TurboQuant (Google Research, ICLR 2026) versus turbovec naming and index decision.
- [research/offline-knowledge-bundles-2026.md](research/offline-knowledge-bundles-2026.md) — RO-Crate 1.3, BagIt, SPDX 3.0.1 Dataset, W3C PROV/selectors, TUF, Sigstore, OCI, and offline domain-library architecture.
- [research/m3-professional-document-skills-2026.md](research/m3-professional-document-skills-2026.md) — Agent Skills design, public legal, finance, healthcare, and report patterns, and the M3 adoption boundary.
- [IMPLEMENTATION_QUALITY_BAR.md](IMPLEMENTATION_QUALITY_BAR.md) — default component stack table.

## 2026-07-13 Desktop And Hybrid-Execution Review

Official Tauri v2 sources were reviewed for the operating-system webview architecture, React/TypeScript compatibility, capability-scoped commands, external-binary sidecars, and platform distribution. These remain research-derived until M0 validates a pinned Tauri version, signed Vault Core sidecar packaging, webview behavior, and capability denial on supported Windows and macOS targets.

Official OpenCode sources were reviewed as an interaction and agent-loop reference. OpenCode is not an accepted dependency. M3 starts with a minimal Vault Desk-owned guest loop under offline, no-network, typed-inference, resource, audit, cancellation, package-footprint, and result-validation gates.

## 2026-07-15 Development And Contribution Workflow Review

Everything Claude Code was reviewed as a development-workflow reference rather than as a product or build dependency. Vault Desk adopted the useful ideas of research before custom code, explicit verification evidence, on-demand reusable skills, findings-first review, and privacy-safe handoffs in original project-specific wording.

Vault Desk did not adopt ECC's package, installers, global agent configuration, Codex synchronization, Git hooks, MCP baseline, memory and autonomous-learning services, worktree orchestration, blanket coverage target, proactive delegation policy, generic application architecture, model routing, inference guidance, or runtime components. If substantial ECC material is copied later, its MIT license and required notice must be retained.

The canonical DCO text, DCO GitHub App, and GitHub commit sign-off documentation were reviewed for the M0 human-contributor authorship and enforcement workflow. The app and repository settings remain inactive until M0 selects the root license and explicitly opens implementation contributions.

## Research-Derived Claims

Now verified against primary sources (2026-07-11), still requiring validation on Vault Desk's own hardware and corpora:

- Gemma 4 licensing (Apache 2.0) and QAT checkpoint availability: verified. Memory and runtime behavior on every automatic macOS tier and representative Windows GPUs under full product load: still to benchmark.
- Multi-Token Prediction runtime support: verified. Its memory, latency, and stability across the automatic hardware tiers, and node-llama-cpp MTP drafter support: still to validate.
- EmbeddingGemma profile and license: verified; demoted to validated alternative by ADR 0016. Qwen3-Embedding-0.6B license (Apache 2.0), official GGUF availability, and published MTEB multilingual results: verified 2026-07-15. Retrieval quality of the default encoder on local professional corpora: still to benchmark.
- Parser quality rankings and OCR benchmark scores: vendor and community benchmarks only; must be re-run on Vault Desk accounting and legal corpora.
- Community tokens-per-second figures: research-derived, not lab results.

Still research-derived and unverified:

- DiffusionGemma suitability for cited, verified document work.
- KV-cache and prompt-cache behavior under long evidence packs.
- Context compaction quality over long document sessions.
- Hardware roadmaps for AMD, NVIDIA, and OEM systems.
- Current cloud pricing and hosted inference options.
- Market-signal statistics cited in the competitive landscape (legal AI adoption rates, HIPAA breach statistics).

## Source Handling Rules

- Keep original supplied materials separate from authored repository docs unless the user explicitly asks to import them.
- Do not copy long external source passages into repository files.
- Summarize research in original words.
- Mark unvalidated market or vendor claims as research-derived.
- Revalidate time-sensitive claims before business use.

## Validation Backlog

Before code or public claims:

- Confirm exact model licensing.
- Confirm allowed model redistribution terms.
- Confirm supported runtimes by platform.
- Benchmark chosen runtimes on actual target hardware.
- Benchmark Gemma 4 12B QAT active context on every supported automatic macOS tier and representative Windows GPUs with document workers running.
- Benchmark every automatic hardware tier through at least 30-minute sessions with multiple context compactions.
- Benchmark Gemma 4 12B QAT, 26B A4B, and 31B dense only after the automatic hardware-tier workflow suite is stable.
- Benchmark Qwen3-Embedding-0.6B plus lexical search against accounting and legal corpora, with EmbeddingGemma as the comparison alternative.
- Benchmark native Node parsers, Granite-Docling GGUF, the Docling sidecar, PaddleOCR-VL, MarkItDown, Unstructured, and native spreadsheet parsing against the same files.
- Benchmark LanceDB hybrid search (with RaBitQ quantization) against sqlite-vec and against turbovec-in-sidecar for recall and latency.
- Validate node-llama-cpp with Gemma 4 QAT GGUF, grammar-constrained output, and the MTP drafter on all three GPU vendors.
- Re-verify competitor capabilities and pricing before any external marketing use.
- Validate the Knowledge Bundle profile, archive transport, TypeScript library maturity, TUF offline-media workflow, content rights, and retrieval rebuild on representative accounting and legal libraries.
- Verify accounting workflow compliance requirements by country.
- Review IP ownership and employment agreement implications with counsel.
- Validate pinned Tauri v2 capability denial, signed sidecar identity, local transport bootstrap, WebView2/WKWebView behavior, and packaged lifecycle.
- Compare OpenCode with a minimal guest loop on the same offline functional and adversarial code-interpreter corpus before adopting either implementation.
