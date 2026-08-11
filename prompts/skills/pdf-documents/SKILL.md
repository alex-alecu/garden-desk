---
name: pdf-documents
description: Guides local PDF reading, page operations, and creation. Use when the task explicitly identifies a PDF file or PDF deliverable.
---

# PDF Documents

Explore the PDF first: locate the actual input, inspect page text and document structure, and confirm the requested page order or facts before changing anything.

Use `pypdf` for reading and page operations. Use ReportLab Platypus for a new styled PDF with real headings, page breaks, margins, and fitting tables. Keep source facts and requested names literal.

When the PDF presents values derived from `/source` files, read and compute those values in the same program that builds the PDF. Do not paste numbers, rows, or tables from earlier output or conversation text into the generation code.

Save under `/workspace`, reopen the PDF, and verify text, page count/order, rotations, sizes, and requested metadata before declaring the requested output.
