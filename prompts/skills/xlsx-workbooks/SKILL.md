---
name: xlsx-workbooks
description: Guides local XLSX workbook exploration, reading, editing, creation, and corpus analysis. Use when the task explicitly identifies XLSX, an Excel workbook, or a spreadsheet deliverable.
---

# XLSX Workbooks

Explore before filtering or editing. Work from absolute `/source` paths. Find files case-insensitively by walking `/source` and checking `path.suffix.lower()` rather than assuming lowercase extensions. Inspect one representative workbook's sheet names and first roughly 25 nonempty rows, then identify the real header row instead of assuming row one. After the structure is understood, process the corpus in one coherent program.

Use only `openpyxl` and Python's standard library for workbook analysis. Do not import `pandas`; it is not installed. A reliable read-only inspection shape is:

```python
from pathlib import Path
from openpyxl import load_workbook

files = sorted(path for path in Path("/source").rglob("*") if path.suffix.lower() == ".xlsx")
workbook = load_workbook(files[0], read_only=True, data_only=True)
for sheet in workbook.worksheets:
    sheet.reset_dimensions()
    for number, row in enumerate(sheet.iter_rows(values_only=True), 1):
        if number > 25:
            break
        print(number, row)
```

For every read-only sheet, call `reset_dimensions()` before iterating. Rows after the header may be shorter than the header: check `len(row)` before every indexed access. Map columns by their semantic role from observed headers and values: distinguish credits, debits, and unsigned amounts by the workbook's own labels, signs, flow/direction fields, and row context. Do not rely on fixed English-only keyword lists or fixed column positions. Keep every matching transaction row, not only one aggregate per file, and reconcile the row count and numeric total before answering. Compute every sum, grouping, or derived value in the program and present its printed output verbatim; do not aggregate rows mentally or copy values from earlier output into new code. Print compact Markdown or JSON with the standard library; do not add a dataframe dependency for presentation.

For edits, open normally with formulas preserved and change only requested cells. Keep the edit in one small program: locate the case-insensitive file, load it with `data_only=False`, make the requested changes, save it under `/workspace`, reopen it, and assert the changed and preserved values. Do not add optional status formatting or large inspection loops to this program.

For a filtered workbook, create a new `Workbook`, append one header, and use `output_sheet.append([source_path, sheet_name, *row_values])` for each matching source row. Do not write with the source row number because row numbers restart in each input file and can overwrite earlier matches. Reopen the saved workbook and assert the complete row count and representative identity values.

For analysis, keep the full source path, sheet name, and all original source columns with every result. Build each result from the observed header and complete row, such as `dict(zip(headers, row, strict=False))`; do not select only the amount and description columns. Do not shorten file names, identifiers, or source cell values. Normal library warnings written to stderr are not failure; evaluate the program result and reopened output instead.

If the complete result is too large for one chat answer, create a normal XLSX deliverable under `/workspace` in the same corpus-processing program. Do not print the complete result, read a `.vault-output` spill repeatedly, or use an internal spill file as the deliverable.

Save requested outputs under `/workspace`, reopen them, and verify the requested values and workbook structure before declaring the requested XLSX.
