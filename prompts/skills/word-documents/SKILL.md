---
name: word-documents
description: Local Word reading, DOCX editing, and creation. Before any legacy .doc access, load this skill; never use generic read or cat for binary DOC. Use it for DOCX files, Microsoft Word documents, and Word deliverables.
---

# Word Documents

`.doc` is read-only. Load before DOC access; do not use generic `read` or `cat`. `python-docx` is for DOCX. Do not edit `.doc`; output is `.docx`.

Top-level Python: `source` is a `Path` under `/source` or `/run/attachments`.

```python
import os, subprocess
from pathlib import Path
source=next(iter([*Path("/source").glob("*.doc"),*Path("/run/attachments").glob("*.doc")]))
result=subprocess.run(["/usr/bin/antiword", "-m", "UTF-8.txt", "-w", "0", str(source)], capture_output=True, check=False, env={**os.environ, "LANG": "C", "LC_ALL": "C", "LC_CTYPE": "C"})
if result.returncode != 0: raise RuntimeError("read failed")
text=result.stdout.decode("utf-8", errors="strict")
if not text.strip(): raise RuntimeError("No text")
```

Submit this unchanged unwrapped top-level Python program. Do not add a fallback program or `try`/`except` wrapper, change strict UTF-8 decode, use `text=True`, or turn extraction, decode, or blank failure into output. Keep both terminal raises.

Tables: plain text. Stop on encrypted, corrupt, HTML/XML/ZIP, or text failure. No `python-docx`, `strings`, OLE, network, installer, or converter fallback. DOC edit: unsupported; request DOCX; state layout loss.

DOCX: inspect paragraphs, tables, styles, sections, headers, footers; one program makes the request, saves `/workspace`, and reopens/asserts text/styles. Derive facts; exact `LABEL=value` or `LABEL: value` is one paragraph or row. Preserve unrelated content, format, setup, relationships; use structures, not layout newlines. Separate `print()`/`\n`; after syntax error use a shorter program.
