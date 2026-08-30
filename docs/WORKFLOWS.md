# Workflows

Updated: 2026-08-28

Garden Desk V1 is a general-purpose local file agent with a limited prompt-only professional review set. The skill set gives the agent focused instructions; it does not add predefined workflow state machines, domain policy in Core, or the post-V1 document-intelligence system.

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
- Agent-authored code and commands run only in the session-scoped no-network microVM.
- The immutable guest image contains the only available Python, Node.js, BusyBox commands, and library versions.
- Package installation and runtime network access are unavailable.
- The guest can write only to its persistent 128 MiB workspace and ephemeral `/run`; it cannot change host source files.
- Vault Core mediates model completions, limits, cancellation, audit, and results.
- Every file the agent creates or changes under `/workspace` during a run becomes a deliverable once the run finishes with a successful final response. Deliverables are proposals, not silent host mutations; Open uses a verified temporary copy and Save As requires a native user-selected destination. Task text and format names do not create a deliverable requirement.
- Observable code and activity are reviewable; hidden reasoning is not persisted.

## Session Model

Each folder is a sidebar group. Its five newest sessions are immediately visible and older sessions load through Show more. New chat is a separate global area for conversations with optional file attachments and no implicit folder grant.

Sessions persist user messages, assistant messages, observable agent activity, accepted deliverable metadata and immutable bytes, warnings, drafts, and terminal outcomes. The anchored summary is continuity prose. Sessions do not persist hidden model reasoning.

## Prompt-Only Format Methods

The Word, PDF, XLSX, and review-report skills give prompt-only guest methods. Core advertises skill metadata and returns a body only when the model calls the generic `skill` tool. Core does not route file formats, select skill bodies, or parse document formats.

Python and Node source can be saved in the session workspace, then run again from that path without resending the source. Ordinary syntax or runtime failures remain evidence for repair; the model reads the error and edits the file. A run that loops or makes no progress simply reaches the 40-turn cap and ends.

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
- The generic `skill` tool loads product-owned Word, XLSX, PDF, review-report, and professional-review guidance on demand. Core has no format router, skill-body selection rule, or format parser. The Word guidance reads legacy DOC files as plain text through guest Antiword, but it creates and edits only DOCX files.
- Packaged macOS and Windows behavior with zero-download first launch.

Task-quality cases use deterministic development and held-out inputs. Security invariants require complete detection; general answer quality is reported honestly rather than hidden behind one aggregate score.
