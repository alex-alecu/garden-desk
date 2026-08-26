# Local AI Runtimes

Created: 2026-07-10

This document summarizes the runtime research baseline. Runtime support changes quickly and must be revalidated before implementation. The runtime support matrix below was verified against live sources on 2026-07-11.

## Verified Runtime Support Matrix (July 2026)

| Runtime | Gemma 4 | QAT | MTP / speculative decoding | TypeScript/Node story |
|---|---|---|---|---|
| llama.cpp | Yes, day one | Yes, official Q4_0 GGUFs | Most mature: Gemma 4 MTP merged 2026-06-07, plus EAGLE-3, DFlash, and n-gram modes | Via node-llama-cpp |
| node-llama-cpp | Yes (v3.19+) | Yes, loads QAT GGUFs | Generic speculative decoding since v3.8; explicit Gemma 4 MTP drafter support unverified | Best-in-class: native Node integration, full typings, JSON-schema-enforced output, function calling, embeddings, Metal/CUDA/Vulkan; runs behind the separate Vault Core sidecar |
| Ollama | Yes, day one | Yes | MTP on the MLX backend (Apple Silicon) | HTTP API, out-of-process |
| LM Studio | Yes | Yes | Runtime supports MTP but drafter selection is buggy as of July 2026 | SDK and HTTP API |
| MLX | Yes, day one | Yes | MTP via mlx-lm and Ollama-MLX | Python-first, no first-class TS |
| Google LiteRT-LM | Yes, including 12B | Yes, including mobile format | MTP supported (official Google test surface) | JS/WASM API plus OpenAI-compatible local server; MediaPipe LLM Inference is maintenance-only |
| vLLM | Yes (compressed-tensors QAT) | Yes | MTP for all variants | Server-grade, appliance-tier only |

Implication: for the TypeScript/Node harness on 12 to 16 GB consumer GPUs, llama.cpp via node-llama-cpp is the strongest verified first path, with LiteRT-LM's local server as an emerging Google-first alternative to track.

## Model Stack Direction

The current architecture recommends a Gemma-family local model stack:

- Gemma 4 12B QAT for the first Local 12 and Local 16 certified local profiles.
- EmbeddingGemma for retrieval.
- Gemma 4 native function calling for tool proposals.
- ShieldGemma or Gemma-family safety classification where validated.
- Multi-Token Prediction as an optional latency optimization after validation.
- DiffusionGemma, Gemma 4 26B A4B, and Gemma 4 31B dense as later research paths, not first-product requirements.

The research comparison remains useful for later adapters. Product sequencing is now decided by [ADR 0013](../adr/0013-first-desktop-runtime.md): node-llama-cpp with the pinned official QAT GGUF is the single first Windows/macOS certification target.

## Runtime Direction By Platform

### macOS

Research-derived optimization view: Apple Silicon may benefit from an Apple-native MLX-family runtime. MLX is evaluated after the first node-llama-cpp product path and must remain behind the same runtime adapter.

The main product reason is unified memory and platform fit.

### Windows With NVIDIA

Windows with NVIDIA should prefer llama.cpp-compatible local serving first for the Local 12 and Local 16 Gemma 4 12B QAT profiles.

The main product reason is low-friction local deployment and a practical low-VRAM path.

Ollama-compatible serving should be evaluated only when packaging and context behavior are explicit, telemetry is absent or provably disabled, and no telemetry network path exists.

### AMD Desktop

AMD desktop support should begin with llama.cpp-style serving through HIP or Vulkan where validated.

ROCm and advanced serving should be treated cautiously until specific hardware and OS combinations are proven.

### Office Appliance Or Server

For stronger office hardware, vLLM-class serving may become the better throughput and scheduling path. It should be benchmarked only after Local 12 and Local 16 are validated.

### Hosted Escalation

Hosted escalation should be an explicit optional path for hard tasks, not a default product dependency.

## Performance Priorities

Suggested tuning order:

1. Use quantized main models for local profiles.
2. Keep active context small.
3. Lean on retrieval instead of raw-window stuffing.
4. Use prefix or prompt caching where supported.
5. Use chunked prefill where supported.
6. Use memory mapping carefully on desktop runners.
7. Add KV-cache quantization only after citation precision and structured-output validity are unchanged.
8. Add Multi-Token Prediction only after quality, context, and memory stability are validated.
9. Treat DiffusionGemma as a separate speed experiment until it passes the same verification suite.

## Benchmark Priorities

Measure:

- First-token latency.
- Inter-token latency.
- Tokens per second.
- End-to-end workflow latency.
- Peak VRAM and RAM.
- Retrieval quality.
- Citation precision.
- Tool-loop success rate.
- Stability under repeated local jobs.
- Stable active context under document-worker memory load.
- Stable compaction behavior after the live context fills.
- Cache reuse on repeated folder questions.
- Citation and verifier failure rates.
