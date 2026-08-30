---
name: terminal-commands
description: Terminal commands: source inspection, folder discovery, text search, small pipelines. Load for selected-folder shell evidence.
---

## When To Use

Use `bash` for a direct, one-step command: moving or renaming a file, checking an exit code, running an installed program. Prefer Python or Node for parsing, control flow, or anything with more than one step of logic.

## Find The Files

`list` already returns the recursive tree under a guest path; use it instead of a shell listing.

## Recipe

```bash
find /source -iname "*.csv"
```

Use exact paths you have already seen; an empty result means no match.

## Verify

Check the exit code and the actual output text before you treat a command as successful.

## Gotchas

- `grep` and shell text search do not reach inside XLSX, DOCX, or PDF; they are compressed containers. Read them with a Python program instead.
- `/source` holds the selected folder; `/workspace` holds your generated work.
- For output too long to show inline, the tool result names the saved file's path; read that with `read` or `grep`.
