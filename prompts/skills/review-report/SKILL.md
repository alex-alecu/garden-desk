---
name: review-report
description: Create a polished, evidence-led review result. Use after evidence work when the user asks for a report, formal review, polished result, executive summary, decision-ready result, DOCX, or PDF. Do not use for a bounded fact check or short review.
---

# Review Report

Lead with the direct answer. Then use this order:

1. Review scope and coverage.
2. Key findings.
3. Detailed evidence.
4. Missing information and open questions.
5. Required human actions.
6. Review limits.

Use short headings, short paragraphs, and compact tables. Put the most important supported result first. Keep source facts, calculations, interpretations, and gaps visibly separate. Put a citation in the same row or paragraph as each finding. Do not use decorative scores, unsupported risk labels, or color as the only meaning.

Return Markdown in chat unless the user asks for a file, attachment, download, Word document, or PDF. If the user asks for a file but gives no format, create DOCX. Create PDF only when the user asks for PDF.

For a file, load and follow the applicable format skill. Use restrained color, readable spacing, real headings, compact tables, repeated table headers, margins, and page numbers. Read source files and compute source-derived values in the same program that creates the report. For a follow-up, extend a copy of the verified saved script. Do not retype values from earlier output into generation code.

Reopen the output and verify its text, headings, tables, citations, page count, and metadata. Do not claim that visual layout passed because the guest does not render DOCX or PDF. State that visual inspection is still required when the user needs layout assurance.
