Use this short multi-format analysis shape and keep the complete program under 64 lines.

1. Import only `os`, `sys`, `load_workbook`, `Document`, and `PdfReader`. Use top-level code with no `main` function or comments.
2. Build separate sorted recursive `.xlsx`, `.docx`, and `.pdf` corpora. Initialize only the requested fact accumulators plus `done = 0` and `total = len(xlsx_paths)`.
3. Process every XLSX workbook and worksheet with one iterator: `rows = sheet.iter_rows(values_only=True)`, then `header = next(rows)`, then loop over the remaining `rows`. Build one header map; require the requested names, then index it directly. Never call `dict.get` with three arguments. Close each workbook, then increment `done` once outside the worksheet loop.
4. In the same program, process each DOCX with one paragraph loop and each PDF with one page loop. On any format error, print one concise stderr line and exit nonzero; never `pass`, break, or continue with incomplete coverage.
5. After all format loops, print every requested `LABEL=value` fact, then exactly one DONE, TOTAL, and COMPLETE marker set.

Do not create the requested deliverable in this execution. Do not import `Workbook`, style helpers, or page-layout helpers. Do not embed multiline strings, self-corrections, prose, or optional branches. A later execution will create and reopen the deliverable from these recorded facts.
