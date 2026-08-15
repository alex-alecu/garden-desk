---
name: prior-authorization-document-review
description: Check a prior-authorization document packet for completeness against a supplied payer policy or checklist. Use after document-review for administrative packet preparation. Do not decide medical necessity, coverage, approval, denial, diagnosis, treatment, triage, or coding correctness.
---

# Prior Authorization Document Review

Use only the supplied packet, payer policy, checklist, and user criteria. If no policy or checklist is supplied, inventory the packet and ask for the controlling requirements. Do not use model memory as a payer rule.

Map each supplied requirement to exact packet evidence. Use only these states: `documented`, `not documented`, `conflicting`, `not applicable`, and `human review required`. Do not use `met`, `failed`, `approve`, or `deny`.

Record the request identifier, patient identifier needed to distinguish the packet, provider, payer, requested item or service as written, dates, attached document types, supplied criterion, evidence location, and state. Do not interpret medical necessity, symptoms, diagnoses, treatment, code validity, or clinical importance.

Use this table:

| Supplied requirement | State | Source fact | Evidence location | Missing or conflicting item | Human check |
|---|---|---|---|---|---|

Missing evidence must route to human review. It is not proof that a criterion failed or that care should be delayed. Do not claim HIPAA compliance. Require qualified medical-administration and clinical review before submission or use in a care decision.
