# Milestone M2 Status

Updated: 2026-07-20

M2 is complete across macOS and Windows. The repository owner subsequently activated M3 Offline Dev-Agent Desktop V1.

## Change Brief

- Goal: add the smallest supervised local inference path for structured generation and embeddings and prove its native authority boundary on macOS and Windows.
- Authority: the repository owner activated M2 on 2026-07-19 and requested macOS implementation followed by Windows completion on a separate machine.
- Product boundaries: Garden Desk Core resolves hash-pinned installed models, schedules profile memory, owns audit and cancellation, and receives only typed results. A worker receives one approved model path, sanitized environment, fixed stdio IPC, and no workspace, credential, approval, shell, tool, or external-network authority.
- Acceptance evidence: deterministic containment tests, physical macOS Seatbelt and Windows AppContainer authority probes, Qwen embedding smoke, Gemma 4 E2B grammar output, and Gemma 4 12B grammar output under Local 12 and Local 16 memory caps.
- Explicitly excluded: M3 agent behavior, model-download product behavior, arbitrary model paths, product UI, packaging, and final product certification.

## Implemented Scope

- `@gardendesk/shared` owns versioned generation, embedding, native-boundary probe, memory-report, and typed-failure schemas.
- Garden Desk Core verifies and stages immutable installed-model snapshots, schedules profile memory, supervises one-shot workers, owns audit and cancellation, and exposes programmatic generation and embedding methods.
- `@gardendesk/workers` owns one length-prefixed typed inference protocol, deterministic fake, supervised client, `node-llama-cpp` worker, and platform launchers.
- The macOS launcher uses Seatbelt to deny external networking, arbitrary host and workspace access, credential stores, writes outside job scratch, process forks, and executable launches except the fixed initial worker.
- The Windows launcher deploys an ignored, flat, reproducible runtime and uses a signed zero-dependency Rust helper to create a no-capability AppContainer, grant read access only to that runtime and the approved model, grant full access only to job scratch, sanitize the environment, apply a Job Object memory cap and one-process limit from launch, relay fixed inherited stdio, and kill the worker on helper teardown.
- Crash, cancellation, timeout, malformed IPC, missing or modified models, resource overlap, stdin failure, out-of-scope reads and writes, child Node re-execution, shell execution, and external-network access have focused containment tests.
- Downloaded models, generated reports, deployed runtimes, signed helpers, and build output remain ignored local evidence.

## Dependency Review

- The worker reuses the M0-reviewed, MIT-licensed, lockfile-pinned `node-llama-cpp` 3.19.0 runtime and platform packages; no new dependency or product network capability was added.
- Windows AppContainers deny the runtime's defensive GPU-binding compatibility fork. The tracked pnpm patch skips that fork only when the signed helper supplies `GARDEN_DESK_APPCONTAINER_LOCKED=1`; the Job Object already limits the worker to one process, and incompatible native loading remains crash-contained and audited.
- Runtime-specific types and the compatibility exception remain inside `@gardendesk/workers`; Garden Desk Core depends only on its inference port and shared schemas.
- The Windows Rust helper has no third-party crates and owns only AppContainer, ACL, Job Object, sanitized-launch, and lifecycle capabilities.

## macOS Evidence

- `pnpm test:gate --milestone 2`: pass on a 48 GiB Apple-silicon Mac after independent-review fixes.
- Seatbelt probe: external network, workspace, out-of-scope host read/write, credential, shell, executable-tool, and child Node authority denied.
- Qwen3-Embedding-0.6B: 1,024 dimensions; 1,007,274,336 GPU VRAM bytes and 169,748,832 CPU RAM bytes under the 2 GiB embedding reservation.
- Gemma 4 E2B: `{ "status": "ok" }`; 3,906,235,488 GPU VRAM bytes and 2,285,189,888 CPU RAM bytes under Local 12.
- Gemma 4 12B: `{ "status": "ok" }`; 8,139,500,736 GPU VRAM bytes and 845,475,552 CPU RAM bytes under both Local 12 and Local 16 caps; clean one-shot exit.

## Windows Evidence

- Host: Windows x64, NVIDIA GeForce RTX 4080 Laptop GPU with 12,282 MiB VRAM, 31.2 GiB system memory, Node 24.18.0, pnpm 11.13.1, and Rust 1.97.0.
- `pnpm verify`: pass; source limit, Biome, TypeScript, 50 unit tests with one platform skip, two native M1 tests, all Rust format/clippy checks, signed helper builds, and both platform microVM helper builds passed.
- M2 AppContainer project: one Windows test passed and the macOS test skipped; physical probes denied external network, arbitrary workspace and temp reads/writes, credential and shell environment, `cmd.exe`, and child Node execution.
- Qwen3-Embedding-0.6B: 1,024 dimensions; 1,005,177,168 GPU VRAM bytes and 169,748,896 CPU RAM bytes under the 2 GiB embedding reservation.
- Gemma 4 E2B: `{ "status": "ok" }`; 1,994,185,264 GPU VRAM bytes and 2,285,190,176 CPU RAM bytes under Local 12.
- Gemma 4 12B: `{ "status": "ok" }`; 8,139,499,872 GPU VRAM bytes and 845,475,808 CPU RAM bytes under both Local 12 and Local 16 caps; clean one-shot exit.
- `pnpm test:gate --milestone 2`: pass, including the complete repository verification, native authority gate, hash verification of all three pinned GGUFs, and four real-model canaries.

## Gate Interpretation

- The physical 12 GiB Windows GPU supplies the early Local 12-class target. The 48 GiB unified-memory Mac, exercised under the Local 16 cap, supplies the early Local 16-class target required before later LLM work.
- These are M2 loading, grammar, memory-cap, authority, and shutdown canaries. They are not final product certification; M3 still requires the complete agent, recovery, packaging, and desktop suite on both platforms.
- macOS and Windows implement the same typed inference contract and prove equivalent authority denials through their platform-native boundaries.

Conclusion: ready; cross-platform M2 is complete. Active M3 product evidence is recorded in [M3_STATUS.md](M3_STATUS.md).
