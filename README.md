# Garden Desk

**Private work should stay private.**

Garden Desk is a local-first desktop agent for working with private files and folders. It is built for people who want useful AI assistance without uploading their work, managing model infrastructure, or becoming an AI developer.

## Why Garden Desk exists

Most AI tools ask people to accept one of three compromises: use a cloud-only service, use a hybrid product that still treats the cloud as its default, or configure a local stack designed primarily for developers.

Garden Desk takes a different approach. The application, models, conversations, tools, and workspaces run on your computer. You choose a folder or attach files, describe the outcome you want, and Garden Desk handles the local infrastructure automatically. Your source folder remains read-only to the agent.

## Nothing leaves your device

Garden Desk collects **nothing**. There is no telemetry, analytics, feature-usage tracking, automatic crash reporting, background metrics export, prompt upload, or silent cloud fallback.

Conversations, files, generated work, audit records, and diagnostic traces stay on the device. They leave only when you deliberately export or share them. The V1 product requires no account and no cloud service.

## How we are building it

- **Generation and image model:** Qwen3.8-27B `UD-IQ4_XS` GGUF and its F16 projector. Physical Mac verification is pending.
- **Retrieval encoder:** the official `Qwen3-Embedding-0.6B Q8_0` GGUF for local semantic search. Document retrieval is part of the post-V1 document-intelligence work; the encoder's local runtime path is already validated.
- **Model runtime:** pinned `llama.cpp b10816` for text, images, and embeddings through a private socket. Model files are Apache-2.0 licensed; llama.cpp is MIT licensed.
- **Desktop and control plane:** a [Tauri v2](https://tauri.app/) and React interface over a TypeScript and Node.js core that owns permissions, sessions, model requests, limits, audit, and recovery.

The model does not run as a server on an exposed port. It runs in a separate, supervised process and communicates with Garden Desk Core through fixed, typed stdin and stdout. This preserves local GPU acceleration while denying the model network access, credentials, a host shell, unrestricted files, or approval authority. It also lets the operating system reclaim the complete model runtime when the worker stops.

To run the desktop locally:

1. Clone the repository.

   ```sh
   git clone https://github.com/alex-alecu/garden-desk.git
   cd garden-desk
   ```

2. Install the packages.

   ```sh
   pnpm install
   ```

3. Start the desktop app.

   ```sh
   pnpm desktop:dev
   ```

   On Windows Pro or Enterprise, Hyper-V must already be enabled. The first launch explains and requests one administrator-approved change that adds the current user to Hyper-V Administrators; sign out and back in once afterward. Garden Desk and later development launches remain non-elevated. macOS requires no administrator setup and continues to launch as the current user.

   On Windows, Vite continues to reload frontend changes while `desktop:dev` disables Tauri's Rust file watcher. Some Windows filesystems report source-file reads as access changes, which Tauri can mistake for edits and restart forever. Restart `desktop:dev` after changing Rust desktop-host code. macOS keeps Tauri's normal Rust watcher.

## Local model operation

Generation uses Q4 weights and a 32K context. Reasoning is shown live and stays outside stored conversations, traces, and audit records. The model proposes tool calls; Core controls execution inside the no-network microVM.

## Public website

Explore the [public website and interactive demo](https://gardendesk.ai/) or run it locally with `pnpm site:dev`.

## More capable than file ingestion

Garden Desk does more than place extracted text into a prompt. The agent can write and run Python, Node.js, and shell tasks inside an isolated Linux microVM, then use the results in its next step.

The agent can also inspect a PNG or JPEG attachment, or an image in the selected folder. A simple question about one direct image stays in the main chat. Exact extraction and multi-image work run in a general child agent, so only the requested facts return to the main context. Image inspection is local, on demand, and has no network access.

The immutable guest image includes pinned offline tools for common work with JSON, CSV, SQLite, PDF, DOCX, XLSX, and images, including Pillow, pypdf, openpyxl, python-docx, and ReportLab. The model loads product-owned format and professional review skills on demand through one generic skill tool. Legal, finance, and medical-administration review skills use supplied evidence and require qualified human review. Explicitly requested files appear beneath the matching response with Open and Save As actions; scripts, intermediates, and logs stay in Technical details. Package managers are intentionally absent: the environment is reproducible and cannot download code at runtime.

## Release checks

Before a release, `pnpm test:m3:macos` and `pnpm test:m3:windows` run the guest security probes (no network interface, read-only source, resource limits) plus four golden folder tasks — XLSX, DOCX, and PDF extraction, and a mixed-folder report — each checked against known fixture values. They print a pass count and fail the build if any task fails.

## Isolation on macOS and Windows

Every conversation uses a session-scoped microVM with no virtual network device, DNS, route, bridge, NAT, or proxy. It receives the selected folder as a live read-only mount, immutable attachments, a bounded private workspace, and one typed host/guest channel. The model can propose work; Garden Desk Core decides what is valid and the microVM performs it without unrestricted host access or any network access.

### macOS

On Apple silicon, Garden Desk uses Apple's **Virtualization.framework**. It provides native hardware isolation and direct control over the VM configuration, so Garden Desk can prove that no network device exists. **VirtioFS** supplies the live read-only folder, while a fixed virtio socket carries typed messages without opening a TCP port.

### Windows

On Windows Pro and Enterprise with Hyper-V already enabled, Garden Desk uses **HCS and Hyper-V** utility VMs. These are the platform-native isolation and lifecycle primitives. A read-only **Plan9** share exposes the selected folder, and a fixed **Hyper-V socket** carries typed messages without adding a network adapter or general network path. A signed Windows-only helper elevates once to add the requesting user to Hyper-V Administrators; the application and Garden Desk Core then run as that standard user without recurring UAC. This standing group membership gives every process under that Windows account Hyper-V management authority. Garden Desk does not enable or download Windows features.

## Project status

M3 Offline Dev-Agent Desktop V1 is active. What it delivers today, the security boundary, and what still needs to happen before launch — packaged Open and Save As, a dedicated standard-user Windows setup, and release signing — are in the current [M3 status](docs/M3_STATUS.md).

The community software is free. Signed public installers are not yet available.

## Learn more

Read the [product overview](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), and [security model](docs/SECURITY.md). Exact models and hashes live in the [model manifest](assets/models.json); pinned dependencies, guest components, versions, licenses, and purposes live in the [compliance inventory](compliance/inventory.json).

The development workflow was informed by [Everything Claude Code](https://github.com/affaan-m/ECC). Garden Desk uses original project-specific instructions and does not include that package or runtime.
