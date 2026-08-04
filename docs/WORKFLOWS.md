# Workflows

Updated: 2026-08-04

Vault Desk V1 is a general-purpose local file agent rather than a collection of predefined professional workflows.

## V1 Interaction

Users ask for an outcome in ordinary language. The agent may inspect the live selected folder, write Python or Node.js, use installed shell tools in its session-scoped offline microVM, observe the bounded result, and continue until it completes, fails, or reaches its limits.

Examples:

- Explore a folder and explain its structure.
- Compare several files and summarize differences.
- Clean, join, or visualize CSV data.
- Extract information from a set of documents.
- Inspect images and build a derived artifact in guest scratch.
- Diagnose a small code project without changing it.

## Workflow Invariants

- A folder session receives only a live read-only mount of its selected folder with the original hierarchy.
- A New chat session receives only its explicit attachments.
- Agent-authored code and commands run only in the session-scoped no-NIC microVM.
- The immutable guest image contains the only available Python, Node.js, BusyBox commands, and library versions.
- Package installation and runtime network access are unavailable.
- The guest can write only to its persistent 128 MiB workspace and ephemeral `/run`; it cannot change host source files.
- Vault Core mediates model completions, limits, cancellation, audit, and results.
- Only explicitly requested files declared by a successful final response become deliverables. They are proposals, not silent host mutations; Open uses a verified temporary copy and Save As requires a native user-selected destination.
- Observable code and activity are reviewable; hidden reasoning is not persisted.

## Session Model

Each folder is a sidebar group. Its five newest sessions are immediately visible and older sessions load through Show more. New chat is a separate global area for conversations with optional file attachments and no implicit folder grant.

Sessions persist user messages, assistant messages, observable agent activity, declared deliverable metadata and immutable bytes, warnings, drafts, and terminal outcomes. Undeclared intermediates remain in the bounded session workspace and debug snapshot. Sessions do not persist hidden model reasoning.

## Post-V1 Workflow Specialization

After V1, measurements may justify purpose-built document intelligence: parsing, OCR, retrieval, citations, deterministic verification, or vertical workflow packs. Those capabilities optimize the generic agent; they do not replace or weaken its read-only-host and no-network execution boundary.

## Evaluation

The V1 workflow suite covers:

- Multi-step Python, Node.js, and guest shell-tool tasks.
- Mixed folders and explicit attachments.
- Correct session/folder scoping.
- Restart, reconnect, cancellation, timeout, and guest crash.
- Traversal, escaping links, host-write attempts, credential access, package installation, network access, process storms, and resource exhaustion.
- Bounded generated source, commands, stdout, stderr, artifacts, observations, model turns, time, memory, CPU, and persistent workspace. The live read-only source folder is not copied or size-limited.
- Trusted task text, attachment names, and typed workflow state route product-owned DOCX, XLSX, and PDF skills without exposing a skill picker or routing from file contents, logs, or model output.
- Packaged macOS and Windows behavior with zero-download first launch.

Task-quality cases use deterministic development and held-out inputs. Security invariants require complete detection; general answer quality is reported honestly rather than hidden behind one aggregate score.

## Revision History

| Date | Change |
|---|---|
| 2026-07-10 | Created the initial workflow document. |
| 2026-07-20 | Replaced the pre-V1 vertical workflow sequence with the generic offline dev-agent interaction. |
| 2026-07-23 | Added the live read-only folder, guest shell tools, session VM, and persistent bounded workspace workflow. |
| 2026-08-04 | Added declared generated-file deliverables, explicit Open and Save As actions, and invisible DOCX, XLSX, and PDF skill routing. |
