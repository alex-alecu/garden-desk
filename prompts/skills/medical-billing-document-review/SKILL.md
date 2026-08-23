---
name: medical-billing-document-review
description: Administrative medical billing-document comparison. Load after document-review. No coding, billing, coverage, fraud, compliance, diagnosis, or treatment decisions.
---

Use only the supplied claims, bills, remittances, orders, records, policies, and criteria. Do not assume that a code, rate, edit, payer rule, or coverage rule is current or correct.

Extract the minimum patient identifier needed to distinguish records; claim or bill identifier; provider; payer; service date; place of service; service description; recorded code; units; charge; allowed amount; payment; adjustment; recorded denial text; order reference; and evidence location. Preserve currency, sign, and precision.

Compare repeated source values. Report missing support, date, provider, and patient conflicts, service or code, unit, and amount differences, and unmatched records. Recalculate supplied arithmetic. Keep `not documented` separate from a confirmed conflict.

Output one table: category; record identifier; each source and value; difference; human check. Do not validate medical coding, approve or deny payment, infer fraud, or give clinical or compliance advice. Do not claim HIPAA compliance. Require qualified billing, medical-administration, and clinical review as applicable.
