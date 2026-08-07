# Headless Stress Testing

## How the headless runner works

The macOS headless paths run the shipped backend without the desktop UI. `pnpm test:stress:m3:macos:small` starts Vault Core and its current-user daemon, verifies the pinned `gemma-4-12b-it-qat-q4_0` model, and uses the generated macOS Virtualization.framework helper and agent image to run work inside the real no-NIC guest. `pnpm test:m3:macos` exercises the broader canonical M3 contract.

The runner creates its state and realistic fixture roots under `/tmp`, grants a selected folder through `folders.add`, creates sessions, starts work through `agent.start`, and polls `agent.get` until every run is terminal. The selected folder is mounted live and read-only at `/source`; only the bounded guest `/workspace` is writable. Current profiles ask for realistic PDF, Word, Excel, and cross-format management reports from mixed business corpora. Expected facts stay outside production prompts. Every generated deliverable is materialized and reopened from its real bytes, either through a deterministic format check or an independent verification session with the corresponding local document library. Response text or a succeeded state alone never passes. The runner also tests generic continuation markers, policy rejections, routing negatives, Romanian skill triggers, concurrent sessions, immutable traces, audit, cleanup, and hidden-answer terminal evidence. Complete ignored evidence is written under `packages/eval/.generated/stress/`.

Task-specific evaluations use an ignored TypeScript runner under `packages/eval/.generated/` with the same Core, daemon, CLI RPC, real Gemma worker, and no-NIC guest. Expected answers must remain outside the model prompt, and success must come from current execution evidence rather than response text or historical runs alone.

## Latest results

### Generated-file freshness and planning recovery — 2026-08-07

- The exact reported task `Write a short story for children in a word and a pdf doc` passed through the real current-user daemon, pinned Gemma worker, and no-NIC guest. It persisted exactly `story.docx` and `story.pdf`; signatures were `504b0304` and `25504446`; an independent guest reopened both as non-empty documents; final declarations matched both artifact rows; materialized and exported bytes matched; and the 25-event audit chain verified. Report: `generated-deliverables-2026-08-07T08:00:07.619Z.json`.
- The richer hidden-fact two-file fixture also passed in two executions and three traced turns. Both artifacts contained all four hidden facts, both signatures and export bytes verified, and the 15-event audit chain passed. Report: `generated-deliverables-2026-08-07T07:44:08.088Z.json`.
- The focused XLSX row-filter oracle passed in two executions and 96.209 seconds. Independent reopening verified `avans_rows.xlsx` with all hidden matching rows and no ordinary-transfer rows. Report: `small-2026-08-07T08-00-29.416Z.json`.
- The first focused PDF report run created `management-report.pdf`, but independent byte verification correctly failed because the file contained `INVOICES=0` and `TOTAL=0.0` instead of the hidden invoice facts; `NOTES=24` and `PAGES=12` were correct. Report: `small-2026-08-07T08-02-17.869Z.json`. This exposed case-sensitive workbook-header matching; the workbook skill now requires case-insensitive normalized headers and fail-closed missing-column handling.
- The identical PDF report rerun extracted the exact hidden facts `MATCHING_INVOICES=8`, `INVOICE_TOTAL=20012.0`, `MEETING_NOTES=24`, and `POLICY_PAGES=12`, created and reopened the PDF, but Gemma failed to issue a final structured declaration after five executions. Core failed closed with `structured_tool_call_required` and persisted no artifact. Report: `small-2026-08-07T08-06-51.776Z.json`. This remains a real-model quality limit; no execution, time, context, security, or planning limit changed.
- The canonical physical `pnpm test:m3:macos` gate returned `certified` with real Python and Node artifacts, persistence, cancellation, resource limits, no-NIC confinement, two overlapping VM lifetimes, and the 131,072-token context tier. `pnpm verify` passed 94 unit files with 415 tests passed and one declared skip, two native tests, TypeScript, lint, source limits, Rust and native helper checks, sidecar/resource validation, and the desktop production build.
- Core now keeps captured deliverables until an authoritative workspace delta changes or removes their paths, rejects bare interactive Python or Node shell commands before VM execution, keeps shell misuse recovery source-only until one source execution succeeds, and labels planning retries as revised plans. stdout, stderr, exit status, and unrelated programs do not change artifact freshness. This is macOS evidence only.

