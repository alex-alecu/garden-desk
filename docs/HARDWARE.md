# Hardware

Created: 2026-07-10

Vault Desk should avoid manufacturing hardware initially. The product should own the software, workflows, customer experience, validation process, and support relationship while using OEMs or specialist builders for assembly, warranty, shipping, and replacement.

## Hardware Principles

- Market capabilities and supported workloads, not VRAM or parameter counts.
- Keep the community platform hardware-agnostic.
- Certify a small number of configurations.
- Classify all other hardware honestly.
- Avoid large inventory.
- Separate manufacturer warranty from Vault Desk support.
- Treat performance guarantees as a product feature.

## Hardware Classes

### Certified

Tested by Vault Desk for specific model profiles and workflows.

Certified hardware should include:

- Known CPU, GPU, memory, storage, and OS configuration.
- Validated local inference runtime.
- Benchmark result.
- Supported workflow list.
- Support eligibility.
- Recovery path.

### Compatible

Expected to work based on specs and runtime support, but not fully validated for a support guarantee.

### Experimental

May work for technical users. No guarantee and limited support.

## Community Target

Current community targets:

- 8 GB Macs do not start local inference and explain the requirement to the user.
- Macs through 16 GB use a 10 GiB model-plus-context budget; Macs through 24 GB use 12 GiB; Macs above 24 GB use 16 GiB.
- Windows selects one usable dedicated GPU first. If none is usable, it selects one integrated GPU. Brand and speed do not decide support, and the runtime never adds memory across devices.
- A Windows dedicated GPU needs at least 8 GiB of isolated device memory and uses that complete memory. An integrated GPU needs at least 16 GiB installed RAM and uses the 8/12/16 GiB shared-pool tier.
- Windows agent execution requires Windows Pro or Enterprise with Hyper-V already enabled. The Windows-only setup helper adds the requesting account to Hyper-V Administrators once; it does not enable or download Windows features. macOS has no administrator prerequisite.
- Active context is fitted automatically inside the selected budget. Shared-memory systems through 32 GiB installed RAM and Windows dedicated GPUs through 24 GiB are capped at 64K. Systems above the applicable threshold are capped at 128K.

The support class applies to an exact configuration, not to a GPU vendor. A configuration is Certified only after its complete physical and packaged gates pass. Other configurations that meet the implemented memory and isolation contract are Compatible. Untested future platforms are Experimental. The website and download surfaces must not describe a vendor as verified or an untested configuration as Certified.

The product should degrade by reducing active context pressure, multimodal usage, or concurrency rather than exposing low-level runtime choices to ordinary users. Hardware tiers must not differ by verification strictness, citation requirements, supported workflows, or safety policy.

Current model target:

- Gemma 4 12B QAT as the single default across the supported hardware-derived tiers.
- Approximate Q4_0 model-load memory target: 6.7 GB before KV cache and product overhead.
- Retrieval-first prompting and bounded active context.
- One resident Gemma generation at a time, with different conversations allowed to overlap guest work within the RAM-derived VM capacity.
- Background ingestion throttled around available memory.
- Automatic active context from an 8K floor through a 64K or 128K hardware cap. Shared memory needs more than 32 GiB installed RAM for 128K. Windows dedicated memory needs more than 24 GiB.
- One first desktop runtime and model format across Windows and macOS: node-llama-cpp with the pinned official Gemma 4 QAT GGUF, per [ADR 0013](adr/0013-first-desktop-runtime.md).
- A hardware capability check that selects the memory budget or returns a clear unsupported state before the user starts a model-dependent workflow.

See [PERFORMANCE_AND_CONTEXT.md](PERFORMANCE_AND_CONTEXT.md).

## Personal Computer Target

Initial personal systems should be standard Windows desktops or mini-PCs with high memory and validated local runtimes.

They should:

- Work as ordinary computers.
- Include Vault Desk and validated models.
- Be encrypted and recoverable.
- Ship with benchmarked performance.
- Default automatically to the validated bundled model. If a build includes multiple approved models, expose only those installed choices; a single-model build shows static model text with no selector.

Potential strategic fit:

- AMD high-memory unified-memory systems for compact personal or office boxes.
- NVIDIA systems for higher throughput office deployments.

## Office Appliance Target

Office appliances should be sized by workloads:

- Simultaneous users.
- Documents processed per hour.
- Maximum supported document sets.
- Expected report-generation time.
- Workflow packs enabled.
- Backup and storage needs.

