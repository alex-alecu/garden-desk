---
name: pdf-documents
description: PDF reading, page work, creation. Load for PDF input or deliverable.
---

# PDF Documents

Use `pypdf` for text, structure, order, facts; no `try`, exception wrapper, or trailing brace. `PdfWriter.add_metadata()` uses slash keys: `{"/Title": "Report"}`. ReportLab Platypus: headings/page breaks/margins/fitting tables.

Without PDF output: inspect/reopen with `pypdf` only. Do not create `/workspace/report.pdf` or require `/source/values.txt`:

```python
from pypdf import PdfReader

reader = PdfReader("/source/input.pdf")
for page in reader.pages:
    print(page.extract_text() or "")
```

Only for requested PDF output: run the derive/create program. Requested `facts`: exact `LABEL=value`; derive `COUNT`/`TOTAL`, create, reopen, and assert:

```python
from pathlib import Path
from pypdf import PdfReader
from xml.sax.saxutils import escape
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate

values = list(map(int, Path("/source/values.txt").read_text(encoding="utf-8").split()))
facts={"COUNT":len(values),"TOTAL":sum(values)}
output = "/workspace/report.pdf"
styles = getSampleStyleSheet()
story = [Paragraph(escape(f"{label}={value}"), styles["BodyText"]) for label, value in facts.items()]
document = SimpleDocTemplate(output, pagesize=letter)
document.build(story)
visible = "\n".join(page.extract_text() or "" for page in PdfReader(output).pages)
for label, value in facts.items():
    assert f"{label}={value}" in visible
```

Do not copy prior values. Reopen/verify text, page count/order, rotation, size, metadata, and every requested pair before completion.