Focused XLSX row-filter regression validation on 2026-08-06 used the pinned Gemma worker, current-user daemon, and real no-NIC guest on physical Apple silicon. The fixture contained exactly 10 uppercase-extension XLSX workbooks under 10 subfolders, each with exactly 100 rows including the header. One hidden row per workbook contained `avans`; expected row markers remained outside the model prompt. The user task was the original terse request: `Generate an excel with all rows in excel files containing “avans”`.

- Before the fix, the agent reproduced the original sequence: unnecessary import failure, incorrect workbook-level dimension recovery, nested row serialization failures, repeated repairs, and all six executions consumed. The deterministic artifact check confirmed that the final workbook eventually contained all 10 records and no nonmatching rows, but the case correctly failed with `Expected at most 5 executions.` Report: `small-2026-08-06T08-50-49.525Z.json`.
- After adding explicit worksheet-dimension, flat-scalar row serialization, and malformed-Python recovery guidance to the XLSX skill, the identical case passed in two executions and 93.181 seconds. `avans_rows.xlsx` contained all 10 hidden records, no nonmatching `ordinary transfer` row, and the terminal execution reported clean `10/10` complete progress. Report: `small-2026-08-06T08-48-41.857Z.json`.
- No runtime execution, time, memory, context, or isolation limit changed. The focused stress oracle requires completion within five of the six available executions so capacity-exhaustion regressions fail. Focused prompt, loop, stress-profile, reporting, and TypeScript checks passed before the final physical run. This is macOS evidence only.

Focused generic-agent regression validation on 2026-08-06 ran on physical Apple silicon with the pinned Gemma worker and real no-NIC guest. The canonical `pnpm test:m3:macos` gate returned `certified`: real Python and Node tasks each completed with two executions and one artifact, while guest rehydration, repair, persistence, cancellation, timeout, output, security, workspace lifecycle, and two overlapping VMs passed at the 131,072-token hardware tier.

| Focused case | Final result | Exact evidence | Retained ignored reports and intermediate limits |
|---|---|---|---|
| Invalid document | **PASS** | One Python execution; real `EOF marker not found` evidence; exit 0; no artifact or retry. | The first run correctly identified the invalid PDF but used a separate discovery execution and failed `Expected at most 1 executions.` (`small-2026-08-05T21-53-47.305Z.json`). The corrected identical case passed in `small-2026-08-05T21-56-05.895Z.json`. |
| Romanian workbook routing | **PASS** | Unicode routing activated the workbook skill; complete clean progress; exact hidden `TOTAL_AVANS=12009`; three executions. | The first two runs found the exact total but ended `structured_tool_call_required` after concatenated markers or non-error stderr (`small-2026-08-05T21-56-56.638Z.json`, `small-2026-08-05T22-01-50.563Z.json`). A clean-evidence run then exposed ambiguous fixture column wording and returned `TOTAL_AVANS=0.0` (`small-2026-08-05T22-03-49.820Z.json`). After requiring separated markers, empty successful stderr, and explicit input column names, the identical case passed in `small-2026-08-05T22-05-56.358Z.json`. |

These runs validate only the canonical macOS gate and the two named focused stress cases. The complete small suite, scaled suite, and Windows certification were not run against this refactor.

The generic-agent refactor validation on 2026-08-05 used the new artifact-first `pdf-report` case on physical Apple silicon with the pinned Gemma worker and real no-NIC guest. The evaluator generated 11 realistic mixed-format files, kept expected facts outside the prompts, materialized the declared PDF, and opened it in a separate verification session. The production run derived the correct current facts (`MATCHING_INVOICES=8`, `INVOICE_TOTAL=20012.00`, `MEETING_NOTES=24`, `POLICY_PAGES=12`) and declared `management-report.pdf`, but independent extraction found unrelated fabricated metrics such as `REVENUE=450M`, `NET_INCOME=140M`, and `EMPLOYEE_COUNT=1200` in the artifact. The case therefore **failed** as `small_stress_limit_found`; response text and a declared artifact did not override artifact-byte evidence. The retained ignored report is `packages/eval/.generated/stress/small-2026-08-05T20-39-06.161Z.json`.

This physical run also exposed and drove generic fixes before the retained result: format-neutral progress could no longer auto-finish a multi-format deliverable task, caught workbook errors could not prove complete progress, and the then-current heuristic treated a deliverable as stale after later calculations unless recreated or explicitly verified. The 2026-08-07 delta-authoritative freshness change above supersedes that heuristic. The final retained failure is model output quality, not a passing product claim. The complete small suite, scaled suite, and Windows certification remain required before certification; the canonical macOS gate was subsequently rerun as recorded above.

