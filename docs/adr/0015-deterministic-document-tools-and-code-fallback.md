# ADR 0015: Deterministic Document Tools And Code Fallback

Date: 2026-07-13

## Status

Superseded by [ADR 0018](0018-offline-dev-agent-first.md) for V1 sequencing. The deterministic document architecture remains an optional post-V1 optimization, not the first product path.

## Context

Professional users expect basic document operations to be fast and reliable. Searching every workbook in a folder for a value such as `avans` should not depend on whether a model decides to write a correct script. At the same time, implementing a dedicated product feature for every uncommon transformation would create a large, slow-growing adapter surface.

A general coding agent can solve some long-tail tasks by generating a short program, but its code, dependencies, resource use, and outputs are untrusted. Its own permission settings cannot replace the product sandbox, policy engine, approval flow, or verifier.

## Decision

Garden Desk uses a hybrid execution architecture.

The primary path is deterministic and product-owned:

- Parse supported PDF, DOCX, XLSX, XLS, CSV, EML, image, and archive inputs into versioned canonical structures.
- Preserve pages, regions, paragraphs, tables, sheets, rows, cells, formulas, display values, typed values, and source anchors.
- Provide typed search, filter, sort, join, compare, aggregate, arithmetic, extraction, and export operations over canonical data.
- Use exact lexical search before model reasoning for names, identifiers, dates, amounts, and cell text.
- Use OCR, layout analysis, retrieval, and the model only where deterministic extraction is insufficient.

The secondary path is a bounded code-interpreter worker for unsupported or novel transformations:

- Vault Core creates a new disposable no-network microVM for each code job.
- Inputs are explicit, job-scoped, and read-only; writable scratch space is ephemeral and bounded.
- The worker receives no credentials, user home, arbitrary workspace paths, host shell, generic host service, approval authority, or external network access.
- The generation model remains in the narrow host-native accelerator worker. Completion requests and tool observations cross only versioned typed host/guest IPC; the guest receives no generic model-server socket.
- Generated code may use only the runtime and pinned libraries in the immutable guest image. Runtime installation and package download are forbidden.
- CPU, memory, time, process count, storage, output count, and output size are limited.
- Code, interpreter version, library manifest, input hashes, stdout/stderr, structured result, generated artifacts, policy decisions, and termination reason are recorded for replay and audit.
- Generated artifacts remain proposals. Vault Core validates their types and destinations, verifies results where possible, and requires approval before export or workspace mutation.
- The microVM is terminated and discarded after success, failure, cancellation, or timeout.

The code interpreter is a fallback chosen by policy after deterministic capabilities are considered. It is not exposed as an unrestricted terminal, generic development environment, or product backend.

OpenCode may be evaluated as a reference implementation for the guest-side agent loop because it can generate and execute code. It is not an accepted runtime dependency. Adoption requires evidence that it reduces maintained code while preserving the no-network boundary, typed model proxy, pinned offline environment, cancellation, audit, deterministic result contract, and packaged footprint. A smaller Garden Desk-owned loop is the default if OpenCode fails any gate.

## Consequences

Positive:

- Common document operations are fast, testable, reproducible, and independent of model initiative.
- Long-tail transformations remain possible without building a permanent feature for each one.
- Generated code is contained behind the same hostile-work boundary as malicious documents.
- The verifier can compare code-produced results with canonical inputs and deterministic calculations.

Negative:

- Requires both a canonical document-tool layer and a tightly constrained interpreter image.
- Generated code may still be wrong even when securely contained.
- Host/guest inference mediation adds protocol and cancellation complexity.
- Supporting libraries increases guest-image size and supply-chain review.

## Required Validation

- A folder containing nested XLSX files is searchable for `avans`, case-insensitively and across all sheets, without invoking the model or code interpreter; results identify file, sheet, cell, displayed value, and source hash.
- Deterministic spreadsheet search handles formulas, cached/displayed values, blanks, merged cells, Unicode, hidden sheets, malformed workbooks, and password-protected files with explicit outcomes.
- Policy routing proves common supported operations never select generated code.
- Adversarial generated code cannot reach a network, host path, credential, package manager, microVM control plane, or approval mechanism.
- Infinite loops, fork/process storms, memory exhaustion, disk exhaustion, oversized output, malformed result IPC, guest crash, and cancellation are contained and audited.
- Code-produced tabular and numeric results are checked against source anchors and deterministic recalculation before presentation or export.
- OpenCode and a minimal owned loop, if both are evaluated, run the same offline corpus and security gates before a dependency decision.

## Research Links

- [OpenCode server](https://opencode.ai/docs/server/)
- [OpenCode tools and permissions](https://opencode.ai/docs/tools/)
