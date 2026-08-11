---
name: xlsx-workbooks
description: Guides local XLSX workbook creation, reading, editing, and large-corpus processing. Use when the task or an attachment explicitly identifies XLSX, an Excel workbook, or a spreadsheet deliverable.
trigger-extensions: .xlsx
trigger-keywords: xlsx, excel, excel workbook, excel spreadsheet, workbook, workbooks, spreadsheet, spreadsheets, invoice, invoices, salary, salaries, transactions, advances, tranzacții, tranzactii, salarii, avansuri, tabel
uses-progress-markers: true
progress-exclude-keywords: edit, change, update, replace, modify
repair-triggers: SyntaxError: invalid syntax=>python-syntax;; SyntaxError:[^\n]{0,80}was never closed=>python-syntax;; unterminated string literal=>table;; invalid escape sequence=>table;; Worksheet[^\n]{0,80}reset_dimensions=>table;; Cannot convert[^\n]{0,240}to Excel=>row-serialization;; Error processing=>analysis-error
source-rejections: str\(h\)[^\n]{0,80}for\s+i\s+in\s+range\(len\(header\)\)=>invalid;; ^(\s*)for\s+\w+\s+in\s+\w+\.worksheets\s*:[\s\S]{0,2000}^\1\s+(?:DONE|done)\s*\+=\s*1\b=>progress_inside_loop;; from\s+openpyxl\.worksheet\.page_setup\s+import\s+PageSetup\b=>unsupported_document_api;; \blen\(\s*[^\n)]*\.max_row\s*\)=>unsupported_document_api;; ^\s*([A-Za-z_]\w*)\s*=\s*Workbook\s*\([\s\S]{0,3000}\b\1\.load_workbook\s*\(=>unsupported_document_api
source-removals: from openpyxl.worksheet.page_setup import PageSetup=>PageSetup
produces-deliverables: true
---

# XLSX Workbooks

Use `openpyxl`. Follow requested names, cells, columns, and facts literally. Prefer one bounded program.

## Reading and analysis

1. Build one complete sorted corpus with recursive `os.walk('/source')` and `name.casefold().endswith(".xlsx")`; set TOTAL before opening files. Include upper/mixed-case extensions. Never use flat `os.listdir`/`glob`, guess paths, or break early. Keep simple counters and loops at top level.
2. Analyze with `load_workbook(path, read_only=True, data_only=True)`. For each `sheet in workbook.worksheets`, use `rows = sheet.iter_rows(values_only=True)`, `header = next(rows)`, and `{str(value).casefold(): index for index, value in enumerate(header)}`. Row values are scalars: never use `.value` or assume positions. Use `reset_dimensions()` only for proven bad read-only metadata.
3. Locate roles from header aliases, then test row values; never search target words in header names. Use `flow_index` from `cash_flow`/`direction`/`flow` and text indexes from `category`/`description`/`note`. With flow, require incoming/inflow/credit plus revenue/sale/customer-payment/received; without flow, match unambiguous revenue text in the full row.
4. If the task asks for a table here or in chat, print the complete table directly and do not create or save a workbook unless one is also explicitly requested. A complete chat table uses columns `["Source", "Sheet", *header]` and results `[path, sheet.title, *row]`. With `sep = chr(124)`, emit columns, `["---"] * len(columns)`, then each full result. Never nest fields in `Data`, multiply `sep`, slice, truncate, omit, or round.
5. Close workbooks in `finally`. For long corpora atomically checkpoint completed sorted paths and cumulative results. After all loops, leave stderr empty and print `VAULT_PROGRESS_DONE`, `VAULT_PROGRESS_TOTAL`, and `VAULT_PROGRESS_COMPLETE` exactly once; COMPLETE is 1 only when DONE equals TOTAL.

## Creation and editing

1. Edit in normal mode with `data_only=False`; change only requested cells and only the top-left cell of a merge. Preserve formulas, styles, dimensions, merges, panes, filters, sheet order/visibility, and unrelated content. OpenPyXL does not calculate formulas.
2. For filtered output use one flat program with `os`, `load_workbook`, and `Workbook`; preserve the source header and append scalar rows `[source_path, sheet.title, *row]`. Import no unused page/style helpers.
3. Save under `/workspace`, reopen normally, and verify requested values plus preserved structure before declaration.

## Oversized tabular results

For all/every/complete rows from multiple workbooks, create and reopen one XLSX with every requested row and column unless the task explicitly requires a direct chat table; do not render a chat table first or branch after printing it. Also use XLSX above 100 lines or 64,000 characters. Never abbreviate or claim an undeclared file.

## Verification

- [ ] Corpus, rows, aggregates, progress, and artifacts agree.
- [ ] Edited structure is preserved and every output reopens with the requested results.
