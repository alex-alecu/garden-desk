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

Use `openpyxl` for local workbook work. Prefer one complete bounded program over many exploratory steps.

## Reading and analysis

1. Discover requested workbooks case-insensitively inside the program. Inspect the complete requested hierarchy rather than guessing paths, extensions beyond the request, worksheet names, or column positions.
2. Use `load_workbook(path, read_only=True, data_only=True)` for analysis. In read-only mode, call `worksheet.reset_dimensions()` on each worksheet before iteration when workbook metadata may understate the used range; never call it on the workbook. After resetting dimensions, do not compare `max_row` or `max_column`; either may be `None`. Iterate every requested worksheet with one `iter_rows(values_only=True)` iterator, consume the header from that iterator, then continue the same iterator for data rows.
3. Normalize header text with `str(value).strip().casefold()` and locate requested columns case-insensitively. A missing required column is an error, not evidence of zero matching rows: report it, keep progress incomplete, and exit nonzero instead of swallowing `ValueError` or `IndexError`. Match user criteria case-insensitively where appropriate. Parse requested numeric values deliberately; skip or report malformed values instead of silently coercing them. Compute each requested count, total, average, or grouping from the matching records—not from file, worksheet, or row counts.
4. Close every workbook in a `finally` block. Suppress known library warnings only when they would otherwise put non-error text on stderr; do not hide parsing errors.
5. For a corpus likely to exceed one execution window, use a sorted corpus list and an atomic checkpoint under `/workspace`. Persist completed relative paths and cumulative result state. On every continuation, rediscover the corpus, reconcile changes, skip completed files, and never double-count restored values.
6. On every successful corpus-analysis exit, print `VAULT_PROGRESS_DONE=<integer>`, `VAULT_PROGRESS_TOTAL=<integer>`, and `VAULT_PROGRESS_COMPLETE=<0-or-1>`, each on its own newline-terminated line. Never concatenate markers or suppress their line endings. DONE counts only workbooks read without a handled or unhandled error; TOTAL counts the requested workbook corpus. A caught workbook error must keep COMPLETE at 0 and the program must exit nonzero after recording a concise error on stderr. Every successful exit must leave stderr completely empty: do not print file discovery, status, warnings, or debug text there. Any stderr on exit code 0 makes the result unverified. Set COMPLETE to 1 only after every requested workbook was read successfully. Print final requested labels only when COMPLETE is 1.

## Creation and editing

1. Preserve sheets, formulas, styles, dimensions, merges, and freeze panes that the user did not ask to change. Never save a workbook loaded with `data_only=True`, because that can replace formulas with cached values.
2. Use restrained formatting: descriptive title, clear headers, sensible column widths, numeric/date formats, frozen header rows, and filters when they improve usability.
3. Save beneath `/workspace`, keep intermediates separate, then reopen with `data_only=False` and verify requested sheets, labels, values, formulas, styles, merges, and dimensions before declaring the artifact. Explain that `openpyxl` does not calculate new formulas.
4. Pass only a flat sequence of scalar cell values to `Worksheet.append()`. Never pass a source row tuple or a converted list as one nested cell; spread copied values into the output row or join them into one scalar string.

## Oversized tabular results

1. The chat response can contain at most 100 lines and 64,000 characters. Before printing a complete requested table, estimate whether every row can fit.
2. When a complete tabular result cannot fit, create one verified XLSX workbook in `/workspace` instead of printing, abbreviating, or silently omitting rows. This overflow workbook is a required result deliverable even when the user did not name a filename or file type.
3. Choose a concise descriptive `.xlsx` filename, preserve every requested row and column as scalar cells, reopen the workbook, and verify the exact result count before completion.
4. Print only a concise result count plus the normal progress markers, then declare the verified workbook in the final `artifacts` field. Never claim that an undeclared workspace file was delivered.

## Verification

- [ ] Complete requested corpus and worksheet coverage is evidenced.
- [ ] Aggregates are derived from the requested records and one consistent cumulative state.
- [ ] Progress, stdout labels, checkpoints, and artifacts agree.
- [ ] Existing formulas and unrequested workbook content are preserved.
- [ ] Every generated or edited workbook reopens successfully and contains the requested visible results.
