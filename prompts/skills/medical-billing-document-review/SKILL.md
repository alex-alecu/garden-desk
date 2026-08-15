---
name: medical-billing-document-review
description: Compare supplied medical claims, bills, remittances, orders, and record details for administrative differences. Use after document-review for dates, providers, patients, services, codes, amounts, and support. Do not make coding, billing, coverage, fraud, compliance, diagnosis, or treatment decisions.
---

# Medical Billing Document Review

Use only the supplied claims, bills, remittances, orders, records, policies, and criteria. Do not assume that a code, rate, edit, payer rule, or coverage rule is current or correct.

Extract the minimum patient identifier needed to distinguish records, claim or bill identifier, provider, payer, service date, place of service, service description, code as recorded, units, charge, allowed amount, payment, adjustment, denial text as recorded, order reference, and evidence location. Preserve currency, sign, and precision.

Compare repeated values across sources. Report missing support, date conflicts, provider conflicts, patient conflicts, service or code differences, unit differences, amount differences, and unmatched records. Recalculate arithmetic from supplied values. Keep `not documented` separate from a confirmed conflict.

Use this table:

| Category | Record identifier | Source A and value | Source B and value | Difference | Human check |
|---|---|---|---|---|---|

Do not validate medical coding, approve or deny payment, infer fraud, or give clinical or compliance advice. Do not claim HIPAA compliance. Require qualified billing, medical-administration, and clinical review as applicable.
