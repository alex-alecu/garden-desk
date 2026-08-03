---
name: xlsx-workbooks
description: Guides verified local processing of XLSX Excel workbooks, including streaming, batching, checkpoints, coverage markers, and repair. Use when the task or observations mention Excel, XLSX, workbooks, spreadsheets, transactions, salaries, or advances.
---

# XLSX Workbooks

## Overview

Process the complete requested XLSX corpus with bounded Python source and explicit coverage evidence.

## Process

1. Discover workbook filenames case-insensitively, for example with `path.suffix.lower() == ".xlsx"`. Unless the user requested other formats, process only XLSX workbooks.
2. Before importing `openpyxl`, call `warnings.filterwarnings("ignore")` so library warnings do not make a successful execution unverifiable through stderr.
3. Use `openpyxl.load_workbook(path, read_only=True, data_only=True)`. Search text as a case-insensitive substring in every nonempty cell, not as equality or in an assumed column; use discovered headers for named columns.
4. Use one `rows = sheet.iter_rows(values_only=True)` iterator: read the header with `next(rows, ())`, then continue the same iterator for data rows. Iterate worksheets as for sheet in workbook.worksheets. Process the data rows inside every worksheet; never break or return from the worksheet loop after reading its header. Close each workbook in a finally block before opening another workbook.
5. With `os.walk`, keep the workbook accumulator distinct from the current filenames variable; never append to the filenames list while iterating it.
6. Choose the simplest bounded strategy. A program may discover and finish a small corpus in one short pass without checkpointing. Use resumable batching when the work may not fit comfortably inside the 75-second work window.
7. For resumable work, sort relative paths and atomically checkpoint the corpus path list, completed paths, next item, and cumulative results under `/workspace`. Restore cumulative values at process start and compute FILES_DONE from the complete restored set of completed workbook paths, never only the current batch. Measure the work window from a new monotonic timer on every execution; never persist or reuse an old start time.
8. For mixed formats, keep every requested branch reachable and checkpoint each format's completed paths and cumulative results so resumed executions never double count it. `python-docx` Document objects have no `close()` method.
9. Stop starting new workbook work after about 75 seconds. Never mark a workbook complete after a parse error; print the error to stderr and exit nonzero.
10. At every successful exit, print exactly `VAULT_XLSX_FILES_DONE=<integer>`, `VAULT_XLSX_FILES_TOTAL=<integer>`, and `VAULT_XLSX_COMPLETE=<0-or-1>`, each on its own line. DONE and TOTAL count XLSX workbooks only. DONE counts the complete restored set, and COMPLETE is the integer 0 or 1, never True, False, or a comparison expression. Set it to 1 only when DONE equals TOTAL and every discovered workbook was read.
11. Print requested final output labels only with `COMPLETE=1`. Intermediate cumulative values belong in the checkpoint.

## Red Flags

- Case-sensitive extension discovery.
- Reading only the first worksheet or stopping after its header.
- Reusing an old timer or rescanning completed work.
- Printing final labels without complete XLSX coverage markers.

## Verification

- [ ] DONE and TOTAL count the exact XLSX corpus and are equal for final output.
- [ ] COMPLETE is the integer 1 only after every workbook was read.
- [ ] Requested output labels appear only in verified final output.
