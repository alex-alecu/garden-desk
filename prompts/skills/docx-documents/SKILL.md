---
name: docx-documents
description: Guides local DOCX document creation, reading, and editing. Use when the task or an attachment explicitly identifies a DOCX file or Microsoft Word document.
trigger-extensions: .docx
trigger-keywords: docx, microsoft word document, word document, word documents, word doc, word docs, word file, word files, in word, word meeting notes, meeting notes
produces-deliverables: true
---

# DOCX Documents

Use `python-docx`; follow requested names and facts literally.

## Read and edit

1. Recursively discover `.docx` inputs under `/source` by extension, not filename guesses. Inspect paragraphs, tables, styles, sections, headers, and footers. Keep simple counters and loops at top level.
2. Change only requested content. Preserve unrelated runs, styles, page setup, headers/footers and link state, tables, and relationships. Avoid `paragraph.text` when run formatting matters; edit matching runs or rebuild only that paragraph.
3. New documents use separate paragraphs, built-in headings/lists, readable A4 margins, and restrained tables; never fake bullets or layout with newlines.
4. Save under `/workspace`, reopen, and verify exact requested text and preserved structure before declaration. `Document` has no `close()`.

## Verification

- [ ] Output reopens; requested changes are exact and unrelated structure remains.
- [ ] Declare only the requested DOCX.
