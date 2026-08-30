---
name: xlsx-workbooks
description: XLSX workbook work. Load for XLSX, Excel workbook, or spreadsheet deliverable.
---

recursively find case-insensitive `.xlsx` in `/source`; use installed `openpyxl` through `python`; no `bash`, package installs, or `pandas`. `load_workbook(path, data_only=True)`; never `read_only=True` (exports can be empty). `len(row)` before index. Cite path/sheet/row; exact output.

Find real header below preamble; map columns by label. Relative dates use clock. Settle date order from period label/names/leading number over 12; never guess. Never skip unparsed/unreadable input; no bare `except`. Print files/matched/parsed/mapped/grouped; stop if grouped < matched.

Edit `data_only=False`; save/reopen `/workspace`; assert changed/preserved. `Workbook` filter: `output_sheet.append([source_path,sheet_name,*row_values])`; no row number; reopen/assert count/identity. Large XLSX: no spill. Normal library stderr: not failure; exit status/reopened output control success.

Small: one source-only `python` call, no script. Else reusable: source+`steps/...` saves `/workspace/steps`; repair as primary; rerun path only. `checkpoint=Path("/workspace/steps/checkpoint.json")`; `temporary=Path("/workspace/steps/checkpoint.json.tmp")`. JSON: sorted relative corpus; `completed`; per-file SHA-256 identity/rows/counts/totals. Per-file replace/recompute contribution; write `temporary`; `os.replace(temporary,checkpoint)`. At `deadline=time.monotonic()+75`, save progress; successful continuation exit reports concise progress before next file: `SystemExit(0)`. Resume: remove missing/changed state; skip same identity; no double count. Only when `completed` equals rediscovered current corpus: create/reopen final workbook; `checkpoint.unlink()`.
