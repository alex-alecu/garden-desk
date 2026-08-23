---
name: xlsx-workbooks
description: XLSX workbook work. Load for XLSX, Excel workbook, or spreadsheet deliverable.
---

recursively find case-insensitive `.xlsx` in absolute `/source`; use `openpyxl`/stdlib, no `pandas`. `load_workbook(path, read_only=True, data_only=True)` program inspects sheets/header. Read-only: `reset_dimensions()`; `len(row)` before index. Map layout; no fixed terms/positions. Match rows/path/sheet/cells; calculate/reconcile counts/totals; print Markdown/JSON verbatim.

Edit `data_only=False`; save/reopen `/workspace`; assert changed/preserved. `Workbook` filter: `output_sheet.append([source_path,sheet_name,*row_values])`; no row number; reopen/assert count/identity. Large XLSX: no spill. Normal library stderr: not failure; exit status/reopened output control success.

Small: one pass. Else reusable program. `checkpoint=Path("/workspace/checkpoint.json")`; `temporary=Path("/workspace/checkpoint.json.tmp")`. JSON: sorted relative corpus; `completed`; per-file SHA-256 identity/rows/counts/totals. Per-file replace/recompute contribution; write `temporary`; `os.replace(temporary,checkpoint)`. At `deadline=time.monotonic()+75`, save progress; successful continuation exit reports concise progress before next file: `SystemExit(0)`. Resume: remove missing/changed state; skip same identity; no double count. Only when `completed` equals rediscovered current corpus: create/reopen final workbook; `checkpoint.unlink()`.
