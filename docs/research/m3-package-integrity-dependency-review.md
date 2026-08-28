# M3 Package Integrity Dependency Review

Updated: 2026-07-28

## Dependency Review

- Capability and milestone: the non-elevated M3 Windows desktop must authenticate and lock its packaged Core and sensitive native helpers, including the one-time elevated Hyper-V membership helper, before executing them.
- Existing repository alternative: Rust's standard library has no SHA-256 implementation. Windows signature trust is not usable for the current ephemeral development signatures, and custom cryptography would create unnecessary security risk.
- Candidate and pinned version or revision: RustCrypto `sha2` 0.10.9, already resolved in the desktop lockfile through Tauri with registry checksum `a7507d819769d01a365ab707794a4084392c824f54a7a6a7862f8c3d0892b283`.
- Primary sources: the locked crate metadata and bundled README identify the RustCrypto source, SHA-2 scope, pure-Rust implementation, and Rust 1.41 minimum.
- License and redistribution: MIT OR Apache-2.0 with both license texts present in the pinned crate source.
- Offline, telemetry, network, and credential behavior: deterministic in-process hashing only; no network, telemetry, credential, filesystem-discovery, or process behavior.
- Footprint, native code, and platforms: no new resolved package; the default implementation is portable Rust and reuses the already locked `digest`, `cfg-if`, and `cpufeatures` dependencies.
- Security and maintenance: RustCrypto is the existing Tauri dependency source for SHA-256. Garden Desk uses only streaming SHA-256 and keeps package policy in the desktop host.
- Adapter fit: build-time hashes are embedded in the signed application; runtime hashing occurs before the fixed sidecar and sensitive helpers launch, and locked read handles prevent replacement until shutdown. The Windows setup helper receives the same verification and lock before its isolated UAC launch; the desktop and Core remain non-elevated.
- Research-derived claims to validate: the final Windows package must rerun tamper rejection and normal launch with the release build.
- Decision: **adopt** for the M3 Windows package integrity boundary.