Possible configurations:

- Compact AMD unified-memory mini workstation.
- NVIDIA GPU workstation for higher throughput.
- Larger NVIDIA appliance class for bigger models and concurrency.
- Later multi-node setups.

Current appliance stance:

- Do not choose a 64 GB default SKU before the automatic desktop tiers are validated.
- Treat Gemma 4 12B QAT with larger context and concurrency as the conservative later appliance baseline.
- Treat Gemma 4 31B dense QAT and Gemma 4 26B A4B QAT as later research candidates.
- Do not let larger-model appliance work change the desktop architecture.

The first office appliance should benchmark from real workflow demand, not from model-size appeal.

## Runtime Implications

Planned first-choice runtime directions:

- Apple Silicon: node-llama-cpp through Metal with the pinned official QAT GGUF first; MLX-family serving is a later adapter-backed optimization candidate.
- Windows: one package contains CUDA and Vulkan. The worker probes both and uses one adapter that it can map and isolate. CUDA has priority over Vulkan only for the same adapter. The user supplies a compatible display driver, not a separate Vault Desk installation.
- Shared appliance or Linux server: vLLM-class serving only after the automatic desktop tiers are validated and appliance profiles are re-opened.
- NVIDIA-specific optimization: later, after exact model support is proven.

Runtime certification must include the model format, quantization type, maximum stable active context, KV-cache behavior, multimodal behavior, and document-worker memory overhead.

Every automatic memory tier must also pass context-compaction stability. A configuration is not certified if it works only until the first context window fills.

## Benchmark Strategy

Benchmarks should measure:

- First-token latency.
- Inter-token latency.
- Tokens per second.
- End-to-end workflow latency.
- Peak VRAM and RAM.
- Indexing throughput.
- OCR throughput.
- Retrieval recall and citation precision.
- Tool-loop success rate.
- Crash and recovery behavior.
- Claim verification failure rate.
- Folder-level summary coverage.
- Large-folder resumability.
- Stable multi-compaction behavior over long folder sessions.

Tokens per second alone is not a product benchmark.

## Partnership Ladder

Recommended sequence:

1. Join vendor developer programs.
2. Request evaluation hardware and engineering contacts.
3. Build measurable workflow demonstrations.
4. Run small professional-office pilots.
5. Request pilot hardware, co-marketing, and OEM introductions.
6. Demonstrate that Vault Desk creates hardware demand.
7. Discuss strategic investment after traction.

Avoid company-wide exclusivity. Vendor-specific SKUs are acceptable, but the community product should remain hardware-agnostic.

## Revision History

| Date | Change |
|---|---|
| 2026-07-10 | Initial hardware strategy document created from supplied concept material. |
| 2026-07-10 | Added Gemma 4 12B QAT 16 GB target and 64 GB Gemma-family validation profiles. |
| 2026-07-10 | Added Q4_0 model-load memory caveats for Gemma 4 12B, 26B A4B, and 31B. |
| 2026-07-10 | Recentered certification on Local 12 and Local 16 with Gemma 4 12B QAT and context size as the only product capability difference. |
| 2026-07-11 | Aligned the first desktop runtime with ADR 0013 and made hardware capability classification an implementation gate. |
| 2026-07-22 | Added automatic macOS 10/12/16 GiB model-plus-context budgets, an unsupported 8 GB state, complete Windows GPU VRAM use, and automatic context fitting. |
| 2026-07-25 | Added the public V1 launch baseline of Apple silicon with at least 16 GB unified memory or Windows with NVIDIA and at least 12 GB VRAM, explicitly pending physical certification and signed installers. |
| 2026-07-27 | Defined one Windows package containing CUDA plus Vulkan, with bundled cuBLAS and no user-installed CUDA Toolkit. |
| 2026-07-28 | Physically validated the single package's CUDA and Vulkan initialization plus real-Gemma CUDA execution on an RTX 4080 and AMD Radeon 610M system. |
| 2026-08-01 | Added 64K and 128K context caps with separate Mac unified-memory and Windows VRAM thresholds. |
| 2026-08-04 | Restricted Windows automatic budgets and context tiers to one device's dedicated VRAM. |
| 2026-08-15 | Added vendor-neutral Windows dedicated-first selection and integrated 8/12/16 GiB shared-memory tiers. |
