Use this short aggregate-analysis shape and keep the complete program under 64 lines.

1. Import only `os`, `sys`, and `load_workbook`.
2. At top level, build one sorted recursive XLSX corpus; set `total = len(corpus)`, `done = 0`, and the requested numeric accumulators.
3. For each path, open one read-only/data-only workbook. Iterate every worksheet, consume its header, build the exact case-folded header map, and update the accumulators from scalar row values.
4. After every worksheet succeeds, close that workbook and increment `done` once outside the worksheet loop. On any error, print one concise stderr line and exit nonzero; never `pass` or continue with incomplete coverage.
5. After every loop, print each requested `LABEL=value` result, then exactly one `VAULT_PROGRESS_DONE={done}`, `VAULT_PROGRESS_TOTAL={total}`, and `VAULT_PROGRESS_COMPLETE={1 if done == total else 0}` marker set.

Use no `main` function, output workbook, comments, per-path marker prints, nested verification step, or optional branch.
