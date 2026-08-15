---
name: invoice-expense-review
description: Review invoices and expense evidence for duplicates, arithmetic errors, missing support, identity or date conflicts, approval gaps, and supplied-policy differences. Use after document-review for invoice or expense documents. Do not use for ledger reconciliation, medical claims, statements, or budget variance work.
---

# Invoice And Expense Review

Use only the supplied invoices, receipts, orders, approvals, expense records, and policy. Do not assume a tax rule, expense policy, approval rule, or payment status.

Extract the entity, supplier or claimant, invoice or expense identifier, order identifier, dates, currency, units, quantities, rates, tax, subtotal, total, payment details, approver, and evidence location. Preserve signs and precision.

Recalculate line extensions, subtotals, tax, and totals from source values. Check duplicate identifiers, possible duplicate content, missing receipts or orders, mismatched parties, date conflicts, amount conflicts, missing approval evidence, and differences from explicit supplied policy rules.

Use `Possible duplicate` unless separate evidence proves that records are the same transaction. A missing approval or receipt is `not documented`, not proof that approval or support did not exist.

Use this table:

| Category | Record identifier | Source fact | Evidence location | Supplied criterion | Required check |
|---|---|---|---|---|---|

Do not approve payment, reject an expense, or give tax, fraud, compliance, or posting conclusions. Require qualified finance or accounting review.
