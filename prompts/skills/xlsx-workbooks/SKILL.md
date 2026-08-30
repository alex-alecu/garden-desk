---
name: xlsx-workbooks
description: XLSX workbook work. Load for XLSX, Excel workbook, or spreadsheet deliverable.
---

## Library

Use the installed `openpyxl` through `python`. Do not install packages, and do not use `pandas`.

## Find The Files

Search `/source` recursively for files whose name ends in `.xlsx`, case-insensitive.

## Recipe

Read with `data_only=True` so formulas resolve to their last calculated values. Never pass `read_only=True`; some exports return empty cells under it.

```python
from openpyxl import load_workbook
workbook = load_workbook(path, data_only=True)
for row in workbook["Sheet1"].iter_rows(values_only=True):
    ...
```

Write a new sheet with `Workbook()`, or open an existing file with `data_only=False` to edit and resave it.

```python
from openpyxl import Workbook

workbook = Workbook()
workbook.active.append(["column_a", "column_b"])
workbook.save(path)
```

## Verify

Reopen every workbook you write and assert its row count matches what you intended to write. Print the count as evidence before you report the deliverable done.

## Gotchas

- Check `len(row)` before indexing into it; a short row raises `IndexError`.
- Find the real header row by its content; it is often below a preamble of title or note rows, not row 1.
- Catch the specific error you expect, never a bare `except`; report which file and row failed.
- Cite results by path, sheet name, and row number.
- A large workbook takes real time to load; that is normal, not a failure.
