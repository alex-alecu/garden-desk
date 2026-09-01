# Milestone M0 Status

Updated: 2026-07-17

Milestone M0 is complete. The Mac and Windows checkpoints and published cross-platform CI pass. M1 subsequently completed across macOS and Windows on 2026-07-18; this file remains the historical M0 record.

## Change Brief

- Goal: establish the smallest reproducible Garden Desk workspace and validation surface required by M0.
- Active milestone and issue: M0, started by the repository owner's explicit 2026-07-16 request; no separate issue was supplied.
- Allowed scope: phase-rule updates, Apache 2.0 root license, pinned Node/pnpm/Rust and root tooling, M0-only `shared` and `eval` packages, model and compliance manifests, test-only Tauri and microVM probes, guest-image recipe, ADR 0017, and macOS/Windows CI.
- Product boundaries: model manifests are canonical in `@gardendesk/shared`; model fetching remains development-only in `@gardendesk/eval`; Tauri exposes only a fixed test command and exact sidecar; hostile-work validation requires a no-network guest and typed host/guest IPC; no product UI or external integration is introduced.
- Explicitly not doing: M1 daemon/CLI/workspace/worker code, product UI, customer-document handling, external integrations, model redistribution, committed binaries, or contribution activation.

## Gate State

- Overall status: complete; every M0 gate has recorded evidence.
- Mac checkpoint: pass on macOS 26.5.2 arm64.
- Windows checkpoint: pass on Windows x64, including an elevated HCS guest boot.
- M1 authorization: not granted.

| Gate | Evidence | State |
|---|---|---|
| Root license and compliance owners | `LICENSE`; `compliance/inventory.json`; unit inventory assertion | Pass |
| Deterministic development and held-out corpora | Generic offline-agent tasks cover all six required classes; anchors are checked against decoded fixture content | Pass |
| Model manifest and real load | Official Qwen Q8_0 exact bytes/SHA-256; 1,024-dimensional embedding smoke | Pass on Mac and Windows |
| Local pinned workspace | Locked install and complete verification | Pass on Mac and Windows |
| macOS and Windows CI | Immutable action pins and `macos-26` / `windows-2025` jobs | Pass in published run `29556828274` |
| Tauri packaging and capability shell | Signed Node SEA, fixed sidecar identity, capability assertions, Rust Clippy, no-bundle build, runtime webview denial | Pass on Mac and Windows |
| No-NIC microVM | Reproducible arm64/x86_64 hashes; exact guest boot; zero configured NICs; guest reports zero non-loopback devices; typed socket round trip | Certified on Mac and Windows |
| Knowledge Bundle decision | ADR 0017; deterministic tar and Ed25519 validation; selected TUF library loads | Pass for M0 scope |
| M0 structural decisions | Owning manifests, configuration, ADR, and blueprint record each M0 decision | Pass |

## Mac Verification Report

- `GARDEN_DESK_BUILDROOT_ARCHIVE=/tmp/buildroot-2026.05.tar.xz pnpm guest:build -- --arch aarch64` — two clean builds in disposable Docker volumes produced identical outputs; the second ran with Docker networking disabled.
  - Kernel SHA-256: `211d283fafe9e094e614629ef21f8616cdce24c5e4b43b936c4c73a3e447e7bd`.
  - Initramfs SHA-256: `d7ea5c8df6da1faa9fd6aaf7109833be45dc3b208515977b0021ea478715e3c9`.
- `pnpm model:fetch --id qwen3-embedding-0.6b-q8_0 --destination /tmp/qwen3-embedding-0.6b-q8_0.gguf` — downloaded the official immutable Qwen artifact and matched SHA-256 `06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439`.
- `pnpm test:gate --milestone 0 --model /tmp/qwen3-embedding-0.6b-q8_0.gguf` — passed again after the Windows pull and final runtime-evidence change: source limits, Biome, TypeScript, 17 unit assertions, two native assertions, SEA packaging/signing, Rust formatting/Clippy, Tauri build, real model load, and certified macOS guest boot.
- Platform result: `classification: certified`, `noNetworkDeviceConfigured: true`, `typedSocketConfigured: true`, `guestBooted: true`, `socketRoundTrip: true`, and guest non-loopback count `0`.
- A real Mac webview launch emitted `{"arbitraryCommandDenied":true,"sidecar":{"capability":"fixed-sidecar","protocolVersion":1,"status":"ok"}}` through the existing core event channel.
- `pnpm verify` and `pnpm tauri:check` — passed again after checkpoint review and the generated-icon policy fix.
- `git diff --check` — passed before final staging.

