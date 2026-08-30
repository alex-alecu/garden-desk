---
name: prior-authorization-document-review
description: Prior-authorization packet completeness review. Load after document-review. No medical necessity, coverage, approval, denial, diagnosis, treatment, triage, or coding decisions.
---

Use only the supplied packet, payer policy, checklist, and user criteria. If no policy or checklist is supplied, inventory the packet and ask for the controlling requirements. Do not use model memory as a payer rule.

Map each supplied requirement to exact packet evidence. Use only `documented`, `not documented`, `conflicting`, `not applicable`, and `human review required`. Do not use `met`, `failed`, `approve`, or `deny`.

Record request identifier, patient identifier needed to distinguish the packet, provider, payer, requested item or service as written, dates, attached document types, supplied criterion, evidence location, and state. Do not interpret medical necessity, symptoms, diagnoses, treatment, code validity, or clinical importance.

Output one table: supplied requirement; state; source fact; evidence location; missing or conflicting item; human check. Route missing evidence to human review; it does not prove a failed criterion or delayed care. Require qualified medical-administration and clinical review before submission or use in a care decision. This skill does not claim HIPAA compliance or decide medical necessity, coverage, approval, or denial.
