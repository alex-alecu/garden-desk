# M1 Windows Pipe Guard Dependency Review

Updated: 2026-07-18

## Dependency Review

- Capability and milestone: M1 requires every Windows daemon pipe instance to deny access outside the current user before accepting RPC.
- Existing repository alternative: Node 24 `node:net` owns the transport but exposes no named-pipe security descriptor. Its libuv backend creates each pending instance with a null security descriptor, so post-listen ACL mutation is incomplete and racy.
- Candidate and pinned version or revision: minimal owned Rust FFI compiled with the repository's pinned Rust 1.97.0 toolchain and Windows SDK; no third-party crate.
- Primary sources: [Microsoft named-pipe security and access rights](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights), [Microsoft `CreateNamedPipeW`](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-createnamedpipew), [Microsoft access tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/access-tokens), Node 24 [`node:net`](https://nodejs.org/docs/latest-v24.x/api/net.html), and [libuv's Windows `pipe.c`](https://github.com/libuv/libuv/blob/v1.x/src/win/pipe.c).
- License and redistribution: project-owned Apache-2.0 source linking only to Windows system APIs and the Rust standard library; no new notice or redistributable dependency.
- Offline, telemetry, network, and credential behavior: build and execution require no download, telemetry, network, credential store, or external service.
- Footprint, native code, and platforms: one small Windows executable. Non-Windows hosts skip its build and use the existing Unix socket mode/ownership gate.
- Security and maintenance: the helper creates one local-only pipe instance with a protected current-user DACL, relays opaque length-framed bytes over inherited stdio, closes the instance to produce EOF, and recreates it with the same descriptor. It parses no RPC, path, workflow, or document data.
- Adapter fit: Garden Desk Core retains endpoint naming, lifecycle, the request-limit definition, JSON-RPC parsing, dispatch, and authorization policy in TypeScript; the helper owns secure pipe creation, byte relay, and enforcement of the supplied resource ceiling.
- Validation: the live descriptor is `D:P(A;;FA;;;S-1-5-21-2956651453-1646027870-1593765367-1001)` on the proving host; a restricted token with that SID disabled receives access denied; same-user RPC, CLI health, restart, signing, Rust gates, and the complete M1 gate pass.
- Decision: adopted and validated for M1; production packaging, release signing, and packaged identity verification are now part of M3.
