# M1 Windows HCS Helper Dependency Review

Updated: 2026-07-18

## Dependency Review

- Capability and milestone: M1 needs a signed Windows helper that owns only HCS microVM lifecycle, no-network configuration, CPU and memory limits, SCSI attachments, typed Hyper-V socket transport, and teardown.
- Existing repository alternative: the M0 C# probe proved the required `computecore.dll` and Winsock calls but was test-only and could not satisfy the planned signed Rust product boundary.
- Candidate and pinned version or revision: minimal owned Rust FFI compiled with the repository's pinned Rust 1.97.0 toolchain and Windows SDK; no third-party crate. Microsoft `hcsshim` schema evidence is pinned to commit `0e72fa7fbe61ef5082df6f99427821a5102f325c`.
- Primary sources: [Microsoft HCS API overview](https://learn.microsoft.com/en-us/virtualization/api/hcs/reference/apioverview), [HcsCreateComputeSystem](https://learn.microsoft.com/en-us/virtualization/api/hcs/reference/hcscreatecomputesystem), [Hyper-V socket integration services](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/make-integration-service), [HCS schema reference](https://learn.microsoft.com/en-us/virtualization/api/hcs/schemareference), and the Microsoft `hcsshim` [SCSI attachment schema](https://github.com/microsoft/hcsshim/blob/0e72fa7fbe61ef5082df6f99427821a5102f325c/internal/hcs/schema2/attachment.go).
- License and redistribution: the helper is project-owned Apache-2.0 source. It links only to Windows system APIs and the Rust standard library; no new redistributable dependency or notice is introduced.
- Offline, telemetry, network, and credential behavior: compilation and execution require no package download, telemetry, credential, or network API. The HCS document contains no network adapter and exposes one fixed Hyper-V socket service rather than an IP transport.
- Footprint, native code, and platforms: one Windows x64 Rust executable plus a zero-third-party `Cargo.lock`; unsupported hosts use the TypeScript adapter's explicit platform refusal.
- Security and maintenance: direct FFI increases owned ABI review work, bounded here to HCS lifecycle, per-VM ACL grants for already-authorized staged attachments, and Winsock functions. Handles use scoped cleanup, frames are length-bounded and schema-fixed, and helper output is revalidated by `@gardendesk/shared`.
- Adapter fit: the helper sits behind the existing `MicroVmLauncher` contract and contains no policy, filesystem authorization, parsing, workflow, external-network, or model behavior.
- Validation result: the elevated Windows M1 platform gate validated HCS authority requirements, fixed-VHD attachments, per-VM attachment ACLs, zero configured network adapters, the fixed Hyper-V socket round trip, bounded cleanup, and development signing on the current Windows x64 host. Release signing and packaging are now part of M3.
- Decision: adopted and certified for M1. A third-party Windows binding would add transitive code without reducing the narrow, already-known API surface; a shell or process-only fallback cannot satisfy certification.
