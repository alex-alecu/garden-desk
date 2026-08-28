# Product

Created: 2026-07-10

Garden Desk is a private AI coworker for local folders and files. It should help individuals and small offices complete useful work while keeping source material and executable agent work on their own computer.

## Core Thesis

The community software is free. Garden Desk sells certainty.

Certainty includes:

- Correctly selected hardware.
- Installed and validated software.
- Curated local models.
- Predictable performance.
- Secure local operation.
- Safe document processing.
- Business controls for several employees.
- Backup, recovery, and accountable support.

Garden Desk is not primarily a model launcher, a RAG configuration surface, or an unrestricted host-side coding environment.

## Problem

Local AI software exists, but deploying it still forces users to decide:

- Which computer or GPU to buy.
- Which model fits available memory.
- Which runtime to use.
- How much context to configure.
- Whether a task needs OCR, retrieval, full-document reading, summarization, spreadsheet processing, or image understanding.
- How to expose the system safely to employees.
- How to manage backups, updates, permissions, and failures.

These decisions are acceptable for developers and enthusiasts. They are not acceptable for accountants, lawyers, doctors, consultants, or small-business employees who need work completed.

## Product Formats

### Garden Desk Community

A free and open-source desktop application for people using their own hardware.

Expected characteristics:

- Free for personal and commercial use.
- Local and offline by default.
- Windows and macOS initially.
- Supported Apple, AMD, and NVIDIA hardware paths.
- A generic agent that can inspect selected folders or attachments and use Python, Node.js, or installed guest commands inside an offline microVM.
- Live read-only access to host source folders and a durable bounded guest workspace.
- No artificial document, message, or usage limits.
- Community documentation and support.
- Optional paid professional support.
- Hardware compatibility test before installation.
- Clear hardware classifications: Certified, Compatible, and Experimental.

The community version must be genuinely useful. It should not be a restricted demo.

### Garden Desk Personal Computer

A normal desktop, mini-PC, or later laptop that can replace a customer's existing computer while running Garden Desk well.

It should:

- Run ordinary Windows applications.
- Include Garden Desk and validated models.
- Arrive encrypted, configured, tested, and recoverable.
- Provide defined performance guarantees.
- Require no runtime configuration. A single-model system shows its validated model as static text; a multi-model system exposes only installed approved choices.
- Include onboarding and support.

Initial hardware should focus on desktops and mini-PCs. Laptops add warranty, keyboard layout, battery, thermal, and component variation complexity.

### Garden Desk Office

A dedicated local appliance for small companies. Employees keep using existing Windows or Mac computers and access Garden Desk through a browser or lightweight client.

Expected capabilities:

- Employee accounts.
- Shared and private workspaces.
- Central local inference.
- Role-based document access.
- Permission-aware retrieval.
- Shared organizational knowledge.
- Installable domain and jurisdiction libraries that continue working offline and expose their source, edition, effective dates, trust status, and citations.
- Approval rules for agent actions.
- Audit history.
- Central backup and recovery.
- NAS and shared-folder connections.
- Controlled model and workflow updates.
- No mandatory outbound internet connection.
- Explicitly authorized temporary remote support.
- Defined concurrent-user and workload guarantees.

This is likely the strongest commercial product because it solves a shared office problem without forcing every employee to replace their computer.

## Product Principles

### No AI Infrastructure Vocabulary

Ordinary users should not need to encounter:

- RAG.
- Embeddings.
- Vector databases.
- Quantization.
- Context windows.
- Model providers.
- Tool calling.
- Similarity thresholds.

The system should automatically decide which strategy a task needs.

The active model name may appear in the desktop header because the user requested that visibility. Single-model builds show it as static text. Multi-model builds expose only installed, product-approved choices; they do not expose providers, runtime endpoints, quantization, or raw model-file configuration.

### Outcome-First Interaction

Users should ask for outcomes:

- Explore this folder and explain how it is organized.
- Compare these files and summarize the important differences.
- Find all unsigned documents.
- Turn these CSV files into one clean report.
- Inspect these images and create a contact sheet.

For V1, the local model may author Python, Node.js, or guest shell commands for the requested task, but execution occurs only in a session-scoped no-network microVM with fixed offline tools, a live read-only selected-folder mount, and a persistent bounded workspace. Purpose-built deterministic document operations may follow after V1 when measurements justify them.

### Desktop Interaction

The first desktop application uses Tauri v2 and React. Its persistent sidebar starts each section with its creation action: New chat under Chats and Add folder under Folders. Folder sessions remain grouped beneath their selected folders, showing the newest five with Show more for older sessions. The conversation workspace and bottom composer remain stable while users switch context. See [DESKTOP_DESIGN.md](DESKTOP_DESIGN.md).

### Safe Actions

Every destructive or consequential action should support:

- Preview.
- Diff.
- Explicit approval.
- Version history.
- Rollback.
- Source traceability.

### Verifiable Privacy

Garden Desk should provide stronger guarantees than "local by default":

- No mandatory cloud dependency.
- No silent cloud fallback.
- No-NIC microVM isolation for hostile document processing and executable agent tools on certified platforms.
- No command, URL, domain, address, or protocol matching presented as a network-isolation guarantee.
- No application telemetry, usage analytics, automatic crash reporting, or background metrics export.
- Local customer-owned audit records stay on the device unless the user explicitly exports them.
- Clear network activity controls.
- Auditable external connections.
- Offline update packages for controlled environments.

### Offline Knowledge

Garden Desk should support passive Knowledge Bundles for domain reference material. A bundle carries immutable sources, provenance, rights, applicability metadata, and optional rebuildable retrieval accelerators. It remains separate from Workflow Packs: installed reference content can inform an answer but cannot add tools, prompts, approvals, or execution authority.

Users should see understandable library concepts such as domain, jurisdiction, edition, effective period, publisher, and update status. They should not need to manage embeddings or vector databases. See [KNOWLEDGE_BUNDLES.md](KNOWLEDGE_BUNDLES.md).

## Initial Customer Segments

The Community V1 targets individuals and small teams that need a private general-purpose file agent. Vertical workflow specialization follows only after usage identifies repeatable high-value tasks.

Legal practices are a strong second vertical because document comparison, citation, redaction, and formatting-sensitive edits are high-value workflows.

M3 includes limited prompt-only medical-administration review for supplied records, timelines, prior-authorization packet completeness, and billing-document differences. It does not provide diagnosis, treatment recommendations, triage, medical-necessity decisions, or autonomous patient communication. The complete medical administration workflow remains a later target.
