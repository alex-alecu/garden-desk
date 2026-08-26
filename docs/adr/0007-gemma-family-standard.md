# ADR 0007: Gemma Family Standard

Created: 2026-07-10

Status: Accepted, amended by [ADR 0009](0009-12-16gb-gemma-context-standard.md); partially superseded by [ADR 0016](0016-model-agnostic-defaults-and-managed-downloads.md), which removes the single-family mandate and the EmbeddingGemma default while keeping Gemma 4 12B QAT as the default and first certified generation model

## Context

The original architecture allowed broad model abstraction. That remains useful internally, but Vault Desk needs a simpler and more supportable product identity.

The current product focus is Gemma 4 12B QAT across the automatic hardware-derived memory tiers, with Qwen3-Embedding-0.6B for retrieval and Gemma-family tool and safety capabilities where validated.

## Decision

Vault Desk will standardize its first certified architecture around the Gemma family.

The first product profile is:

- Gemma 4 12B QAT on supported macOS and Windows hardware.
- Hardware-derived model-plus-context budgets and automatically fitted active context as the only capability difference.
- Qwen3-Embedding-0.6B as the default dense encoder, per ADR 0016.

Gemma 4 31B dense, Gemma 4 26B A4B, and larger-context appliance profiles are deferred research paths.

The runtime adapter layer remains replaceable, but the product should not expose arbitrary model-family selection to ordinary users.

## Consequences

Positive:

- Clearer support matrix.
- Easier benchmarking and certification.
- More consistent behavior across hardware tiers.
- Simpler product message.
- Better chance of building robust document-specific evaluations.

Negative:

- Less flexibility for users who prefer other model families.
- Gemma runtime support becomes a gating risk.
- The product must validate every automatic memory tier for active context, latency, and compaction stability.
