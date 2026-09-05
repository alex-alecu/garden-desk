# ADR 0012: MicroVM Isolation And Untrusted Documents

Date: 2026-07-11

## Status

The current model, runtime, and memory profile is defined in [ADR 0019](0019-qwen38-private-server.md). This document preserves the prior decision and its remaining contracts.

Accepted as security direction

## Context

Garden Desk treats model output as untrusted, but document parsers, OCR models, inference runtimes, tool implementations, and document contents are also attack and failure surfaces. The earlier plan described supervised workers and network policy without defining a security boundary that remains effective after a worker is compromised.

A package or process boundary is not a sufficient hostile-code boundary. Command matching, URL matching, destination allowlists inside a worker, and application-level requests to avoid networking are policy conveniences, not proof of network isolation. Malformed documents, decompression bombs, parser exploits, runaway generation, prompt injection inside source text, or worker compromise must not gain Garden Desk Core permissions, reach a network, or corrupt authoritative workspace state.

## Decision

The certified hostile-work boundary is a no-network microVM. Document parsing may use a disposable job-scoped VM; the V1 development agent uses a reusable session-scoped VM. Network denial is structural: the guest receives no virtual NIC, route, DNS service, bridged interface, NAT interface, or general host-network proxy. Garden Desk must not implement this guarantee by matching individual commands, executables, hostnames, URLs, IP addresses, or protocols.

The microVM exposes only a narrow host/guest socket for versioned typed IPC. That socket is not a network broker and cannot forward arbitrary destinations. Executed children receive no control-socket descriptor and an OS-enforced syscall filter denies new sockets, including VSOCK connections to other host services. Explicit attachments arrive as immutable session-owned bytes. For the offline dev agent, the selected folder is a platform-native live read-only share at `/source`, and the bounded writable `/workspace` persists only through validated content-addressed manifests. The guest root remains immutable. The VM is session-scoped, admits one execution at a time, and is discarded on eviction, revocation, deletion, Core shutdown, or containment failure.

macOS uses one read-only VirtioFS share. Windows certification requires an HCS Plan9 share with both host `ReadOnly` and guest read-only mount enforcement over Hyper-V sockets, without a virtual NIC or copy fallback. This scoped Plan9 transport is not a network broker. Windows is not certified until physical evidence proves the boundary.

Both desktop hosts and Garden Desk Core run as the current user. macOS requires no administrator setup. Windows HCS accepts administrators or Hyper-V Administrators, so the Windows package includes one narrowly scoped signed helper that may elevate after an explicit disclosure, derive the requesting account from the non-elevated parent process token, and add only that account to Hyper-V Administrators. Hyper-V must already be enabled. The helper cannot enable features, accept another SID, or launch arbitrary work. After a new Windows sign-in, the standard-user desktop owns HCS lifecycle and the fixed Hyper-V socket admits Hyper-V Administrators. This standing group membership grants all processes under that account Hyper-V management authority and is part of the disclosed Windows security boundary.

The offline dev agent defined by [ADR 0018](0018-offline-dev-agent-first.md) is an executable-tool guest role under this boundary. Every session starts from the immutable image with pinned offline interpreters and libraries; dependency installation is forbidden. Garden Desk Core calls the separately confined host-native inference worker, then sends only validated execution requests to the guest. The guest receives no model-server socket, Garden Desk Core API, external-connection broker, approval authority, or export authority.

Agent protocol v3 streams only execution stdout, stderr, and typed lifecycle diagnostics with execution identity and monotonic sequence validation. Core caps and durably records those streams before exposing them through polling. Native helper stderr, temporary host paths, credentials, model reasoning, and arbitrary platform logger output never enter the execution record.

The first platform backends to validate are research-derived until M0 proves their packaging and lifecycle behavior:

- macOS 26 on Apple silicon: Apple Containerization or Virtualization.framework, configured without a virtual network device and with virtio-socket IPC.
- Windows Pro or Enterprise: an HCS/Hyper-V utility VM configured without a virtual network adapter and with Hyper-V socket IPC.
- Linux, when desktop certification is opened: a Firecracker/KVM microVM configured without `virtio-net` and with `virtio-vsock` IPC.

