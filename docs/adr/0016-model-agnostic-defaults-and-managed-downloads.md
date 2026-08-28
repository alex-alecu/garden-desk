# ADR 0016: Model-Agnostic Defaults And Managed Model Downloads

Date: 2026-07-15

## Status

Accepted. Partially supersedes [ADR 0007](0007-gemma-family-standard.md) and amends [ADR 0013](0013-first-desktop-runtime.md).

## Context

ADR 0007 standardized the first product on one primary model family (Gemma) for both generation and retrieval. Three findings during pre-M0 licensing and distribution review changed the trade-off:

1. EmbeddingGemma is the only stack asset outside Apache 2.0. It remains under the Gemma Terms of Use, whose distribution obligations (use-restriction flow-down into the product EULA, terms-copy delivery, Google's remote-restriction and termination-with-deletion rights, and the Prohibited Use Policy naming accounting, legal, and medical practice) attach to a paid offline product the moment the encoder ships in the installer.
2. The family coupling is product identity, not a technical dependency. The encoder and the generator never share weights, runtime state, or vector spaces at a contract boundary, and EmbeddingGemma is itself a Gemma 3-derived model, not Gemma 4. Independent evaluation found Apache 2.0 encoders at equal or better verified retrieval quality.
3. The product direction now includes a build that ships without a generation model and lets the user install one through a managed, non-technical download experience, which a single-family rule and the absolute no-downloader rule both prohibit.

## Decision

### 1. Model-agnostic contracts, per-model certification

Product contracts (runtime adapter, retrieval, evidence, verification, workflow eligibility, manifests) are model-agnostic. No product subsystem may require a specific model family. Certification remains per model, runtime build, and hardware profile: a workflow is eligible on a model only after that combination passes the same gates. Gemma 4 12B QAT stays the default and first certified generation model across the hardware-derived tiers in amended ADR 0009; nothing else about its selection in ADR 0013 changes.

### 2. Default dense encoder: Qwen3-Embedding-0.6B

The default dense encoder is Qwen3-Embedding-0.6B (Apache 2.0), pinned to the official `Qwen/Qwen3-Embedding-0.6B-GGUF` release and served by node-llama-cpp exactly as ADR 0013 already provides for embeddings. The encoder is product-managed, never user-selected, and is bundled in every build flavor so retrieval and indexing work offline out of the box in both flavors. EmbeddingGemma is demoted from default to validated alternative; it may not ship in the installer without a dedicated Gemma Terms of Use distribution review. Retrieval defaults (768-dimension start, Matryoshka reduction only after recall tests, hybrid lexical pairing) carry over; the encoder's 32K input context removes the previous 2K chunk-size ceiling as a hard constraint, but chunk sizing stays governed by retrieval quality tests, not the new maximum.

### 3. Two distribution flavors

- **Bundled build** — the M3 V1 target: every required runtime, model, helper, and guest asset is packaged as `ships`, first launch completes with zero downloads, and the build contains no downloader.
- **Model-download build** — a post-V1 option that ships required runtimes and adds managed generation-model installation from Hugging Face. It is the first possible integration of the typed Vault Core network broker reserved for external connections and requires a new owner decision.

### 4. Managed download boundary

Model download is a Vault Core capability behind the typed network broker, not a general network path:

- The broker allows only the pinned model-host destinations, verifies TLS, and verifies the SHA-256 of every downloaded artifact against a signed catalog entry before the model becomes loadable.
- A signed, product-supplied catalog defines recommended models ranked by detected hardware fit, and name search resolves only within allowlisted official publisher repositories serving GGUF assets. Arbitrary URLs, arbitrary local paths, unsigned catalog entries, and gated repositories requiring per-user license acceptance are out of scope for the first release of this flavor.
- Downloaded models are recorded in the installed-model registry with hashes and license identity, classified Certified, Compatible, or Experimental using the V1 hardware-capability classification, and workflow eligibility continues to require certification per decision 1.
- Downloads are explicit user actions with visible progress, resume, and cancellation. No silent fetch, no background update, no telemetry. Workers, microVMs, and the webview gain no network capability; the no-network and broker invariants of ADR 0012 and SECURITY.md are unchanged.
- The user experience presents recommendations first, then search by model name; the paired encoder is automatic (bundled by default, overridable only by a signed catalog entry that triggers an explicit re-index); runtime, quantization, and endpoint vocabulary stays out of the ordinary flow per DESKTOP_DESIGN.md.

## Consequences

Positive:

- The shipped stack becomes fully Apache 2.0, deleting the Gemma Terms of Use distribution burden from the installer, the EULA, and the V1 notice gate.
- Development fetches simplify: the encoder repository is ungated, so CI needs no Hugging Face tokens.
- The lean flavor gives users hardware-appropriate model choice without exposing AI infrastructure, and the bundled flavor's offline guarantees are untouched.
- Encoder changes after the post-V1 document-intelligence follow-up would require re-embedding and re-running retrieval gates.

Negative:

- The "one family" product message is gone; the support surface grows with each additionally certified model, bounded by per-model certification.
- The model-download build adds a real network capability that must be built and audited to the broker standard, and its catalog becomes a signed asset to maintain.
- Qwen3-Embedding retrieval thresholds are research-derived until the post-V1 document-intelligence follow-up measures them on Garden Desk corpora.
- MTEB comparisons informing the encoder swap mix overall and retrieval-subset scores; the post-V1 held-out gate is the deciding measurement.

## Follow-ups

- The Knowledge Bundle format-and-trust ADR reserved during M0 planning is renumbered to `docs/adr/0017-knowledge-bundle-format-and-trust.md`.
- M0 validates Qwen3-Embedding-0.6B GGUF loading and embedding smoke behavior through node-llama-cpp on macOS and Windows before the encoder decision is treated as confirmed; failure reopens this ADR's decision 2 only.
