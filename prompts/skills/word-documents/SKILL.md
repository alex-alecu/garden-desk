---
name: word-documents
description: Guides local Microsoft Word reading and DOCX editing and creation. Use when the task identifies a .docx file, a legacy .doc file, a Microsoft Word document, or a Word deliverable. Legacy DOC is read-only plain-text input; all created Word outputs are DOCX.
---

# Word Documents

Choose the workflow from the actual file suffix. Use `python-docx` for `.docx` reading, editing, and creation. Use Antiword only for plain-text reading of legacy binary `.doc` input. Never create or edit a `.doc` file. Create every new Word document as `.docx`.

## Read Legacy DOC Input

Run Antiword from Python with a subprocess argument list so an untrusted file name is never shell text. Run one file per process. Use the exact discovered absolute path under `/source` or `/run/attachments`:

```python
from pathlib import Path
import os
import subprocess

source = Path("/source/example.doc")
try:
    result = subprocess.run(
        ["/usr/bin/antiword", "-m", "UTF-8.txt", "-w", "0", str(source)],
        capture_output=True,
        check=False,
        env={**os.environ, "LANG": "C", "LC_ALL": "C", "LC_CTYPE": "C"},
        timeout=30,
    )
except subprocess.TimeoutExpired as error:
    raise RuntimeError("Unsupported legacy DOC input: Antiword timed out") from error
if result.returncode != 0:
    detail = result.stderr.decode("utf-8", errors="replace").strip()
    raise RuntimeError(f"Unsupported legacy DOC input: {detail or 'Antiword failed'}")
try:
    text = result.stdout.decode("utf-8", errors="strict")
except UnicodeDecodeError as error:
    raise RuntimeError("Unsupported legacy DOC input: Antiword output is not valid UTF-8") from error
if not text.strip():
    raise RuntimeError("Unsupported legacy DOC input: no text was extracted")
print(text)
```

Accept extracted text only after exit code zero and strict UTF-8 decoding. Tables can become plain text. Images, layout, comments, macros, and embedded objects are not preserved. If the input is encrypted, corrupt, HTML, XML, or ZIP-based, report that the legacy DOC input is unsupported and stop work on that file. Do not use `python-docx`, `strings`, raw OLE parsing, network access, an installer, or another converter as a fallback.

If the user asks to edit a `.doc`, report that source editing is unsupported. Create a new `.docx` from the extracted text only when the user explicitly requests a new output document, and state that the original layout is not preserved.

## Read, Edit, Or Create DOCX

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

Save every requested Word output as `.docx` under `/workspace`, reopen it, and verify the requested facts and structure before declaring it.
