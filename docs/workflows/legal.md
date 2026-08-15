# Legal Workflow

Created: 2026-07-10

Legal is a strong follow-on vertical after the document engine, citation layer, and approval-gated editing model are reliable.

## Current Skill-Only Support

The owner activated a limited product-agent skill on 2026-08-15. The `legal-document-review` skill uses the existing Word and PDF workflows to review text-readable contracts and related files. It checks repeated party, identity, address, date, value, term, reference, and signature details before the general clause review. Each reported inconsistency must cite both source locations and must not invent a correction.

This skill is not the complete legal workflow. It does not add OCR, deterministic clause segmentation, tracked changes, redaction, matter-aware retrieval, legal research, or final legal advice. Qualified human review remains required.

Research-derived guardrail: [ABA Formal Opinion 512](https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/ethics-opinions/aba-formal-opinion-512.pdf) requires lawyers to understand the limits of generated output and to review it for accuracy. The product skill therefore does not give a final legal conclusion.

## Candidate Workflows

- Clause-by-clause contract comparison.
- Missing signature, date, and annex detection.
- Cited risk summaries.
- Matter-aware search.
- Redaction.
- Draft amendments for review.
- Formatting-preserving document export.

## Required Capabilities

- DOCX and PDF handling.
- Version comparison.
- Clause segmentation.
- Citation to page, paragraph, clause, or section.
- Redaction preview.
- Tracked-change preservation or equivalent review workflow.
- Matter-level access controls.
- Audit trail.

## Safety Requirements

- No final legal advice without human review.
- No unapproved edits to source documents.
- No cross-matter retrieval without permission.
- Redactions must be previewed and verified.
- Drafts must preserve source traceability.

## Evaluation Targets

- Clause matching quality.
- Missing field detection.
- Citation accuracy.
- Redaction correctness.
- Formatting preservation.
- Reviewer time saved.

## Revision History

| Date | Change |
|---|---|
| 2026-08-15 | Added the limited local legal document review skill and retained the full workflow as follow-up work. |
| 2026-07-10 | Initial legal workflow document created. |
