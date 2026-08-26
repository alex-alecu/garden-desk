# Milestone M1 Status

Updated: 2026-07-19

M1 is complete across macOS and Windows. M2 was not authorized at M1 closure, was activated by the repository owner on 2026-07-19, and completed on 2026-07-20.

## Change Brief

- Goal: implement the smallest cross-platform workspace, security, daemon, CLI health, worker-protocol, and certified no-network microVM foundations.
- Authority: M1 was activated by the repository owner's explicit 2026-07-17 request and closed on 2026-07-18 after the final Windows daemon endpoint gate passed.
- Product boundaries: Vault Core alone owns authoritative workspace mutation; local RPC authenticates current-user-only endpoints and has no TCP mode; workers receive bounded already-authorized staged inputs and bounded scratch under one cancellation deadline; certified guests have no virtual NIC and accept only the fixed typed socket protocol.
- Dependencies at M1 closure: `better-sqlite3` was the only consumed package addition. M3 later moved product Core persistence to the Node 24 built-in `node:sqlite`; `better-sqlite3` remains only in historical M1 evaluation coverage. The Swift and Rust helpers use system frameworks or APIs and pinned standard-library toolchains. The Windows pipe guard adds no third-party crate.
- Excluded: M2 inference, parsers, product UI, external networking, model acquisition, production packaging, and later-milestone behavior.

## Gate State

- Shared M1 implementation: pass.
- macOS implementation and physical certification: pass.
- Windows implementation and physical HCS certification: pass.
- Windows daemon current-user endpoint gate: pass.
- Full M1 milestone: complete.
- M2 authorization at M1 closure: not granted; subsequently granted on 2026-07-19.

## Shared Evidence

- Workspace gates cover traversal, symlink or junction escape, captured-file replacement, single-writer refusal, stable identity, immutable atomic artifact writes, killed SQLite transaction rollback, audit redaction, hash-chain tamper detection, anchored-tail truncation detection, and version-one audit-head migration.
- Daemon gates cover canonical workspace endpoint identity, start, health, `vault status --json`, exact single-document stdout, protocol incompatibility, same-user endpoint access, spoof rejection, restart, abrupt kill, stale-lock recovery, helper teardown with its parent, and catalog reopening.
- Worker gates reject non-schema forwarding frames, bound frame sizes and staged input count/bytes, remove partial over-limit copies, and apply cancellation and wall time to staging as well as native execution.
- `pnpm verify` covers source limits, Biome, TypeScript, unit and native suites, Rust formatting and Clippy, signed test-sidecar construction, all native helper builds, and platform-appropriate skips.

## macOS Evidence

- The production arm64 guest was built twice from Buildroot 2026.05 in disposable volumes; the second build had Docker networking disabled and matched the first byte-for-byte.
  - kernel SHA-256: `211d283fafe9e094e614629ef21f8616cdce24c5e4b43b936c4c73a3e447e7bd`.
  - initramfs SHA-256: `b63fd1a7677b7f6b3e3b7cd9c95eeba9c313f0f8a34f85457491f82a3334ed4e`.
- The signed Swift helper booted the recorded guest with zero configured network devices, one VSOCK device, one read-only staged input, 8 MiB bounded scratch, zero guest non-loopback interfaces, and passing DNS, IPv4, IPv6, LAN, multicast, and host-reachability denial probes.

## Windows Evidence

- The production x86_64 guest was built twice from Buildroot 2026.05 with matching output.
  - kernel SHA-256: `ec0364eab93e9a12e4f5ef3008207331b03ef32a23dd9b0fc0f8c197fb126e45`.
  - initramfs SHA-256: `cdf5a631ee8cc7aabb5def990de9beb922221acf5a46dc51ce2492498b225986`.
- An elevated physical Windows x64 HCS boot returned `certified`: zero configured network devices, one fixed Hyper-V socket service, one read-only staged input, 8 MiB bounded scratch, zero guest non-loopback interfaces, and all network-denial probes passing. The platform project completed in about 31 seconds.
- The signed pipe guard creates the named-pipe instance with `PIPE_REJECT_REMOTE_CLIENTS`, an explicit current-user owner, and a protected DACL granting access only to that user. The CLI opens and verifies the owner and exact DACL on the same handle before exchanging data, so a predictable-name spoof is rejected. The helper relays opaque bytes over inherited stdio and enforces the request ceiling supplied by TypeScript; TypeScript retains canonical endpoint naming, limit definition, JSON parsing, RPC dispatch, and product policy.
- Before enforcement, the live Node/libuv descriptor was `D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;S-1-5-21-2956651453-1646027870-1593765367-1001)(A;;FR;;;WD)(A;;FR;;;AN)` and exposed Everyone and Anonymous read ACEs.
- After enforcement, the live DACL is `D:P(A;;FA;;;S-1-5-21-2956651453-1646027870-1593765367-1001)`. A restricted token with the current-user SID disabled is denied, while same-user RPC, authenticated CLI status, EOF behavior, forced-parent-exit cleanup, and daemon restart are gate requirements.
- The pipe-guard dependency decision is recorded in [research/m1-windows-pipe-guard-dependency-review.md](research/m1-windows-pipe-guard-dependency-review.md); the HCS decision remains in [research/m1-windows-dependency-review.md](research/m1-windows-dependency-review.md).

## Remaining Risks And Deferrals

- Generated guests, signed helpers, packaged sidecars, build output, coverage, and dependency directories remain local ignored artifacts and are not committed.
- Development signing proves intact helper identity; release certificate management, notarization, installer ACLs, notices, and packaged artifact verification are now part of the M3 desktop gate.
- Hosted CI classifies each available platform backend but does not replace the recorded elevated physical-host HCS or macOS hardware certification.
- Node does not expose a durable Windows directory-handle flush equivalent; M1 still fsyncs file contents and verifies atomic replacement, SQLite recovery, and abrupt-termination behavior on Windows.
- M2 subsequently completed and is tracked separately in [M2_STATUS.md](M2_STATUS.md); active M3 product evidence is recorded in [M3_STATUS.md](M3_STATUS.md).

Conclusion: ready; M1 remains complete. Current M2 and M3 evidence is recorded separately.