## Windows Verification Report

- `pnpm guest:build -- --arch x86_64` plus an independent no-network rebuild produced byte-identical outputs.
  - Kernel SHA-256: `ec0364eab93e9a12e4f5ef3008207331b03ef32a23dd9b0fc0f8c197fb126e45`.
  - Initramfs SHA-256: `8cb33d5265fe1cbf4233154e2a93496d295275356409af19386e913334b61f89`.
- `pnpm verify` passed source limits, Biome, TypeScript, 16 unit assertions, two native assertions, Windows SEA signing, Rust formatting, and Clippy.
- `pnpm tauri:check` built the Windows Tauri shell. A real webview launch returned the fixed sidecar payload and `arbitraryCommandDenied: true`.
- `pnpm model:fetch --id qwen3-embedding-0.6b-q8_0 --destination packages/eval/.generated/qwen3-embedding-0.6b-q8_0.gguf` matched SHA-256 `06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439`.
- The real model smoke loaded that GGUF and produced a 1,024-dimensional embedding.
- The non-privileged M0 gate passed verification, Tauri build, and the real model smoke; the HCS portion ran separately at its required administrator boundary.
- The elevated HCS helper booted the exact pinned guest and returned `networkDeviceCount: 0`, `socketDeviceCount: 1`, guest `nonLoopbackNetworkDeviceCount: 0`, `protocolVersion: 1`, `status: ok`, and `transport: vsock`.
- After the HCS configuration preflight fix, `pnpm verify`, `pnpm tauri:check`, the real model smoke, and `git diff --check` passed locally again.
- GitHub Actions run `29556828274` passed the complete hosted `macos-26` and `windows-2025` jobs after fixing pnpm shim activation and Windows PowerShell module isolation.

## Caveats

- `node-llama-cpp` logged a Metal shader source compilation error, then successfully loaded the model and produced the expected embedding through fallback. M0 model correctness passes; accelerated Metal performance remains unproven.
- The first two GitHub-hosted attempts exposed pnpm shim activation and inherited PowerShell module-path defects. Both are fixed; published run `29556828274` passes on macOS and Windows.
- Guest artifacts and the model remain ignored development outputs and are not committed.

## Attempted Fixes Recorded

- Docker Desktop bind-mounted kernel extraction raced with a directory rename. Build trees now use isolated Linux-native Docker volumes; final artifacts and downloads remain inspectable, and volumes are removed after comparison.
- Virtualization.framework rejected the unsigned helper. The test-only binary is now ad-hoc signed with only `com.apple.security.virtualization`.
- The socket API asserted its dispatch queue. The Swift entrypoint and connection retry now run on the main actor.
- Buildroot's QEMU kernel config creates `dummy0` by default. The boot command sets `dummy.numdummies=0`; the unchanged hashed guest then reported zero non-loopback devices.
- HCS rejected the first hand-built configuration because of an extra JSON closing brace. The helper now prints its configuration for a Node JSON/no-network-adapter preflight before HCS receives it; the corrected elevated boot passed.
- macOS Accessibility exposed the smoke window but not its webview body. The webview now emits bounded runtime evidence through the already-enabled core event channel, and the Rust test host prints only that named event; no capability or screen capture was added.

## Handoff

- Objective and current state: M0 is complete on macOS and Windows with published CI evidence; M1 subsequently completed across both platforms.
- Changed paths: root workspace and policy files, M0 `shared` and `eval` packages, the Tauri and microVM probes, Buildroot guest recipe, model/compliance manifests, CI, ADR 0017, and supporting M0 documentation.
- Decisions and source links: use the official immutable Qwen Q8_0 artifact recorded in `assets/models.json`; use a reproducible Buildroot no-network guest with typed VSOCK IPC; keep generated guests, models, executables, and icons out of Git.
- Commands and results: the exact Mac and Windows build, model, gate, platform, Tauri runtime, and post-review verification evidence is recorded above; all required M0 checks pass.
- Failures and attempted fixes: the Docker bind-mount race, Virtualization.framework signing and dispatch issues, Buildroot `dummy0`, and generated-icon policy issue are resolved as recorded above.
- Open risks or questions: accelerated Metal performance remains outside the proven M0 model-correctness evidence.
- Windows state: the elevated HCS lifecycle, no-network assertion, guest report, and Hyper-V socket round trip pass.
- Published CI state: run `29556828274` passes both required jobs.
- Completion rule: satisfied on 2026-07-17. The separately authorized M1 milestone completed on 2026-07-18.
