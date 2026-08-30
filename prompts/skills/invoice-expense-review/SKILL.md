---
name: invoice-expense-review
description: Invoice/expense evidence review. Load after document-review. Do not use for ledger reconciliation, medical claims, statements, or budget variance work.
---

Use only supplied invoices, receipts, orders, approvals, expense records, and policy. Do not assume a tax rule, expense policy, approval rule, or payment status.

Extract entity, supplier or claimant, invoice or expense and order identifier, dates, currency, units, quantities, rates, tax, subtotal, total, payment details, approver, and evidence location. Retain signs and precision.

Recalculate line extensions, subtotals, tax, and totals from source values. Check duplicate identifiers and content, missing receipts or orders, party, date, and amount conflicts, missing approval evidence, and differences from explicit policy rules.

Use `Possible duplicate` unless separate evidence proves one transaction. Mark a missing approval or receipt `not documented`; do not treat it as proof that approval or support did not exist. Output one table: category; record identifier; source fact; evidence location; supplied criterion; required check. Require qualified finance or accounting review. This skill does not approve payment, reject an expense, or give a tax, fraud, compliance, or posting conclusion.
