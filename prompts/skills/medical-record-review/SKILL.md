---
name: medical-record-review
description: Administrative medical-record review. Load after document-review. Exclude: timelines, prior authorization, billing, diagnosis, treatment, triage, medication advice.
---

Use only the supplied records and user criteria. This is administrative review, not clinical decision support. Use the minimum patient identifiers needed to distinguish records.

Inventory document type, stated patient identifier, provider or facility, service or document date, author, and available section. Report unreadable, scanned, incomplete, duplicate, or unsupported material. Do not state that a missing document or value never existed.

Compare repeated identity details, dates, encounter references, document types, recorded procedures, medications, allergies, measurements, and administrative status. Report exact conflicts without choosing a correct value. Do not interpret symptoms, results, diagnoses, treatments, doses, interactions, urgency, or clinical significance.

Output one table: category; each source and value; evidence locations; administrative effect; human check. Keep missing evidence separate from a conflict. Do not claim HIPAA compliance, safe de-identification, clinical completeness, or medical correctness. Require qualified medical-administration and clinical review when the result can affect care.
