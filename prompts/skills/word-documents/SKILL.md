---
name: word-documents
description: Use for DOCX files and Word deliverables. Before any legacy .doc access, load this skill; never use generic read or cat for binary DOC.
---

## Library

Use the installed `python-docx` through `python` for `.docx`. Do not install packages, and do not use `bash` or a shell to read one.

For legacy `.doc`, `antiword` is installed; run `LC_ALL=C antiword -m UTF-8.txt -w 0 <path>` with `bash` to get the text.

## Find The Files

Search `/source` recursively for files ending in `.docx` or `.doc`, case-insensitive.

## Recipe

```python
from docx import Document

document = Document(path)
for paragraph in document.paragraphs:
    print(paragraph.text)
for table in document.tables:
    for row in table.rows:
        print([cell.text for cell in row.cells])
```

To create or edit a `.docx`, load it with `Document(path)`, add or change paragraphs, table rows, or styles, then `document.save(path)`. Never create or edit a `.doc`; produce a `.docx` deliverable instead.

## Verify

Reopen every `.docx` you write with `Document(path)` and assert its paragraph or table row count matches what you intended.

## Gotchas

- A table's text lives in `table.rows`, not in `document.paragraphs`.
- Tables become plain text; `.doc` layout and embedded content are lost when read through `antiword`.
- `antiword` output is source text only; you cannot edit a `.doc` file with it.
- On an encrypted, corrupt, or mislabeled file, stop and report it; there is no fallback reader.
- Cite results by path and section, or by paragraph number for a `.doc` extract.
