# Medical Administration Workflow

Created: 2026-07-10

Medical administration is a later full workflow target with stricter safety, privacy, and regulatory constraints.

Vault Desk should avoid autonomous diagnosis, treatment recommendations, and triage.

## Current Skill-Only Support

The owner activated limited prompt-only support on 2026-08-15. `medical-record-review`, `medical-record-timeline`, `prior-authorization-document-review`, and `medical-billing-document-review` load after the shared `document-review` skill. They use supplied evidence for administrative review only. They do not decide diagnosis, treatment, triage, medical necessity, coverage, coding correctness, payment, fraud, or compliance. They do not claim HIPAA compliance. Qualified medical-administration review and clinical review are required when a result can affect care.

This support does not add OCR, clinical knowledge, code-set lookup, payer access, EHR access, redaction, de-identification, or patient communication. The complete workflow remains deferred.

## Safer Candidate Workflows

- Structure consultation notes.
- Draft letters for clinician approval.
- Summarize incoming records.
- Extract data from forms.
- Organize patient document sets.
- Search patient documents with strict permissions.

## Required Capabilities

- Strong identity and workspace isolation.
- Strict audit logs.
- Permission-aware retrieval.
- Redaction and minimization.
- Human approval before output use.
- Clear indication of cited source material.

## Explicit Non-Goals

- Diagnosis.
- Treatment recommendation.
- Triage.
- Medication advice.
- Autonomous patient communication.
- Any clinical decision without clinician review.

## Evaluation Targets

- Source citation quality.
- Missing-information detection.
- Redaction quality.
- Permission enforcement.
- Clinician review burden.
- Regulatory fit by jurisdiction.
