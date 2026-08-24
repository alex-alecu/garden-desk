---
name: word-documents
description: Use for DOCX files, Word documents, and Word deliverables. Before any legacy .doc access, load this skill; never use generic read or cat for binary DOC.
---

# Word Documents

Suffix: legacy binary `.doc` is read-only. Load this skill before any DOC access; never use generic `read` or `cat`. Use `python-docx` for DOCX. Never create/edit `.doc`; create `.docx`.

Legacy: use this complete Python pattern with a discovered absolute `/source` or `/run/attachments` path. Never use shell text. Require zero exit, strict UTF-8, and nonblank text. Tables become text; layout and embedded content are lost. Encrypted, corrupt, mislabeled, or text failure: stop as unsupported. No `python-docx`, `strings`, OLE, network, installer, or converter fallback. DOC edit is unsupported; requested DOCX states layout loss.

```python
from pathlib import Path
import os
import subprocess

source = next(Path("/source").glob("*.doc"))
result = subprocess.run(
    ["/usr/bin/antiword", "-m", "UTF-8.txt", "-w", "0", str(source)],
    capture_output=True,
    check=False,
    env={**os.environ, "LANG": "C", "LC_ALL": "C", "LC_CTYPE": "C"},
    timeout=5,
)
if result.returncode != 0:
    raise RuntimeError("DOC")
text = result.stdout.decode("utf-8", errors="strict")
if not text.strip():
    raise RuntimeError("DOC")
print(text)
```

DOCX: inspect paragraphs, tables, styles, sections, headers, and footers; one program makes only the request, saves `/workspace`, and reopens/asserts text/styles. Derive source facts in it; exact `LABEL=value` or `LABEL: value` is one paragraph or row. Preserve unrelated content, format, setup, and relationships; use real structures, not layout newlines. Separate `print()`/`\n`; after syntax error use a shorter complete program.
