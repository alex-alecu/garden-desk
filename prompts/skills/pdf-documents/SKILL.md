---
name: pdf-documents
description: PDF reading, page work, creation. Load for PDF input or deliverable.
---

## Library

Use the installed `pypdf` through `python` for reading and page work, and `reportlab` (Platypus) to create a PDF. Do not install packages.

## Find The Files

Search `/source` recursively for files ending in `.pdf`, case-insensitive.

## Recipe

```python
from pypdf import PdfReader

reader = PdfReader(path)
for number, page in enumerate(reader.pages, start=1):
    print(f"page {number}: {page.extract_text() or ''}")
```

Cite every fact by page number, using this same one-based numbering.

To create a PDF, build a ReportLab `SimpleDocTemplate` with Platypus flowables (headings, paragraphs, tables); it handles page breaks and margins for you.

## Verify

Reopen the PDF you write with `PdfReader` and assert its page count and the text of each page you generated.

## Gotchas

- `extract_text()` can return `None` on an image-only or scanned page; treat that as no text, not an error.
- Set metadata with `PdfWriter.add_metadata()` using slash-prefixed keys, for example `{"/Title": "Report"}`.
- Derive every value from the actual source PDF; do not assume a fixed input file name.
- A rotated page can still report text in reading order; check `page.rotation` if layout looks wrong.
- Reopen and check page count, order, rotation, and metadata before you report the deliverable done.
