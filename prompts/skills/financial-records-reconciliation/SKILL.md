---
name: financial-records-reconciliation
description: Reconcile financial records, balances, transactions. Load after document-review. Exclude: statement presentation, invoice-policy review, budget variance analysis.
---

Use only supplied records and matching criteria. State entity, account, period, currency, unit, source type, and available record identifier.

Extract exact identifiers, dates, counterparties, currencies, units, quantities, rates, tax, amounts, balances, and line items. Retain signs and precision. Match explicit identifiers first; name secondary fields used.

Recalculate source arithmetic and balances. Report matched and missing records, unmatched entries, amount, currency, period, and tax differences, and entity or account conflicts. Do not treat a header as a record or combine currencies or exchange rates without an explicit source.

Label a suspected duplicate `Possible duplicate`; identical fields or identifiers do not prove one transaction. Include record identifier in every exception row. Output one table: category; record identifier; each source and value; difference; required check. Do not claim an audit or give tax, fraud, compliance, or posting conclusions. Require qualified finance or accounting review.
