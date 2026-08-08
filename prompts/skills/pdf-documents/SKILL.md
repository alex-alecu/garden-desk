---
name: pdf-documents
description: Guides local PDF reading, creation, and page operations. Use when the task or an attachment explicitly identifies a PDF file or PDF deliverable.
trigger-extensions: .pdf
trigger-keywords: pdf, portable document
produces-deliverables: true
---

# PDF Documents

Use `pypdf` for reading and structural operations. Use ReportLab Platypus for a new styled PDF.

## Process

1. Read PDFs with `PdfReader` and base answers on text extracted from the real pages, never on filenames or binary decoding.
2. Use `PdfWriter` for requested merge, split, rotate, and metadata changes. Preserve pages that the request does not change.
3. For a new styled PDF, use ReportLab Platypus flowables, A4 defaults unless another page size is requested, embedded bundled fonts, readable margins, page breaks, headings, tables, and restrained colors. Do not invoke external converters or native renderers.
4. Save beneath `/workspace`, keep intermediates separate, then reopen with `PdfReader` and verify page count, requested text, order, rotation, and metadata before declaring it.
5. When the task explicitly expects invalid-input detection and requests a marker, catch the parse exception, print that exact marker to stdout, and exit normally with code 0. The marker is the completed validation result: do not repair the PDF, write an artifact, print a traceback, or execute again.

## Verification

- [ ] Every referenced input was parsed successfully, or the exact expected invalid marker completed cleanly.
- [ ] Page count, text, order, rotation, and metadata match the request.
- [ ] A new styled PDF uses ReportLab Platypus and bundled fonts.
- [ ] Only requested PDF outputs are declared as deliverables.
