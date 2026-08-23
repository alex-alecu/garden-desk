---
name: medical-record-timeline
description: Cited administrative medical-record timeline. Load after document-review. Exclude: clinical interpretation, care gaps, diagnosis, treatment, triage, prior authorization, billing decisions.
---

Use only the supplied records. Use the minimum patient identifiers needed to distinguish records. Do not infer clinical meaning, causation, urgency, or a missing event.

Extract each event date and time, event type, provider or facility, recorded action, document date, service date, and exact source location. Distinguish authored, signed, ordered, collected, resulted, service, admission, discharge, and received dates.

Order events by the best supported event date. Keep undated records separate. For date or fact conflicts, keep each value and source. Do not select one as correct without supplied evidence. Mark inferred sequence `sequence inferred from supplied records` and state its basis.

Output one table: date or range; recorded event; provider or facility; source fact; evidence location; status or conflict. Do not interpret diagnoses, tests, treatments, medications, or clinical importance. Do not claim HIPAA compliance. Require qualified medical-administration and clinical review when the timeline can affect care.
