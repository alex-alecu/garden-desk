# ADR 0004: Hardware Abstraction

Created: 2026-07-10

Status: Proposed; initial desktop runtime directions superseded by ADR 0013

## Context

Vault Desk should support Apple, AMD, and NVIDIA hardware. No single vendor path should become the permanent product identity.

The local AI runtime market is changing quickly, and runtime support differs across platforms.

## Decision

Vault Desk will use a hardware-aware runtime adapter strategy.

The user-facing product should expose capability tiers and workload guarantees, not low-level model or runtime choices.

Initial runtime directions were originally proposed as:

- Apple Silicon: MLX-family path.
- Windows with NVIDIA: llama.cpp or Ollama-compatible path first.
- AMD desktop: llama.cpp with HIP or Vulkan first.
- Office appliance or stronger server: vLLM-class path where validated.

[ADR 0013](0013-first-desktop-runtime.md) supersedes these desktop ordering details. The first Windows and macOS certification now uses node-llama-cpp with the pinned official QAT GGUF. MLX remains a later adapter-backed Apple Silicon optimization. The hardware-abstraction decision itself remains unchanged.

## Consequences

Positive:

- Keeps the community platform hardware-agnostic.
- Allows certified hardware tiers.
- Avoids vendor lock-in.

Negative:

- More testing work.
- More runtime adapter complexity.
- Different platforms may have different feature timing.
