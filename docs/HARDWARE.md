# Hardware

Created: 2026-07-10

Garden Desk should avoid manufacturing hardware initially. The product should own the software, workflows, customer experience, validation process, and support relationship while using OEMs or specialist builders for assembly, warranty, shipping, and replacement.

## Hardware Principles

- Market capabilities and supported workloads, not VRAM or parameter counts.
- Keep the community platform hardware-agnostic.
- Certify a small number of configurations.
- Classify all other hardware honestly.
- Avoid large inventory.
- Separate manufacturer warranty from Garden Desk support.
- Treat performance guarantees as a product feature.

## Hardware Classes

### Certified

Tested by Garden Desk for specific model profiles and workflows.

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

Current community targets follow [ADR 0019](adr/0019-qwen38-private-server.md).

- Mac: at least 24 GiB installed memory, with a 16 GiB inference budget, 4 GiB for the host, and 4 GiB per microVM.
- Windows: one dedicated GPU with at least 16 billion bytes, or one integrated GPU with 16 GiB usable allocation and at least 24 GiB installed memory. Reserve host memory before admitting microVMs. CUDA and Vulkan retain device identity and isolation checks.
- Generation: Qwen3.8 27B Q4, fixed 32K context, all weights and context state on one GPU. No automatic fitting or CPU fallback.
- Windows agent execution requires Pro or Enterprise with Hyper-V enabled. The setup helper only adds the requesting user to Hyper-V Administrators.

Memory admission is not certification. Exact hardware still needs physical evidence. Mac verification is pending.

## Personal Computer Target

Initial personal systems should be standard Windows desktops or mini-PCs with high memory and validated local runtimes.

They should:

- Work as ordinary computers.
- Include Garden Desk and validated models.
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

- Apple Silicon: the pinned llama.cpp server through Metal with Qwen3.8 Q4 first; MLX-family serving is a later adapter-backed optimization candidate.
- Windows: one package contains CUDA and Vulkan. The worker probes both and uses one adapter that it can map and isolate. CUDA has priority over Vulkan only for the same adapter. The user supplies a compatible display driver, not a separate Garden Desk installation.
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
6. Demonstrate that Garden Desk creates hardware demand.
7. Discuss strategic investment after traction.

Avoid company-wide exclusivity. Vendor-specific SKUs are acceptable, but the community product should remain hardware-agnostic.
