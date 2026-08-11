---
name: pdf-documents
description: Guides local PDF reading, creation, and page operations. Use when the task or an attachment explicitly identifies a PDF file or PDF deliverable.
trigger-extensions: .pdf
trigger-keywords: pdf, portable document
source-rejections: from\s+pypdf\.generic\s+import\s+PageObject\b=>unsupported_document_api;; \bwriter\.title\s*==>unsupported_document_api
source-removals: from pypdf.generic import PageObject=>PageObject
produces-deliverables: true
---

# PDF Documents

Use `pypdf` for reading/page operations and ReportLab Platypus for new styled PDFs. Follow requested facts and names literally.

## Process

1. Recursively discover `.pdf` inputs under `/source` by extension. Locate named inputs inside the processing program, not a separate listing step. Derive facts from `PdfReader` page text. Keep simple counters and loops at top level.
2. For merge/split/rotation, build the exact ordered page list and add each page once with `PdfWriter`. Import only `PdfReader`/`PdfWriter` from `pypdf`, never `PageObject` from `pypdf.generic`. Set title with `writer.add_metadata({"/Title": title})`, not `writer.title`; verify via `reader.metadata.get("/Title")`.
3. New styled PDFs use Platypus flowables, A4 margins, bundled fonts, real headings/breaks, and fitting tables; no converters.
4. Save under `/workspace`; reopen and verify text, count/order, rotations, sizes, and metadata before declaration.
5. For requested invalid-input detection, catch the parse error, print the exact marker, exit 0, and do not repair, create, traceback, or retry.

## Verification

- [ ] Inputs parse (or the requested invalid marker completes cleanly).
- [ ] Reopened text/order/rotation/size/metadata match; declare only requested PDFs.
