# Vault Desk

**Private work should stay private.**

Vault Desk is a local-first desktop agent for working with private files and folders. It is built for people who want useful AI assistance without uploading their work, managing model infrastructure, or becoming an AI developer.

## Why Vault Desk exists

Most AI tools ask people to accept one of three compromises: use a cloud-only service, use a hybrid product that still treats the cloud as its default, or configure a local stack designed primarily for developers.

Vault Desk takes a different approach. The application, models, conversations, tools, and workspaces run on your computer. You choose a folder or attach files, describe the outcome you want, and Vault Desk handles the local infrastructure automatically. Your source folder remains read-only to the agent.

## Nothing leaves your device

Vault Desk collects **nothing**. There is no telemetry, analytics, feature-usage tracking, automatic crash reporting, background metrics export, prompt upload, or silent cloud fallback.

Conversations, files, generated work, audit records, and diagnostic traces stay on the device. They leave only when you deliberately export or share them. The V1 product requires no account and no cloud service.

## How we are building it

- **Generation model:** the official `Gemma 4 12B IT QAT Q4_0` GGUF. This is the default decoder model and the first model certified for Vault Desk.
- **Retrieval encoder:** the official `Qwen3-Embedding-0.6B Q8_0` GGUF for local semantic search. Document retrieval is part of the post-V1 document-intelligence work; the encoder's local runtime path is already validated.
- **Model runtime:** [`node-llama-cpp` 3.19.0](https://node-llama-cpp.withcat.ai/), using the same GGUF runtime on macOS and Windows. The default model stack is Apache 2.0 licensed.
- **Desktop and control plane:** a [Tauri v2](https://tauri.app/) and React interface over a TypeScript and Node.js core that owns permissions, sessions, model requests, limits, audit, and recovery.

The model does not run as a server on an exposed port. It runs in a separate, supervised process and communicates with Vault Core through fixed, typed stdin and stdout. This preserves local GPU acceleration while denying the model network access, credentials, a host shell, unrestricted files, or approval authority. It also lets the operating system reclaim the complete model runtime when the worker stops.

To run the desktop locally:

1. Clone the repository.

   ```sh
   git clone https://github.com/alex-alecu/vault-desk.git
   cd vault-desk
   ```

2. Install the packages.

   ```sh
   pnpm install
   ```

3. Start the desktop app.

   ```sh
   pnpm desktop:dev
   ```

   On Windows Pro or Enterprise, Hyper-V must already be enabled. The first launch explains and requests one administrator-approved change that adds the current user to Hyper-V Administrators; sign out and back in once afterward. Vault Desk and later development launches remain non-elevated. macOS requires no administrator setup and continues to launch as the current user.

   On Windows, Vite continues to reload frontend changes while `desktop:dev` disables Tauri's Rust file watcher. Some Windows filesystems report source-file reads as access changes, which Tauri can mistake for edits and restart forever. Restart `desktop:dev` after changing Rust desktop-host code. macOS keeps Tauri's normal Rust watcher.

## Public website

Explore the [public website and interactive demo](https://alex-alecu.github.io/vault-desk/) or run it locally with `pnpm site:dev`.

## More capable than file ingestion

Vault Desk does more than place extracted text into a prompt. The agent can write and run Python, Node.js, and shell tasks inside an isolated Linux microVM, then use the results in its next step.

The immutable guest image includes pinned offline tools for common work with JSON, CSV, SQLite, PDF, DOCX, XLSX, and images, including Pillow, pypdf, openpyxl, and python-docx. This lets the agent inspect structure, calculate, transform files, and create useful artifacts. Package managers are intentionally absent: the environment is reproducible and cannot download code at runtime.

## Local stress results

On a 48 GB Apple-silicon Mac, the real offline stack passed all 8 small sequential and concurrent cases, plus a 100-page PDF, a 1,000,000-row workbook, and a 50-workbook folder with 10,000,000 rows. A mixed 10,000,000-row XLSX and DOCX task can save and resume progress, but does not yet complete reliably.

## Isolation on macOS and Windows

Every conversation uses a session-scoped microVM with no virtual network device, DNS, route, bridge, NAT, or proxy. It receives the selected folder as a live read-only mount, immutable attachments, a bounded private workspace, and one typed host/guest channel. The model can propose work; Vault Core decides what is valid and the microVM performs it without unrestricted host access or any network access.

### macOS

On Apple silicon, Vault Desk uses Apple's **Virtualization.framework**. It provides native hardware isolation and direct control over the VM configuration, so Vault Desk can prove that no network device exists. **VirtioFS** supplies the live read-only folder, while a fixed virtio socket carries typed messages without opening a TCP port.

### Windows

On Windows Pro and Enterprise with Hyper-V already enabled, Vault Desk uses **HCS and Hyper-V** utility VMs. These are the platform-native isolation and lifecycle primitives. A read-only **Plan9** share exposes the selected folder, and a fixed **Hyper-V socket** carries typed messages without adding a network adapter or general network path. A signed Windows-only helper elevates once to add the requesting user to Hyper-V Administrators; the application and Vault Core then run as that standard user without recurring UAC. This standing group membership gives every process under that Windows account Hyper-V management authority. Vault Desk does not enable or download Windows features.

## Project status

The M3 desktop agent and canonical headless gate are implemented and certified on physical Apple silicon and Windows x64. One Windows application directory contains the CUDA and Vulkan runtimes, chooses them automatically, and passed real-Gemma CUDA plus HCS Plan9 guest evidence. The installed-Windows UI, live-execution, and debug-snapshot observations pass; dedicated-standard-user setup, macOS lower-tier context, and release-credential signing remain before the global launch gate closes. See the current [M3 status](docs/M3_STATUS.md) for exact evidence.

The community software is free. Signed public installers are not yet available.

## Learn more

Read the [product overview](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), and [security model](docs/SECURITY.md). Exact models and hashes live in the [model manifest](assets/models.json); pinned dependencies, guest components, versions, licenses, and purposes live in the [compliance inventory](compliance/inventory.json).

The development workflow was informed by [Everything Claude Code](https://github.com/affaan-m/ECC). Vault Desk uses original project-specific instructions and does not include that package or runtime.
