---
name: medical-record-timeline
description: Build a cited administrative timeline from supplied medical records. Use after document-review for recorded encounters, documents, procedures, medications, and administrative events. Do not use for clinical interpretation, care gaps, diagnosis, treatment, triage, prior authorization, or billing decisions.
---

# Medical Record Timeline

Use only the supplied records. Use the minimum patient identifiers needed to distinguish records. Do not infer clinical meaning, causation, urgency, or a missing event.

Extract each event date and time, event type, provider or facility, recorded action, document date, service date, and exact source location. Preserve the difference between authored, signed, ordered, collected, resulted, service, admission, discharge, and received dates.

Order events by the best supported event date. Keep undated records separate. When dates or recorded facts conflict, keep each value and source. Do not select one as correct without supplied evidence. Mark any inferred sequence as `sequence inferred from supplied records` and state the basis.

Use this table:

| Date or range | Recorded event | Provider or facility | Source fact | Evidence location | Status or conflict |
|---|---|---|---|---|---|

Do not interpret diagnoses, tests, treatments, medications, or clinical importance. Do not claim HIPAA compliance. Require qualified medical-administration review and clinical review when the timeline can affect care.
