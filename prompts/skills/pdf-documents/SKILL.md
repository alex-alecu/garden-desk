---
name: pdf-documents
description: PDF reading, page work, creation. Load for PDF input or deliverable.
---

# PDF Documents

Use `pypdf` for text, structure, order, facts; no `try`, exception wrapper, or trailing brace. `PdfWriter.add_metadata()` uses slash keys: `{"/Title": "Report"}`. ReportLab Platypus: headings/page breaks/margins/fitting tables.

Without PDF output: inspect/reopen with `pypdf` only. Use one source-only `python` call; no `list` or saved script. Do not create `/workspace/report.pdf` or require `/source/values.txt`:

```python
from pathlib import Path
from pypdf import PdfReader

for source in sorted(path for path in Path("/source").rglob("*") if path.is_file() and path.suffix.lower() == ".pdf"):
    reader = PdfReader(source)
    for page in reader.pages:
        print(page.extract_text() or "")
```

Only for requested PDF output:

- In one `pypdf` program, derive requested labels directly from the actual source PDF. Do not assume `/source/values.txt`, `COUNT`, `TOTAL`, or `report.pdf`.
- Use the task-specified output name. Put each derived result in visible ReportLab PDF text as exact `LABEL=value`; keep the requested label unchanged.

Do not copy prior values. Reopen/verify text, page count/order, rotation, size, metadata, and every requested pair before completion.
