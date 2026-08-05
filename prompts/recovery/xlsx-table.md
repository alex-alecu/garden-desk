The previous Python table formatter split a source line around Markdown pipe characters or emitted an invalid escape-sequence warning.

Replace it with one fresh, complete, small program. Construct the table separator with `chr(124)` and join cells with that variable; replace embedded separators in cell text with a space instead of a backslash escape. Keep every source-array item as one complete Python line, print the requested GFM table, and include the required XLSX coverage markers.
