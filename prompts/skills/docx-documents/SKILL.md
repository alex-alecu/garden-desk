---
name: docx-documents
description: Guides local DOCX document reading, editing, and creation. Use when the task explicitly identifies a DOCX file, Microsoft Word document, or Word deliverable.
---

# DOCX Documents

Explore the source document before choosing an edit. Use `python-docx` to inspect paragraphs, tables, styles, sections, headers, and footers, then make only the requested change. Keep a simple edit in one small top-level program: load the source, change matching paragraphs or runs, append requested blocks, save under `/workspace`, reopen the result, and assert the changed text and paragraph styles.

When a new document contains facts derived from source files, read every required source and build the document in the same program. Do not copy values from earlier tool output into the document program. Use this small pattern for exact facts:

```python
from docx import Document

def visible_text(document):
    parts = [paragraph.text for paragraph in document.paragraphs]
    parts += [cell.text for table in document.tables for row in table.rows for cell in row.cells]
    return "\n".join(parts)

facts = {}  # Fill this while this program reads and computes from every required source.
document = Document()
for label, value in facts.items():
    document.add_paragraph(f"{label}={value}")
output = "/workspace/report.docx"
document.save(output)
visible = visible_text(Document(output))
for label, value in facts.items():
    assert f"{label}={value}" in visible
print(output)
```

Use the user's exact labels as the keys. If a label names a count, total, or other scalar summary, use the scalar result as its value and put the detailed records in a separate list or table. Add headings, tables, and styles around these fact paragraphs, but keep each complete `LABEL=value` or `LABEL: value` pair in one paragraph or table row.

Preserve unrelated text, run formatting, page setup, relationships, tables, and headers/footers. For a new document, use real paragraphs, headings, lists, margins, and tables rather than layout made from newlines.

Use separate `print()` calls or `\n` escapes for diagnostic output. Never put a literal line break inside a single-quoted, double-quoted, or formatted string. After a syntax failure, write one shorter complete program without optional diagnostic formatting.

Save under `/workspace`, reopen the result, and verify requested facts and structure before declaring the requested DOCX.
