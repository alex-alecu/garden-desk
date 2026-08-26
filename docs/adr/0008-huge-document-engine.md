# ADR 0008: Huge Document Engine

Created: 2026-07-10

Status: Proposed

## Context

Vault Desk must work on folders with tens of large PDFs, spreadsheets, CSVs, Word documents, scanned files, and mixed professional records.

Model-only reading is not reliable or efficient enough for this workload, especially on constrained automatic memory tiers.

## Decision

Vault Desk will use a deterministic document engine before model reasoning.

The engine will:

- Inventory folders.
- Hash files.
- Create resumable manifests.
- Route files through layered parsers.
- Normalize to canonical document objects.
- Preserve source anchors.
- Build summary trees.
- Build lexical and dense indexes.
- Assemble evidence packs.
- Verify claims, citations, and calculations before export.

Candidate tools for the first validated architecture (revalidated 2026-07-11; see [research/document-tools-2026.md](../research/document-tools-2026.md)): native Node parsers for born-digital files, Granite-Docling GGUF and the Docling sidecar for layout-aware parsing, PaddleOCR-VL for OCR, MarkItDown and Unstructured as broad-conversion and fallback paths inside one Python sidecar, native spreadsheet parsing, EmbeddingGemma, an embedded hybrid index (LanceDB candidate), and optional TurboQuant-based acceleration.

## Consequences

Positive:

- Huge documents become manageable on constrained local hardware.
- Citations and audit trails become first-class.
- Summary and retrieval caches reduce repeated work.
- Parser disagreement can be surfaced instead of hidden.

Negative:

- More architecture and implementation complexity.
- Requires document-specific evaluation corpora.
- Parser packaging and cross-platform behavior must be validated.
