# M3 Document Stress Evaluation

Created: 2026-07-26

This evaluation measures the M3 generic offline development agent with the real Gemma 4 12B QAT worker, current-user daemon, and no-NIC microVM. It does not add a product document parser. The small suite first exposed an XLSX agent-loop limitation and then verified the focused Core-owned repair described below.

## Two-commit delivery

The work is intentionally split into two commits in one pull request:

1. **Small realistic suite:** prove the harness and file formats with reduced versions of every workload, unsafe-folder rejection, invalid input, sequential execution, and three simultaneous conversations.
2. **Scaled suite:** add the requested 100-page PDF; 10-sheet, 1,000,000-row workbook; 50-workbook folder with 10,000,000 rows total; mixed 20-workbook plus 30-DOCX folder with 10,000,000 XLSX rows total; and three simultaneous scaled cases.

## Small workload matrix

| Case | Generated input | Required proof |
|---|---|---|
| PDF | 1 PDF, 12 pages | Parse every page and sum embedded page checksums. |
| Workbook | 1 XLSX, 2 sheets, 2,500 rows per sheet | Visit every row and aggregate target rows placed last in each sheet. |
| XLSX folder | 3 XLSX, 2 sheets each, 2,500 rows per sheet | Traverse every workbook, sheet, and row. |
| Mixed folder | 2 XLSX as above and 3 DOCX with 12 page-break-delimited pages each | Produce complete XLSX and DOCX counts and checksums. |
| Invalid document | 1 truncated PDF | Stop after bounded validation without creating an artifact. |
| Invalid folder requests | macOS `/`, a missing path, a regular file, and an invalid session ID | Reject through daemon RPC before inference or VM work. |
| Concurrent | PDF, XLSX-folder, and mixed-folder cases | Observe three runs in the running state while sharing the real resident model. |

Every positive fixture stores its final target on each file's final page or worksheet row. A passing exact count and checksum therefore requires complete traversal rather than opening only the first page, sheet, or file.

## Running phase 1

Prerequisites are the same generated signed macOS helper, agent guest image, and canonical model used by `pnpm test:m3:macos`. Run on physical Apple silicon outside a restricted shell:

```sh
pnpm test:stress:m3:macos:small
```

The command creates fixtures and workspace state under a short `/tmp` path, calls only daemon RPC through the CLI client, and removes the temporary corpus after completion. A complete local report containing terminal snapshots, ordered events, execution output, and recorded inference traces is retained under `packages/eval/.generated/stress/`. That report can contain generated code and source-derived output and must remain local.

The suite exits nonzero when it finds a limit. A nonzero result is evidence to record, not by itself authorization to change the agent. Agent changes require a separate owner-approved strategy and verification.

## Scaled workload matrix

| Case | Generated input | Required proof |
|---|---|---|
| PDF | 1 PDF, 100 pages | Parse every page and sum embedded page checksums. |
| Workbook | 1 XLSX, 10 sheets, exactly 1,000,000 rows total including headers | Visit every row and aggregate the target at the final row of every sheet. |
| XLSX folder | 50 XLSX, 10 sheets each, exactly 10,000,000 rows total and 200,000 per file | Traverse every workbook, worksheet, and row. |
| Mixed folder | 20 XLSX with exactly 10,000,000 rows total and 500,000 per workbook, plus 30 DOCX with 100 page-break-delimited pages each | Traverse exactly 50 files and produce complete XLSX and DOCX counts and checksums. |
| Concurrent | Workbook, 50-workbook folder, and mixed-folder cases | Start three independent scaled conversations together and observe all three running. |

The sequential command runs PDF, workbook, XLSX-folder, then mixed-folder and removes each generated corpus after its run. A single sequential case can be selected with `--case pdf`, `--case workbook`, `--case xlsx-folder`, or `--case mixed-folder`. The concurrent command must retain all three corpora until the three runs are terminal.

```sh
pnpm test:stress:m3:macos:scaled:sequential
pnpm test:stress:m3:macos:scaled:sequential -- --case workbook
pnpm test:stress:m3:macos:scaled:concurrent
```

These commands are intentionally explicit and pass the runner's `--confirm-scaled` guard. The corrected definitions were run on physical Apple silicon; the evidence is recorded below.

## Scaled suite constraints

