---
name: xlsx-workbooks
description: Guides local XLSX workbook creation, reading, editing, and large-corpus processing. Use when the task or an attachment explicitly identifies XLSX, an Excel workbook, or a spreadsheet deliverable.
---

# XLSX Workbooks

## Overview

Create or edit ordinary workbooks directly, and process complete requested XLSX corpora with bounded Python source and explicit coverage evidence.

## Process

For ordinary creation or editing, use `openpyxl`, preserve existing sheets and formulas unless the request changes them, and apply restrained number formats, alignment, borders, fills, and column widths. Never save a workbook loaded with `data_only=True`, because that replaces formulas with cached values. Reopen the saved workbook with `data_only=False` and verify requested sheets, values, formulas, styles, dimensions, merged cells, and freeze panes. If formulas were written, report that they were written but not locally calculated because `openpyxl` is not a spreadsheet calculation engine.

For existing-corpus analysis only, follow the rules below; skip them when creating a new workbook.

1. Discover the complete workbook corpus case-insensitively inside the Python source before loading a checkpoint or processing any workbook. With `os.walk`, use exactly `filename.lower().endswith(".xlsx")`; `filename.endswith(".xlsx")` is invalid because it misses uppercase names. Do not treat a shell-discovered or hard-coded path list as the complete XLSX corpus. Unless the user requested other formats, process only XLSX workbooks.
2. Before importing `openpyxl`, call `warnings.filterwarnings("ignore")` so library warnings do not make a successful execution unverifiable through stderr.
3. Use `openpyxl.load_workbook(path, read_only=True, data_only=True)`. Before iterating each read-only worksheet, call `sheet.reset_dimensions()` so stale or collapsed XLSX dimension metadata such as `A1:A1` cannot silently hide later rows and columns. Do not trust `max_row`, `max_column`, or `calculate_dimension()` as coverage evidence. Search text as a case-insensitive substring in every nonempty cell, not as equality or in an assumed column; use discovered headers for named columns.
4. For every matching row, parse the numeric amount-column value, increment the match count, and immediately add that amount to one cumulative total in the same match branch. Never only collect row amounts without adding them. Never use a workbook count, worksheet count, row count, or match count as the requested amount total.
5. Use one `rows = sheet.iter_rows(values_only=True)` iterator: read the header with `next(rows, ())`, then continue the same iterator for data rows. Iterate worksheets as for sheet in workbook.worksheets. Process the data rows inside every worksheet; never break or return from the worksheet loop after reading its header. Close each workbook in a finally block before opening another workbook.
6. With `os.walk`, keep the workbook accumulator distinct from the current filenames variable; never append to the filenames list while iterating it.
7. Choose the simplest bounded strategy. If the discovered corpus comfortably fits inside the 75-second work window, process it in one pass and do not create or load a checkpoint. Use resumable batching only when the work may not fit comfortably inside that window.
8. For resumable work, sort relative paths and atomically checkpoint the corpus path list, completed paths, next item, and cumulative results under `/workspace`. Iterate the sorted corpus paths directly and skip paths already in the completed set; do not build fragile `range(...)` expressions from checkpoint dictionary lookups. On every execution, compare the fresh case-insensitive corpus with the checkpointed corpus before trusting COMPLETE; include newly discovered paths and process them before final output. Restore cumulative values at process start and compute FILES_DONE from the complete restored set of completed workbook paths, never only the current batch. Measure the work window from a new monotonic timer on every execution; never persist or reuse an old start time.
9. For mixed formats, keep every requested branch reachable and checkpoint each format's completed paths and cumulative results so resumed executions never double count it. `python-docx` Document objects have no `close()` method.
10. Stop starting new workbook work after about 75 seconds. Never mark a workbook complete after a parse error; print the error to stderr and exit nonzero.
11. At every successful exit, print exactly `VAULT_XLSX_FILES_DONE=<integer>`, `VAULT_XLSX_FILES_TOTAL=<integer>`, and `VAULT_XLSX_COMPLETE=<0-or-1>`, each on its own line. DONE and TOTAL count XLSX workbooks only. DONE counts the complete restored set, and COMPLETE is the integer 0 or 1, never True, False, or a comparison expression. Set it to 1 only when DONE equals TOTAL and every discovered workbook was read.
12. The checkpoint, requested stdout labels, and any generated artifact must all read the same cumulative amount variable. Never substitute corpus or match counts for an amount total. Print requested final output labels only with `COMPLETE=1`; intermediate cumulative values belong in the checkpoint.

## Red Flags

- Case-sensitive extension discovery.
- Trusting an incomplete checkpoint corpus without comparing fresh case-insensitive discovery.
- Treating shell output or a hard-coded path list as the complete workbook corpus.
- Reading only the first worksheet or stopping after its header.
- Trusting worksheet dimension metadata instead of resetting read-only dimensions before iteration.
- Counting matches without immediately adding each matching amount to the cumulative total.
- Creating checkpoint machinery for a corpus that fits comfortably in one execution.
- Reusing an old timer or rescanning completed work.
- Writing different aggregate values to the checkpoint, stdout, and artifact.
- Printing final labels without complete XLSX coverage markers.

## Verification

- [ ] An edited workbook was never saved from a `data_only=True` load.
- [ ] New or edited sheets, formulas, values, and restrained styles survive reopening with `data_only=False`.
- [ ] Written formulas are not represented as locally calculated results.
- [ ] DONE and TOTAL count the exact XLSX corpus and are equal for final output.
- [ ] COMPLETE is the integer 1 only after every workbook was read.
- [ ] Every matching numeric amount was added immediately to the one cumulative total.
- [ ] Every read-only worksheet reset its dimensions before row iteration.
- [ ] Checkpoint, stdout, and artifact use the same aggregate, never a corpus or match count.
- [ ] Requested output labels appear only in verified final output.