The latest validation cycle was performed on 2026-08-03 on physical Apple silicon against `m3-stress-reliability` after the three reliability changes. This is macOS evidence only; it does not establish current Windows behavior.

The realistic fixture contained 10 files: TypeScript, JSON, CSV, Markdown, two XLSX workbooks with 10,000 rows, two DOCX files with 16 pages, and an eight-page PDF. Five sessions were started together.

| Suite or check | Result | Evidence | Failure or limit |
|---|---|---|---|
| Small stress suite | **PASS** | All 8 sequential and concurrent results passed twice consecutively. | None. |
| Sequential PDF | **PASS** | `PDF_PAGES=12`; `PDF_CHECKSUM=1326`. | None. |
| Sequential workbook | **PASS** | `XLSX_MATCHES=2`; `XLSX_TOTAL=2003`. | None. |
| Sequential XLSX folder | **PASS** | `XLSX_MATCHES=6`; `XLSX_TOTAL=12009`; one execution in both final runs. | None. |
| Sequential mixed folder | **PASS** | Exact XLSX and DOCX counts and checksums. | None. |
| Invalid PDF | **PASS** | Printed `INVALID_DOCUMENT_STOP=1` in one successful execution with no repair or artifact. | None. |
| Three concurrent cases | **PASS** | PDF, XLSX-folder, and mixed-folder cases passed with `maximumRunning: 3`. | None. |
| Realistic skill suite | **PASS** | All 5 cases passed twice consecutively across five simultaneously started sessions; audit valid. | None. |
| Direct response; no skill | **PASS** | Returned a correct concise response with zero executions. | None. |
| Terminal-only source discovery | **PASS** | Located `/source/src/pricing-rules.ts` and returned `SURCHARGE_BPS=275` without guessed paths or duplicate stall. | None. |
| Hidden-answer XLSX analysis | **PASS** | `XLSX_MATCHES=4`; `XLSX_TOTAL=6006.0`. | None. |
| Attached-PDF analysis | **PASS** | `PDF_PAGES=8`; `PDF_CHECKSUM=612`. | None. |
| Combined terminal and XLSX | **PASS** | Returned exact source evidence, `XLSX_MATCHES=4`, `XLSX_TOTAL=6006`, and `q2-audit.md` in both final runs. | None. |
| Dynamic skill disclosure | **PASS** | Direct: none; terminal: `terminal-commands`; workbook: `xlsx-workbooks`; PDF: `pdf-reading`; combined: terminal plus XLSX. Unselected skill bodies remained unloaded. | None. |
| Model and audit | **PASS** | Audit chain verified; model moved from `unloaded` to `ready`. | None. |
| Scaled sequential | **PASS** | 100-page PDF, one-million-row workbook, 50 workbooks, and 50-file mixed workflow returned exact results. | Large workbook workflows required resumable recovery and exceeded the intended 75-second work window in individual executions. |
| Scaled concurrent | **PASS** | Workbook, 50-workbook, and mixed workflows passed with `maximumRunning: 3`. | Large workflows used four to six executions and long-running batches. |
| Canonical `pnpm test:m3:macos` gate | **CERTIFIED** | Real Python and Node artifacts, persistence, cancellation, limits, live read-only source, confinement, cleanup, two overlapping VM lifetimes, and the 131,072-token cap passed. | macOS evidence only. |
| `pnpm verify` | **PASS** | Source limits, lint, type checking, 335 unit tests with one skip, two native tests, native helpers, desktop builds, and Rust checks passed. | None. |

The backend, daemon, model, guest isolation, audit, and canonical gate remained healthy. All four original reliability failures now pass. The final scaled suites also passed, while their long resumable executions remain reported separately rather than treated as proof of tighter work-window behavior.

## Reliability fix validation

### Collapsed workbook and result-table cycle — 2026-08-05

