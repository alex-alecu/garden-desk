---
name: word-documents
description: Local Word reading, DOCX editing, and creation. Before any legacy .doc access, load this skill; never use generic read or cat for binary DOC. Use it for DOCX files, Microsoft Word documents, and Word deliverables.
---

# Word Documents

Suffix: binary legacy `.doc` is read-only input. Load this skill before any DOC access; never use generic `read` or `cat`. `python-docx` is for DOCX. Never create/edit `.doc`; new Word output is `.docx`.

Legacy: the only approved extraction is Python `subprocess.run(["/usr/bin/antiword", "-m", "UTF-8.txt", "-w", "0", str(source)])` with one discovered absolute `/source` or `/run/attachments` path, never shell text. Accept only zero exit, `result.stdout.decode("utf-8", errors="strict")`, and nonblank text. Tables become plain text; layout, images, comments, macros, and objects are not preserved. Encrypted, corrupt, HTML, XML, ZIP, or text failure: unsupported and stop; no `python-docx`, `strings`, OLE, network, installer, or converter fallback. DOC edit: unsupported; requested DOCX from text states layout loss.

DOCX: inspect paragraphs, tables, styles, sections, headers, and footers; one program makes only the request, saves `/workspace`, and reopens/asserts text/styles. Derive source facts in it; exact `LABEL=value` or `LABEL: value` is one paragraph or row. Preserve unrelated content, format, setup, and relationships; use real structures, not layout newlines. Separate `print()`/`\n`; after syntax error use a shorter complete program. Reopen and verify facts and structure.
