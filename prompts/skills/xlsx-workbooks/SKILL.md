---
name: xlsx-workbooks
description: XLSX workbook work. Load for XLSX, Excel workbook, or spreadsheet deliverable.
---

recursively find case-insensitive `.xlsx` in absolute `/source`; use `openpyxl`/stdlib, no `pandas`. `load_workbook(path, data_only=True)`; never `read_only=True` (exports omit dimensions and read as empty). `len(row)` before index. Cite path/sheet/row; print Markdown/JSON verbatim.

Read a file's first rows; find the header by label, not index; map columns from labels. Relative dates from the clock. Settle date order from a day over 12 or the period label; never guess. Report, never skip, unparsed or unreadable input; no bare `except`. List matches, then aggregate; stop if aggregated < matched.

Edit `data_only=False`; save/reopen `/workspace`; assert changed/preserved. `Workbook` filter: `output_sheet.append([source_path,sheet_name,*row_values])`; no row number; reopen/assert count/identity. Large XLSX: no spill. Normal library stderr: not failure; exit status/reopened output control success.

Small: one pass. Else reusable: source+`steps/...` saves `/workspace/steps`; repair as primary; rerun path only. `checkpoint=Path("/workspace/steps/checkpoint.json")`; `temporary=Path("/workspace/steps/checkpoint.json.tmp")`. JSON: sorted relative corpus; `completed`; per-file SHA-256 identity/rows/counts/totals. Per-file replace/recompute contribution; write `temporary`; `os.replace(temporary,checkpoint)`. At `deadline=time.monotonic()+75`, save progress; successful continuation exit reports concise progress before next file: `SystemExit(0)`. Resume: remove missing/changed state; skip same identity; no double count. Only when `completed` equals rediscovered current corpus: create/reopen final workbook; `checkpoint.unlink()`.