- A task-specific physical Apple-silicon reproduction used the real pinned Gemma worker, current-user daemon, and no-NIC guest against the original 36-workbook corpus. This is macOS evidence only; source paths and row contents remain in ignored local evidence.
- The generation task processed all 36 workbooks, found 17 matches, created exactly one 5,370-byte XLSX with worksheet dimension `A1:B18`, returned `Total matches found: 17`, and preserved a valid audit chain.
- The immediate table follow-up succeeded in one clean Python execution with zero stderr, returned exactly 17 GFM data rows, and reused the already verified complete corpus coverage. Core normalized overflow Markdown delimiters into the final cell instead of accepting malformed columns or requiring an unverified prose response.
- Non-qualifying iterations retained exact failures for collapsed `A1:A1` source metadata, `reset_dimensions()` on a normal worksheet, invalid table escape syntax, malformed GFM columns, omitted structured calls, duplicate repair, and an independently observed resource-contention timeout. No context, execution, or isolation limit was raised.
- Focused XLSX, prompt, output-contract, and combined source-recovery coverage passed: 44 tests across six files. `pnpm verify` passed with source limits, lint, TypeScript, 373 unit tests with one skip, two native tests, Rust checks, native helpers, sidecar validation, and the desktop build.

### Generated workbook delivery cycle — 2026-08-05

- A task-specific physical Apple-silicon reproduction used the real pinned Gemma worker, current-user daemon, and no-NIC guest against a 36-workbook source corpus. This is macOS evidence only.
- Before the fix, the guest processed all 36 workbooks and created the requested XLSX, but final response validation replaced the valid artifact-only completion with an empty response and ended the run with `agent_run_failed`.
- After the fix, the identical task succeeded in 82.323 seconds with an accepted final response, exactly one 5,369-byte XLSX deliverable, no checkpoint artifact, and a valid audit chain.
- Focused output-contract, artifact-declaration, and store coverage passed: 16 tests across four files. The checks cover preservation of generated-workbook final responses and exclusion of internal checkpoint files from current and historical user-visible artifact listings.
- `pnpm verify` passed with 366 unit tests, one skip, two native tests, TypeScript checks, Rust checks, native helpers, sidecar packaging, source limits, and the desktop build.

### Source discovery recovery cycle — 2026-08-03

- Focused loop and prompt tests passed: 16 tests across `loop-shell-recovery.test.ts` and `prompt-library.test.ts`.
- `pnpm verify` passed with 331 unit tests, one skip, two native tests, desktop builds, native helpers, and Rust checks.
- The realistic skill runner was repeated twice. Terminal-only passed both times. Combined source discovery also passed both times with `SOURCE_FILE=/source/src/pricing-rules.ts` and `SURCHARGE_BPS=275`, then reached workbook analysis without a guessed path or duplicate stall. The still-expected combined XLSX corpus/total limit remained for the aggregate-guidance commit. Reports: `packages/eval/.generated/stress/realistic-skills-2026-08-03T14-46-03.506Z.json` and `packages/eval/.generated/stress/realistic-skills-2026-08-03T14-50-38.346Z.json`.
- The small suite preserved all previous passes, including all three concurrent cases with `maximumRunning=3`. Invalid PDF and sequential XLSX-folder totals remained the planned later failures. Report: `packages/eval/.generated/stress/small-2026-08-03T14-55-01.388Z.json`.
- Scaled sequential and concurrent runs preserved the separately reported XLSX-folder aggregate limit; the one-million-row workbook and mixed 50-file workflow passed in both modes. Reports: `packages/eval/.generated/stress/scaled-sequential-2026-08-03T15-01-11.980Z.json` and `packages/eval/.generated/stress/scaled-concurrent-2026-08-03T15-16-33.806Z.json`.
- `pnpm test:m3:macos` remained certified with real Python and Node artifacts, persistence, cancellation, limits, no-NIC confinement, cleanup, two overlapping VM lifetimes, and the 131,072-token context cap. This command emits terminal evidence rather than a JSON report.

### Invalid PDF clean-stop cycle — 2026-08-03

- Focused PDF routing and attachment prompt tests passed: 14 tests across `prompt-library.test.ts` and `loop-attachments.test.ts`.
- `pnpm verify` passed with 332 unit tests, one skip, two native tests, desktop builds, native helpers, and Rust checks.
- The realistic skill suite preserved the source-discovery fixes, PDF and XLSX-only passes, skill routing, and audit validity. Combined XLSX totals remained the planned aggregate-guidance failure. Report: `packages/eval/.generated/stress/realistic-skills-2026-08-03T15-31-01.178Z.json`.
- The small suite was repeated twice. Invalid PDF passed both times with exactly one execution, `INVALID_DOCUMENT_STOP=1`, exit code 0, no repair, and no artifacts. `pypdf` emitted the bounded `EOF marker not found` parser diagnostic before the caught exception. The sequential XLSX-folder total remained the only small-suite failure; all previous and concurrent cases passed with `maximumRunning=3`. Reports: `packages/eval/.generated/stress/small-2026-08-03T15-36-30.587Z.json` and `packages/eval/.generated/stress/small-2026-08-03T15-42-36.222Z.json`.
- Scaled sequential preserved the XLSX-folder aggregate limit while the one-million-row workbook and mixed workflow passed. Report: `packages/eval/.generated/stress/scaled-sequential-2026-08-03T15-48-39.833Z.json`.
- The first scaled-concurrent run had a stochastic one-workbook total miss while the 50-file XLSX and mixed cases passed; the identical repeat restored the previous profile with workbook and mixed passes and only the known XLSX-folder aggregate limit. Reports: `packages/eval/.generated/stress/scaled-concurrent-2026-08-03T16-03-27.691Z.json` and `packages/eval/.generated/stress/scaled-concurrent-2026-08-03T16-13-52.846Z.json`.
- `pnpm test:m3:macos` remained certified with real Python and Node artifacts, persistence, cancellation, limits, no-NIC confinement, cleanup, two overlapping VM lifetimes, and the 131,072-token context cap. This command emits terminal evidence rather than a JSON report.

