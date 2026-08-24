---
name: word-documents
description: Use for DOCX files, Word documents, and Word deliverables. Before any legacy .doc access, load this skill; never use generic read or cat for binary DOC.
---

# Word Documents

Suffix: legacy binary `.doc` is read-only. Load this skill before any DOC access; never use generic `read` or `cat`. Use `python-docx` for DOCX. Never create/edit `.doc`; create `.docx`.

Legacy: use this complete Python pattern with an absolute `/source` or `/run/attachments` path. No shell. Require zero exit, strict UTF-8, and nonblank text. Tables become text; layout and embedded content are lost. On encrypted, corrupt, mislabeled, or text failure, stop. No fallback. DOC edit is unsupported; DOCX states layout loss.

```python
import os, subprocess
from pathlib import Path
source=next(iter([*Path("/source").glob("*.doc"),*Path("/run/attachments").glob("*.doc")]))
result=subprocess.run(["/usr/bin/antiword", "-m", "UTF-8.txt", "-w", "0", str(source)], capture_output=True, check=False, env={**os.environ, "LANG": "C", "LC_ALL": "C", "LC_CTYPE": "C"}, timeout=5)
if result.returncode != 0: raise RuntimeError("read failed")
text=result.stdout.decode("utf-8", errors="strict")
if not text.strip(): raise RuntimeError("No text")
print(text)
```

Submit unchanged at top level. No fallback, `try`/`except`, `text=True`, decode change, or failure output. Keep both raises.

DOCX: inspect paragraphs, tables, styles, sections, headers, footers. One program edits, saves `/workspace`, reopens, and asserts text/styles. Keep each exact `LABEL=value` or `LABEL: value` in one paragraph or row. Preserve other content, format, setup, and relationships; use structures, not layout newlines. Separate `print()`/`\n`; after syntax error use a shorter program.
