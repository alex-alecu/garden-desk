# ADR 0013: First Desktop Runtime

Date: 2026-07-11

## Status

Accepted as first certification target

## Context

The product strategy calls for one supported model/runtime stack before adding alternatives. Earlier documents described MLX-family serving as the first Apple Silicon direction while the implementation plan selected node-llama-cpp and official QAT GGUF assets. Leaving both as simultaneous first choices would double packaging, memory, context, structured-output, and correctness certification before the first workflow is proven.

Vault Desk also needs the same grammar-enforced structured-output and function-calling semantics on its initial Windows and macOS paths. Runtime-specific behavior must remain behind an adapter so later optimization does not change product contracts.

## Decision

The first Windows and macOS desktop certification target is node-llama-cpp running the pinned official Gemma 4 12B QAT Q4_0 GGUF inside a supervised inference worker.

This host-native worker uses the accelerator exception defined by [ADR 0012](0012-worker-isolation-and-untrusted-documents.md): GPU access remains available, but an operating-system sandbox denies networking and the worker receives no shell, executable tools, credentials, approval authority, or arbitrary workspace access. It is not the hostile-document or executable-tool sandbox.

The first retrieval path uses the default dense encoder selected by [ADR 0016](0016-model-agnostic-defaults-and-managed-downloads.md) — Qwen3-Embedding-0.6B, official GGUF — through the same node-llama-cpp runtime.

The runtime adapter exposes model loading, structured generation, embeddings, cancellation, resource reporting, health, and disposal without exposing node-llama-cpp types to Vault Core.

Runtime builds, model hashes, grammar conversion behavior, context configuration, and memory-affecting options are pinned and recorded in benchmark reports.

MLX-family serving remains a later Apple Silicon optimization candidate. It may be added only behind the same adapter and must pass the complete workflow, citation, verification, compaction, offline, and package suite before becoming a certified alternative. It is not required for the first Community Desktop MVP.

## Consequences

Positive:

- Keeps the first certification matrix to one runtime and model format.
- Uses the same structured-output path on Windows and macOS.
- Avoids maintaining parallel GGUF and MLX model packages before product validation.
- Preserves future runtime replacement through a narrow adapter.

Negative:

- May leave Apple-specific performance improvements unrealized in the first release.
- Native build and GPU backend behavior still differ across Metal, CUDA, and Vulkan.
- The runtime must pass Tauri sidecar packaging and worker-process validation on every certified platform.

## Required Validation

- Native load and structured-generation smoke tests on initial Windows and macOS targets in M2.
- OS-sandbox tests proving network-capability denial and absence of shell, executable-tool, credential, approval, and arbitrary-workspace authority.
- Automatic macOS tier and representative Windows GPU memory, context, cancellation, crash, and soak tests.
- Packaged offline first-launch tests with the exact pinned runtime and model artifacts.
- A superseding ADR before any second runtime is called certified.
