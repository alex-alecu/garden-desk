---
name: xlsx-workbooks
description: Guides local XLSX workbook creation, reading, editing, and large-corpus processing. Use when the task or an attachment explicitly identifies XLSX, an Excel workbook, or a spreadsheet deliverable.
trigger-extensions: .xlsx
trigger-keywords: xlsx, excel, excel workbook, excel spreadsheet, workbook, workbooks, spreadsheet, spreadsheets, invoice, invoices, salary, salaries, transactions, advances, tranzacții, tranzactii, salarii, avansuri, tabel
uses-progress-markers: true
repair-triggers: SyntaxError: invalid syntax=>python-syntax;; SyntaxError:[^\n]{0,80}was never closed=>python-syntax;; unterminated string literal=>table;; invalid escape sequence=>table;; Worksheet[^\n]{0,80}reset_dimensions=>table;; Cannot convert[^\n]{0,240}to Excel=>row-serialization;; Error processing=>analysis-error
produces-deliverables: true
---

# XLSX Workbooks

Use `openpyxl`. Prefer one complete bounded program over many exploratory steps.

## Reading and analysis

1. Discover requested workbooks case-insensitively by walking `/source` (the read-only selected folder; "current folder" means `/source`, not `.` or `/workspace`) and testing `filename.lower().endswith(".xlsx")`; never give `endswith` a glob or alternation like `"(.xlsx|xls)"`, reuse a shell path list, or guess paths, extensions, worksheets, or columns.
2. Use `load_workbook(path, read_only=True, data_only=True)`. In read-only mode call `worksheet.reset_dimensions()` on each worksheet (never the workbook) before iterating when metadata may understate the range, then do not compare `max_row`/`max_column` (either may be `None`). Iterate every requested worksheet with one `iter_rows(values_only=True)` iterator, consume the header from that iterator, then continue the same iterator for data rows.
3. Normalize header text with `str(value).strip().casefold()` and locate requested columns case-insensitively. A missing required column is an error, not evidence of zero matching rows: report it, keep progress incomplete, and exit nonzero instead of swallowing `ValueError` or `IndexError`. Match user criteria case-insensitively where appropriate. Parse requested numeric values deliberately; skip or report malformed values instead of silently coercing them. Compute each requested count, total, average, or grouping from the matching records—not from file, worksheet, or row counts. Render a `values_only` row tuple as a table row with `"| " + " | ".join("" if c is None else str(c) for c in row) + " |"`, giving every field (including the amount) its own full-value cell; never index it by string key, fixed-width slice a cell, drop fields, append `...`, or round.
4. Close every workbook in a `finally` block. Suppress known library warnings only if they would otherwise write non-error stderr; never hide parsing errors.
5. For a corpus likely to exceed one execution window, use a sorted corpus list and an atomic checkpoint under `/workspace` holding completed paths and cumulative state. On each continuation, rediscover the corpus, reconcile changes, skip completed files, and never double-count restored values.
6. On every successful corpus-analysis exit, print `VAULT_PROGRESS_DONE=<integer>`, `VAULT_PROGRESS_TOTAL=<integer>`, and `VAULT_PROGRESS_COMPLETE=<0-or-1>`, each on its own newline-terminated line via a separate `print()`; never concatenate adjacent f-strings, which drops the newlines. DONE counts only workbooks read without a handled or unhandled error; TOTAL counts the requested workbook corpus. A caught workbook error must keep COMPLETE at 0 and exit nonzero after a concise stderr error. Every successful exit must leave stderr completely empty: do not print discovery, status, warnings, or debug text there. Any stderr on exit code 0 makes the result unverified. Set COMPLETE to 1 only after every requested workbook was read successfully. Print final requested labels only when COMPLETE is 1.

## Creation and editing

1. Preserve sheets, formulas, styles, dimensions, merges, and freeze panes the user did not ask to change. Never save a workbook loaded with `data_only=True`, which can replace formulas with cached values.
2. Use restrained formatting: descriptive title, headers, sensible widths, numeric/date formats, frozen header rows, and useful filters.
3. Save beneath `/workspace`, keep intermediates separate, then reopen with `data_only=False` and verify sheets, labels, values, formulas, styles, merges, and dimensions before declaring it. `openpyxl` does not calculate new formulas.
4. Pass only flat scalar cell values to `Worksheet.append()`; never pass a row tuple or list as one nested cell. Spread copied values into the row or join them into one scalar string.

## Oversized tabular results

1. The chat response holds at most 100 lines and 64,000 characters; before printing a full table, estimate whether every row fits.
2. When a complete tabular result cannot fit, create one verified XLSX workbook in `/workspace` instead of printing, abbreviating, or omitting rows; it is a required deliverable even if the user named no filename.
3. Choose a concise descriptive `.xlsx` filename, preserve every requested row and column as scalar cells, then reopen and verify the exact result count.
4. Print a concise result count plus the progress markers, then declare the verified workbook in the `artifacts` field. Never claim that an undeclared workspace file was delivered.

## Verification

- [ ] Complete requested corpus and worksheet coverage is evidenced.
- [ ] Aggregates are derived from the requested records and one consistent cumulative state.
- [ ] Progress, stdout labels, checkpoints, and artifacts agree.
- [ ] Existing formulas and unrequested content are preserved.
- [ ] Every generated or edited workbook reopens successfully and contains the requested visible results.
