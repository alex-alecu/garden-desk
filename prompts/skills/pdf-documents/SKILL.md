---
name: pdf-documents
description: Guides local PDF reading, page operations, and creation. Use when the task explicitly identifies a PDF file or PDF deliverable.
---

# PDF Documents

Explore the PDF first: locate the actual input, inspect page text and document structure, and confirm the requested page order or facts before changing anything.

For a read-only review, use one short Python program in this form. Replace only the input path. Do not add a `try` block, an exception wrapper, or a trailing brace.

```python
from pypdf import PdfReader

reader = PdfReader("/source/input.pdf")
for page_number, page in enumerate(reader.pages, 1):
    print(f"--- Page {page_number} ---")
    print(page.extract_text() or "")
```

Use `pypdf` for reading and page operations. Pass standard metadata names to `PdfWriter.add_metadata()` with their required leading slash, such as `{\"/Title\": \"Report\"}`. Use ReportLab Platypus for a new styled PDF with real headings, page breaks, margins, and fitting tables. Keep source facts and requested names literal.

When the PDF presents values derived from `/source` files, read and compute those values in the same program that builds the PDF. Do not paste numbers, rows, or tables from earlier output or conversation text into the generation code.

Save under `/workspace`, reopen the PDF, and verify text, page count/order, rotations, sizes, and requested metadata before declaring the requested output.
