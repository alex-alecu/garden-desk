Current required phase: continue verified workbook progress.

Finish workbook coverage before processing another format or creating the deliverable. Resume a real saved checkpoint without rescanning completed files. If there is no checkpoint, DONE is zero, or the previous scan swallowed an error, replace it with one corrected bounded scan; do not reuse its aggregates.

With `values_only=True`, use `rows = sheet.iter_rows(values_only=True)`, `header = next(rows)`, and enumerate the scalar header values directly without `.value`, then continue the same iterator. Never catch and ignore workbook errors: print concise stderr, exit nonzero, and keep COMPLETE at 0.
