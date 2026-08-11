Use this short direct-table shape and keep the complete program under 80 lines.

1. Import only `os` and `load_workbook`.
2. At top level, build one sorted recursive XLSX corpus and initialize `done = 0`, `columns = None`, and `results = []`.
3. For each workbook and sheet, read `header = next(rows)`. Set `columns = ["Source", "Sheet", *header]` once and append each matching row as `[path, sheet.title, *row]`.
4. Close every workbook, increment DONE only after all its sheets succeed, and let any error fail the execution instead of swallowing it.
5. Set `sep = chr(124)`. Define `emit(cells)` using `print(sep + " " + (" " + sep + " ").join(str(value).replace(sep, " ") for value in cells) + " " + sep)`.
6. Call `emit(columns)`, call `emit(["---"] * len(columns))`, then `for result in results: emit(result)`. Never create a `Data` column, join `columns` into a delimiter, or save a workbook.
7. After all output rows, print exactly one DONE, TOTAL, and COMPLETE marker set.

Use no `main` function, helper besides `emit`, comments, generic column names, checkpoint file, or alternative output branch.
