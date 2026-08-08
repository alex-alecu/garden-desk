---
name: docx-documents
description: Guides local DOCX document creation, reading, and editing. Use when the task or an attachment explicitly identifies a DOCX file or Microsoft Word document.
trigger-extensions: .docx
trigger-keywords: docx, microsoft word document, word document, word documents, word doc, word docs, word file, word files, in word, word meeting notes, meeting notes
produces-deliverables: true
---

# DOCX Documents

Use `python-docx` for requested DOCX work inside the no-network guest.

## Process

1. Read existing documents with `Document(path)`. When editing, change only the requested content and preserve the existing sections, paragraphs, tables, styles, headers, and footers that do not need to change.
2. For a new document, use A4 sections with sensible margins, built-in heading styles, readable body text, and restrained spacing. Add tables only when they improve the requested structure.
3. Save beneath `/workspace`, keep intermediates separate, then reopen with `Document(output_path)` and verify paragraphs, tables, styles, sections, and exact requested facts before declaring it.
4. `Document` objects have no `close()` method.

## Verification

- [ ] The output opens as a DOCX package.
- [ ] Requested paragraphs, tables, styles, and facts are present.
- [ ] Unrequested existing structure was preserved when editing.
- [ ] Only the requested DOCX path is declared as a deliverable.
