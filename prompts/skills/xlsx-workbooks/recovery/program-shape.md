Use this short artifact-first shape; do not add a chat-table branch.

1. Import only `os`, `sys`, and `load_workbook, Workbook` from `openpyxl`.
2. At top level, build one sorted recursive corpus, create one output `Workbook`, and set `done = 0` and `header_written = False`.
3. For each path, open read-only/data-only; for each sheet consume `header = next(rows)`. On the first eligible sheet append `["Source", "Sheet", *header]` once. Append every matching scalar row as `[path, sheet.title, *row]`.
4. Close the input and increment DONE only after every sheet succeeds. On error print one concise stderr line and exit nonzero.
5. Save the output under `/workspace`, reopen it read-only, assert its header and compare integer `max_row` directly to the full expected row count, then close it. Never call `len(max_row)`.
6. Print no result rows or prose. After every loop, print exactly one DONE, TOTAL, and COMPLETE marker set.

Use no helper function, `Table`, `PageSetup`, style/page imports, output-size branch, repeated comments, or optional second verification program.