Process-only sandboxes, Windows AppContainer, and Linux namespace/seccomp/Landlock combinations may be evaluated as compatibility fallbacks. They must be labeled as weaker than the certified microVM boundary and cannot silently satisfy a microVM acceptance gate.

Hardware-accelerated inference is a separate trust class. The pinned node-llama-cpp inference worker may remain a host-native supervised process so Metal, CUDA, HIP, or Vulkan acceleration remains available. It receives no arbitrary workspace paths, shell, tool implementation, credentials, or approval authority, and outbound networking is denied by an operating-system capability boundary rather than command matching. Model output crosses typed IPC into Garden Desk Core, which alone can propose policy-controlled tool use. OCR or layout acceleration may use the same exception only when measured product requirements make microVM execution impractical; each exception must be documented and pass the native-worker isolation gates.

Workers follow a capability-scoped job protocol:

- Garden Desk Core inventories and authorizes inputs before dispatch.
- Workers receive explicit attachment bytes or one Core-validated canonical selected-folder share rather than arbitrary model-chosen paths.
- Workers cannot approve actions, mutate workspace policy, write exports, or access the general workspace filesystem.
- MicroVM workers have no virtual network device; native accelerator workers have networking denied by an operating-system sandbox or capability boundary.
- Each job has limits for wall time, CPU, memory, temporary storage, input expansion, output size, and concurrency.
- Code jobs additionally limit process count, generated artifact count, stdout/stderr size, and total instruction/tool iterations.
- Cancellation is cooperative first and process termination is the fallback.
- Worker output is schema-validated and size-checked before Garden Desk Core commits it.
- Worker crashes and malformed messages become typed job failures with durable resume points.
- Temporary transport files live in scoped directories and are cleaned after success, cancellation, crash, and startup recovery. Session workspace content survives only through validated manifests.

Source documents and retrieved chunks are always data. Text inside them cannot redefine system policy, grant permissions, request approval, or become a tool call. Prompts and tool-loop adapters preserve an explicit separation between trusted workflow instructions and untrusted evidence.

Authorized external integrations run in a dedicated Garden Desk Core network broker outside the microVM. The broker accepts only typed, policy-approved operations, owns credentials, records destinations and results, and never exposes a general socket, HTTP proxy, DNS proxy, or arbitrary fetch primitive to a model or worker. Updates and model acquisition use a separate user-initiated updater and are not worker capabilities.

## Consequences

Positive:

- Contains native crashes and parser failures.
- Removes general network reachability from hostile document and executable-tool processing.
- Makes memory arbitration, cancellation, and recovery testable.
- Prevents document instructions from becoming execution authority.

Negative:

- Adds a microVM launcher, guest image, typed socket IPC, and supervision code.
- Requires platform-specific read-only sharing plus workspace manifest hydration and commit.
- Platform launchers and packaging differ and need separate certification evidence.
- Hyper-V availability may require a supported Windows edition; weaker fallbacks cannot be marketed as equivalent.
- GPU acceleration inside the microVM is not assumed, so native accelerator workers retain a narrower secondary boundary.

## Required Validation

- Traversal, symlink, MIME confusion, time-of-check/time-of-use replacement, and staged-input mutation tests.
- Prompt-injection documents that attempt tool calls or policy override.
- Zip/decompression bombs, oversized files, parser hangs, worker crashes, malformed IPC, cancellation, timeout, and low-disk tests.
- Configuration inspection proving that every certified microVM has zero virtual network adapters.
- Runtime probes proving failure for DNS, IPv4, IPv6, LAN, multicast, and host-network access, without relying on command or destination matching.
- Proof that host/guest socket ports are fixed and typed and cannot act as a generic network proxy.
- Native accelerator tests proving OS-enforced network denial and absence of arbitrary filesystem, credential, shell, and tool authority.
- Proof that workers cannot write exports or authoritative workspace state directly.
- Packaging tests proving that process-only compatibility mode cannot be reported as microVM-certified.
- Windows package tests proving that the desktop remains `asInvoker`, only the fixed setup helper elevates, tampered helper bytes are rejected, and macOS packages exclude the helper and any administrator setup.
- Generated-code tests covering dependency-install attempts, network and host-path access, process storms, infinite loops, resource exhaustion, oversized output, malformed result IPC, generic model-endpoint access, and approval/export attempts.
