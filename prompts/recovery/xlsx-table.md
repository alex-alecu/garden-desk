The previous Python table formatter produced inconsistent Markdown columns, split a source line around Markdown pipe characters, emitted an invalid escape-sequence warning, or called `reset_dimensions()` on a normal OpenPyXL `Worksheet`.

Replace it with one fresh, complete, small program. Construct the table separator with `chr(124)` and join cells with that variable; replace embedded separators in cell text with a space instead of a backslash escape. Keep every source-array item as one complete Python line, print the requested GFM table, and include the required XLSX coverage markers.

Use `load_workbook(..., read_only=True, data_only=True)` before calling `reset_dimensions()` when scanning source workbooks with collapsed dimension metadata. When reopening the generated `/workspace` workbook normally, do not call `reset_dimensions()`.
