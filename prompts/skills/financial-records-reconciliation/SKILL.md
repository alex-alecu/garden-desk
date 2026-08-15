---
name: financial-records-reconciliation
description: Reconcile two or more sets of financial records, balances, or transactions. Use after document-review for ledgers, bank statements, subledgers, invoices, payment lists, or account records. Do not use for statement presentation, invoice-policy review, or budget variance analysis.
---

# Financial Records Reconciliation

Use only the supplied records and matching criteria. Identify each entity, account, period, currency, unit, source type, and available record identifier.

Extract exact identifiers, dates, counterparties, currencies, units, quantities, rates, tax, amounts, balances, and line items. Preserve signs and precision. Match explicit identifiers first. Use secondary fields only when you state them.

Recalculate arithmetic and balances from source values. Report matched records, missing records, unmatched entries, amount differences, currency differences, period differences, tax differences, and entity or account conflicts. Do not treat a header as a record. Do not combine currencies or apply an exchange rate without an explicit source.

Label a suspected duplicate as `Possible duplicate`. Identical fields or identifiers alone do not prove that two records are the same transaction. Include the record identifier in every exception row.

Use this table:

| Category | Record identifier | Source A and value | Source B and value | Difference | Required check |
|---|---|---|---|---|---|

Do not describe the work as an audit. Do not give tax, fraud, compliance, or posting conclusions. Require qualified finance or accounting review.
