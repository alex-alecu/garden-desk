# Accounting Workflow

Created: 2026-07-10

Accounting is a possible post-V1 workflow pack. It is not part of the desktop V1 gate.

## Current Skill-Only Support

The owner activated a limited product-agent skill on 2026-08-15. The `finance-document-review` skill uses the existing Word, PDF, and XLSX workflows. It reviews text-readable financial statements and reconciles supplied invoices, bank statements, ledgers, and workbooks with source citations.

This skill is not the complete accounting workflow pack. It does not add OCR, autonomous postings, bank connections, tax advice, compliance filing, audit assurance, or unreviewed export.

Research-derived workflow guidance comes from the [IAS 1 complete statement set](https://www.ifrs.org/issued-standards/list-of-standards/ias-1-presentation-of-financial-statements.html/), the [SEC 10-K section guide](https://www.sec.gov/answers/reada10k.htm), and [PCAOB AS 1105 evidence controls](https://pcaobus.org/oversight/standards/auditing-standards/details/AS1105). [SEC Staff Accounting Bulletin 99](https://www.sec.gov/interps/account/sab99.htm) supports the rule that one fixed percentage cannot be the only materiality test. These sources guide review structure only. The product does not perform an audit.

## Why Accounting Is A Candidate

Accounting firms and bookkeeping teams have:

- High document volume.
- Repetitive workflows.
- Sensitive financial information.
- Structured expected outputs.
- Clear time-saving potential.
- Measurable ROI.
- Lower regulatory exposure than medical decision support.

## Candidate Follow-up Workflow

Records reconciliation:

1. User selects a folder of transaction records and a reference spreadsheet.
2. Vault Desk extracts counterparties, record identifiers, dates, totals, tax, and line items.
3. Vault Desk identifies duplicate records, missing fields, and inconsistent totals.
4. Vault Desk compares extracted values to spreadsheet rows.
5. Vault Desk creates an exception queue with citations.
6. User reviews and approves an export.
7. Vault Desk produces a structured output file.

## Required Capabilities

- PDF and image ingestion.
- OCR fallback.
- Table extraction.
- Spreadsheet reading.
- Duplicate detection.
- Cross-document comparison.
- Citation to page, table, and line item.
- Approval-gated export.
- Audit record.

## Evaluation Targets

- Field extraction accuracy.
- Duplicate detection precision.
- Citation precision.
- Export correctness.
- False-positive and false-negative exception rate.
- Time saved compared with manual review.
- Held-out accuracy across currencies, locales, date formats, layouts, scanned pages, revisions, contradictions, and missing fields.
- Blinded human review of exception severity and source traceability before pilot readiness.

Development fixtures and held-out acceptance documents must use different templates and values. Prompt, retrieval, and threshold tuning must not use the held-out results as development fixtures.

## Non-Goals For MVP

- Direct posting into accounting systems without approval.
- Autonomous bank reconciliation.
- Tax advice.
- Compliance filings.
- Unreviewed file modification.

## Revision History

| Date | Change |
|---|---|
| 2026-08-15 | Added the limited local finance document review skill and retained the full workflow pack as follow-up work. |
| 2026-07-10 | Initial accounting workflow document created. |
| 2026-07-11 | Added held-out variation and blinded human-review requirements for pilot readiness. |
| 2026-07-20 | Removed the pre-V1 review slice and retained generic reconciliation only as a post-V1 candidate. |