### Workbook aggregate and combined-workflow cycle — 2026-08-03

- Focused XLSX, source-recovery, rejection, and prompt tests passed: 28 tests across `loop-xlsx.test.ts`, `loop-shell-recovery.test.ts`, `loop-source-recovery.test.ts`, and `prompt-library.test.ts`.
- `pnpm verify` passed with 335 unit tests, one skip, two native tests, desktop builds, native helpers, and Rust checks.
- The final realistic skill suite passed twice consecutively. Terminal-only and combined source discovery returned `/source/src/pricing-rules.ts` and `SURCHARGE_BPS=275`; XLSX-only and combined processing used the complete case-insensitive corpus; combined returned `XLSX_MATCHES=4`, `XLSX_TOTAL=6006`, and `q2-audit.md`. Both reports retained `maximumRunning=5`, correct skill routing, and a valid audit chain. Reports: `packages/eval/.generated/stress/realistic-skills-2026-08-03T17-29-39.052Z.json` and `packages/eval/.generated/stress/realistic-skills-2026-08-03T18-15-31.820Z.json`.
- The final small suite passed twice consecutively. Sequential and concurrent XLSX-folder cases both returned `XLSX_MATCHES=6` and `XLSX_TOTAL=12009` in one execution; the one-workbook and mixed totals remained correct; invalid PDF still stopped cleanly in one execution; concurrent runs retained `maximumRunning=3`. Reports: `packages/eval/.generated/stress/small-2026-08-03T17-34-49.093Z.json` and `packages/eval/.generated/stress/small-2026-08-03T18-20-51.953Z.json`.
- Scaled sequential passed the 100-page PDF, one-million-row workbook, 50-workbook, and mixed 50-file workflows. The workbook folder returned `XLSX_MATCHES=500` and `XLSX_TOTAL=12752750`; mixed returned `XLSX_MATCHES=200`, `XLSX_TOTAL=2101100`, `WORD_PAGES=3000`, and `WORD_CHECKSUM=46651500`. Report: `packages/eval/.generated/stress/scaled-sequential-2026-08-03T17-39-20.658Z.json`.
- Scaled concurrent passed the one-million-row workbook, 50-workbook, and mixed workflows with `maximumRunning=3` and the same exact totals. The 50-workbook run used four executions and the mixed run used all six; long batches still exceeded the intended 75-second work window. Report: `packages/eval/.generated/stress/scaled-concurrent-2026-08-03T18-00-08.345Z.json`.
- The non-qualifying iterations exposed and retained exact evidence for a case-sensitive uppercase-XLSX miss, overcomplicated small-corpus checkpoint repair, guessed source extension allowlists, and an overlong combined recovery. Reports: `packages/eval/.generated/stress/realistic-skills-2026-08-03T16-30-56.384Z.json`, `packages/eval/.generated/stress/small-2026-08-03T16-45-16.946Z.json`, `packages/eval/.generated/stress/realistic-skills-2026-08-03T17-01-57.566Z.json`, `packages/eval/.generated/stress/realistic-skills-2026-08-03T17-11-59.149Z.json`, and `packages/eval/.generated/stress/realistic-skills-2026-08-03T17-18-34.096Z.json`.
- `pnpm test:m3:macos` remained certified with real Python and Node artifacts, persistence, cancellation, limits, no-NIC confinement, cleanup, two overlapping VM lifetimes, and the 131,072-token context cap. This command emits terminal evidence rather than a JSON report.