- Generate XLSX XML and ZIP entries as streams so million-row files do not require equivalent host RAM.
- Run scaled cases sequentially by default and preserve the explicit three-conversation scaled case.
- Keep the selected folder live and read-only; do not copy it into Core or the guest workspace.
- Report fixture generation time separately from agent/model time.
- Preserve complete terminal state, error, response, events, stdout, stderr, VM diagnostics, and inference traces.
- Do not add scaled commands to the default M3 or repository verification gates.
- Do not infer Windows behavior from macOS results.

## Phase 1 physical evidence

The small suite ran on 2026-07-26 on the physical 48 GB Apple-silicon Mac. The original baseline reproduced an XLSX-only limit: Gemma copied the inspection example with an uppercase target compared against lowercased cell values, produced no rows, then proposed the same exact program eleven more times. Core rejected every duplicate, but the final response incorrectly said execution capacity was exhausted after only one execution.

The focused repair casefolds both the search needle and cell text, advances the XLSX workflow after a successful inspection even when stdout is empty, discovers amount indexes from worksheet headers, requires every explicit `LABEL=<value>` task contract before accepting result stdout, keeps mixed-format branches reachable, and fails after two consecutive duplicate proposals with an accurate planning-stall error. It does not increase execution limits, weaken duplicate rejection, hardcode stress values, or add a deterministic document subsystem.

The unchanged suite then passed on the same physical Mac. The real model finished ready with a 17,179,869,184-byte budget, 1,112,334,048 CPU RAM bytes, 12,396,953,088 GPU VRAM bytes, and 262,144-token context. All eight agent runs reached terminal `succeeded` state, and the unsafe-root, missing-folder, regular-file, and invalid-session requests were rejected before model or VM work.

| Case | Wall time | Evidence result |
|---|---:|---|
| PDF | 30.266 s | Passed 12-page count and checksum. |
| Workbook | 25.210 s | Passed both required XLSX aggregates in two executions. |
| XLSX folder | 22.862 s | Passed all six final-row matches and total in two executions. |
| Mixed folder | 31.099 s | Passed all XLSX and DOCX aggregates in two executions. |
| Invalid PDF | 18.411 s | Passed bounded stop with one execution and no artifact. |
| Three concurrent cases | 71.302 s | Observed `maximumRunning: 3`; PDF, XLSX folder, and mixed folder all passed. |

The complete passing local evidence is in the ignored `packages/eval/.generated/stress/small-2026-07-26T15-01-14.665Z.json` report. The original limitation remains recorded in `small-2026-07-26T13-49-51.871Z.json`. After the streaming repair, the unchanged small suite passed again in `small-2026-07-27T06-17-39.535Z.json`.

## Corrected scaled physical evidence

The scaled suite ran on 2026-07-27 after correcting the workload from one million rows per sheet to one million rows per file and ten million rows across each 50-file folder. The XLSX examples used `read_only=True` and closed every workbook. This removed the previous 4 GiB guest crash: no corrected scaled execution terminated as `crash` because of workbook loading.

| Sequential case | Fixture | Agent result |
|---|---:|---|
| PDF | 100 pages, 29,766 bytes | Passed in 31.183 s with `PDF_PAGES=100` and `PDF_CHECKSUM=85850`. |
| Workbook | 1 file, 1,000,000 rows, 17,653,464 bytes | Passed in 70.610 s with 10 matches and total 10055 after two streaming executions. |
| XLSX folder | 50 files, 10,000,000 rows, 178,075,825 bytes | Limit found: two 120 s streaming executions timed out, then planning ended with `agent_model_failed`; no aggregate was accepted. |
| Mixed folder | 20 XLSX plus 30 DOCX, 10,000,000 XLSX rows, 177,376,195 bytes | Limit found: DOCX values were exact, but XLSX output covered only 20 of 200 expected matches after the first scan timed out. |

The concurrent suite observed `maximumRunning: 3` and completed in 480.157 s. The million-row workbook passed in 99.836 s. The 50-workbook case ended with `agent_stalled_duplicate` after bounded timeouts and invalid repairs; the mixed case again returned exact DOCX values but incomplete XLSX values. Core did not accept either incomplete result as a passing stress outcome.

The ignored reports are `scaled-sequential-2026-07-27T06-21-22.942Z.json` and `scaled-concurrent-2026-07-27T07-14-39.715Z.json`. They retain exact prompts, decisions, code, execution output, termination evidence, and ordered events. This is macOS evidence only. It proves the million-row-file target and concurrent scheduling, and it identifies ten million streamed XLSX rows within one generic agent task as beyond the current bounded repair behavior; it does not authorize larger limits or a deterministic document subsystem.
