---
name: finance-document-review
description: Required first skill for every review or reconciliation of financial content. Load it before PDF, Word, or XLSX skills for invoices, bank statements, ledgers, workbooks, financial statements, annual reports, notes, audit reports, controls, management commentary, duplicates, missing records, mismatches, and reporting concerns.
---

# Finance Document Review

Load each relevant `word-documents`, `pdf-documents`, or `xlsx-workbooks` skill before reading the source files. Use only the supplied documents and any user-supplied reporting framework or review criteria. Do not assume tax, accounting, audit, or investment rules that are not in the supplied sources.

Inventory every reviewed file and record its entity, source type, period, currency, units, and available page, note, table, sheet, row, or cell locations. Report unreadable, encrypted, scanned, truncated, or unsupported content before drawing conclusions.

Assess the reliability of each source. Record whether it is original, converted, copied, internal, or external when the documents show this. Test the accuracy and completeness of company-produced data where the available records permit it. Give more weight to relevant, direct, original, and independently supported evidence. Report contradictory evidence and missing provenance. More records of the same poor quality do not resolve a reliability problem.

## Select The Review Mode

Use records mode for invoices, bank statements, ledgers, and workbooks. Use statements mode for primary financial statements, notes, policies, comparative periods, audit reports, controls, and management commentary. Use both modes when the source set contains both types.

## Review Records

Extract exact entity names, account names, record identifiers, dates, periods, counterparties, currencies, units, quantities, rates, tax, subtotals, totals, balances, and line items. Preserve signs and source precision.

Recalculate arithmetic from source values. Reconcile records by explicit identifiers first, then by clearly stated secondary fields. Label a duplicate as possible unless the source proves that it is the same transaction. Find missing records, unmatched entries, amount differences, currency differences, period differences, tax differences, and inconsistent entity or account details.

Do not combine currencies or apply exchange rates without an explicit conversion source. Do not silently replace missing values or select one conflicting value as correct.

## Review Statements

Identify the reporting entity, reporting period, comparative period, currency, units, stated reporting framework, and auditor opinion. Review the statement of financial position, profit and loss and other comprehensive income, changes in equity, cash flows, notes, accounting policies, and comparative information when present. Also check for a statement of financial position at the start of the preceding comparative period when a retrospective policy application, retrospective restatement, or reclassification has a material effect on that opening position.

Report an absent statement component, note set, or comparative period as missing coverage. Do not assume that it was not required.

Reconcile statement subtotals, ending cash, comparative values, note values, and repeated figures. Compare the primary statements with the notes, audit report, controls, and management commentary. Flag changed policies or estimates, restatements, going-concern text, qualified or disclaimed opinions, material weaknesses, related-party items, non-standard measures without reconciliation, and unexplained changes. Describe only what the supplied evidence supports.

Consider both amount and context when the user asks about materiality. Never use one fixed percentage as the only test.

## Report The Evidence

Return, in order:

1. Review basis and coverage.
2. Exceptions.
3. Reconciliations and observed trends.
4. Missing information and questions.
5. Review limits.

Use this exception table:

| Category | Source A and value | Source B and value | Difference | Evidence location | Required check |
|---|---|---|---|---|---|

Cite each result with the file name and the best available page, note, table, sheet, row, or cell location. For a comparison, cite both source locations. If one value is absent, cite where it should appear and state the files, pages, notes, tables, sheets, rows, or cells reviewed. Separate source facts, calculations, interpretations, and missing evidence. Do not describe the review as an audit or assurance engagement. Do not give tax, investment, compliance, or fraud conclusions.
