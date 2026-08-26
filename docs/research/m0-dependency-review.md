# M0 Dependency Review

Created: 2026-07-16

Status: accepted for M0 development and validation only. Packaging, redistribution, performance, and platform claims remain research-derived until the corresponding milestone gate records executable evidence.

## Decision Scope

M0 needs a pinned TypeScript workspace, schema validation, tests, native dependency smoke checks, a test-only Tauri shell, Node executable packaging, deterministic archive construction, TUF-style metadata validation, signatures, and a reproducible minimal guest-image input. The direct inventory is machine-readable in [`compliance/inventory.json`](../../compliance/inventory.json); transitive JavaScript and Rust resolutions are owned by their lockfiles.

## Adopted Dependencies

| Boundary | Decision | Reason and containment |
|---|---|---|
| Schema validation | Adopt Zod behind `@vault/shared` schemas | Small typed boundary; no network or native component. |
| Native persistence and inference smoke | Adopt better-sqlite3 and node-llama-cpp for M0 validation | These are already selected architectural defaults. M0 proves loadability only; product adapters arrive in later milestones. Both may execute install scripts and are the only runtime dependencies allowed to do so. |
| Test and source tooling | Adopt TypeScript, tsx, Vitest, and Biome | Development-only, pinned, and directly exercised by `pnpm verify`. |
| Tauri smoke shell | Adopt Tauri v2 with the shell plugin | Test-only shell with a single fixed command and capability file; no product UI or product policy. Tauri documents sidecar configuration and scoped capabilities. |
| Node executable packaging | Adopt Node 24 single-executable applications plus postject | Node 24 requires blob injection into a copied Node binary. The build enforces the pinned Node version, records the source-binary hash, and signs only after injection. This choice is provisional until its Windows and macOS CI build gates pass. |
| Knowledge Bundle archive reader | Retain tar-stream as a reviewed post-V1 candidate | Streaming and minimal, but hostile archive inspection stays inside the no-network guest. It is not a trust boundary. |
| Knowledge Bundle trust metadata | Retain tuf-js direction plus Node Ed25519 verification for post-V1 review | TUF supplies rollback/expiry/version metadata semantics; Node crypto supplies the signature primitive. Core will own policy and installed state if the deferred capability is activated. |
| Guest image input | Adopt Buildroot 2026.05 source input | Its source archive and custom Linux source are hash-pinned. The arm64 kernel/rootfs hashes were reproduced independently; x86_64 remains pending. |
| Guest image builder | Adopt Buildroot's `20250218.2110` CI image by registry digest | This is the builder named by the pinned Buildroot release's CI configuration. It runs only development builds in disposable volumes; the offline second build must reproduce the first. |

## Platform Boundary Decisions

- macOS: use a narrow Swift helper around Virtualization.framework. The configuration begins with no network devices and exposes only lifecycle, bounded resources, a read-only image, and a typed VSOCK channel.
- Windows: use a narrow Rust helper around Host Compute Service with Hyper-V sockets. It may expose the same lifecycle/resource/socket surface and must never create a virtual network adapter.
- Neither helper owns product policy, filesystem authority, general networking, parsing, inference, or audit decisions. Process-only fallback is explicitly non-certified.
- The helper packages begin in M1. M0 owns only probes, build inputs, compatibility classification, and the evidence needed to keep the choice honest.

## Rejected Or Deferred Options

- Generic VM CLIs are rejected as the certified boundary because command-line configuration is not a stable typed proof of zero virtual NICs.
- A custom archive, signature scheme, TUF implementation, SQLite binding, inference runtime, or test framework is rejected because maintained dependencies satisfy the narrow adapters with less security-sensitive code.
- OpenCode is deferred unless the later code-interpreter benchmark proves it reduces shipped code while meeting identical offline, isolation, audit, and footprint gates.
- Knowledge Bundle transport is deferred until after V1. Selecting compression now would add an unused dependency and prematurely stabilize a transport.

## Security, Offline, And Supply-Chain Findings

- Runtime network access is not required by the adopted schema, database, archive, signature, or test libraries. Model fetching is development-only, URL-allowlisted, byte-counted, and hash-verified before atomic rename.
- better-sqlite3, node-llama-cpp, and esbuild are the only pnpm build-script allowlist entries. All direct versions and CI actions are exact; the GitHub actions use immutable commit hashes.
- No model is approved to ship merely because it appears in the manifest. A `ships` transition requires an explicit approval record and still remains subject to its upstream license and notice obligations.
- Buildroot output and model binaries are not committed. Any future distribution requires a generated notice bundle and a fresh compliance review of resolved transitive and bundled native components.
- The builder image contains mixed native development tools, has network access only during the first input-fetching build, receives no credentials, and is not redistributed. Buildroot and the image are thin build inputs rather than product adapters. Compatibility beyond the exercised arm64 host remains research-derived.

## Primary Sources

- [Node.js single executable applications](https://nodejs.org/docs/latest-v24.x/api/single-executable-applications.html)
- [Tauri sidecar documentation](https://v2.tauri.app/develop/sidecar/)
- [Tauri capability documentation](https://v2.tauri.app/security/capabilities/)
- [Apple Virtualization framework](https://developer.apple.com/documentation/virtualization)
- [Windows Host Compute Service](https://learn.microsoft.com/en-us/virtualization/api/hcs/overview)
- [Buildroot 2026.05 release](https://buildroot.org/downloads/buildroot-2026.05.tar.xz)
- [Buildroot manual: official CI builder image](https://buildroot.org/downloads/manual/manual.html#submitting-patches)
- [The Update Framework specification](https://theupdateframework.github.io/specification/latest/)

## M0 Revalidation Required

Before M0 closes, CI must prove the locked native dependencies and Tauri packaging on both supported operating systems. macOS arm64 has booted the pinned guest, round-tripped the typed socket, and shown zero virtual network adapters. Windows x86_64 and hosted CI remain required, so this review does not claim full cross-platform certification.
