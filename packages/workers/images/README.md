# MicroVM Guest Image

Buildroot 2026.05 produces the minimal Linux kernel and initramfs used by the no-NIC worker protocol probe. M0 selected the tool and image inputs; M1 owns the production build entrypoint and the macOS and Windows launchers. Buildroot is build tooling, not a runtime or shipped package manager. Its source archive is pinned by URL and SHA-256 in `manifest.json`.

The M1 probe image contains only the kernel, BusyBox userspace, required virtio block/socket drivers, and its fixed probe entrypoint. The M3 agent role is a separate immutable image under `agent/`: it adds fixed Python and Node runtimes, reviewed offline document libraries, the fixed Antiword legacy DOC text reader, and one typed repeated-execution entrypoint for source or `/bin/sh` commands. Neither image contains package installation, credentials, customer data, a model, persistent image state, or a virtual network device. Their kernel has no IPv4, IPv6, wireless, or virtual NIC path.

The build runs in Buildroot's release-pinned CI image locked by registry digest, sets a fixed source date epoch, disables IP and wireless kernel features, and emits architecture-specific kernel and initramfs artifacts. The first build may fetch Buildroot-verified inputs; the independent second build has Docker networking disabled and must be byte-identical. Transient build trees use disposable Linux-native Docker volumes. Artifacts are ignored and are not committed.

Run `VAULT_BUILDROOT_ARCHIVE=/absolute/path/buildroot-2026.05.tar.xz pnpm guest:build`. The archive must match the manifest hash; use `-- --arch x86_64` for the Windows build.

Run `VAULT_BUILDROOT_ARCHIVE=/absolute/path/buildroot-2026.05.tar.xz pnpm guest:build:agent` for the macOS M3 agent image. The command performs two independent builds, disables Docker networking for the second build, requires byte-identical outputs, and installs generated artifacts only under the ignored `.generated/agent/` tree.

Buildroot was selected over a general distribution image because it emits a smaller immutable root filesystem with an explicit package set. The GPL build system is not shipped, but the repository must retain its license/source-offer obligations for the GPL kernel and BusyBox contents when guest images are distributed.

The manifest records reproducible arm64 and x86_64 kernel and initramfs hashes. Both M1 architecture builds were repeated after the production frame and denial probes were added; each second build had Docker networking disabled and matched byte-for-byte. The certified x86_64 hashes are kernel `ec0364eab93e9a12e4f5ef3008207331b03ef32a23dd9b0fc0f8c197fb126e45` and initramfs `cdf5a631ee8cc7aabb5def990de9beb922221acf5a46dc51ce2492498b225986`. Recording a digest does not by itself certify a platform: the current host must boot that exact guest and pass its no-NIC socket gate.
