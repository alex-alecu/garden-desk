# M3 Document Stress Evaluation

Created: 2026-07-26
Updated: 2026-08-14

This evaluation measures the M3 generic offline development agent with the real Gemma 4 12B QAT worker, current-user daemon, and no-network microVM. It does not add a product document parser.

The V1 release gate accepts the limits of the certified local model. It proves a few normal product paths. It does not require the model to solve large corpora, long context-turnover tasks, or several complex tasks at the same time. Model-quality limits from those optional tests are evidence. They are not V1 release failures.

## V1 small gate

| Case | Generated input | Required proof |
|---|---|---|
| Source inspection | 1 small TypeScript file | Find and report one exact value. |
| Legacy DOC read | 1 pinned binary DOC fixture | Load `word-documents`, run Antiword in the no-network guest, report two exact facts including UTF-8 punctuation, and create no file. |
| XLSX edit | 1 small workbook | Change two requested cells and preserve the workbook structure. |
| DOCX edit | 1 small document | Change and add requested text while preserving document structure. |
| Invalid document | 1 truncated PDF | Stop after bounded validation without creating an artifact. |
| Invalid folder requests | the platform filesystem root, a missing path, a regular file, and an invalid session ID | Reject through daemon RPC before inference or VM work. |

## Running the V1 gate

Prerequisites are the generated platform microVM helper, agent guest image, and canonical model used by `pnpm test:m3:macos` or `pnpm test:m3:windows`. On Windows the suite additionally uses the packaged inference worker, AppContainer launcher, and Node runtime so VRAM detection matches the desktop. Run on physical Apple silicon or Windows x64 outside a restricted shell:

```sh
pnpm test:stress:m3:small
```

The command creates fixtures and workspace state under a short `/tmp` path on macOS and under the user temporary directory on Windows, calls only daemon RPC through the CLI client, and removes the temporary corpus after completion. A complete local report containing terminal snapshots, ordered events, execution output, and recorded inference traces is retained under `packages/eval/.generated/stress/`. That report can contain generated code and source-derived output and must remain local.

The suite exits nonzero when it finds a limit. A nonzero result is evidence to record, not by itself authorization to change the agent. Agent changes require a separate owner-approved strategy and verification.

Each V1 case has a five-minute deadline and runs in sequence. The small gate does not run concurrent model tasks. The canonical platform gate already proves process concurrency, Python and Node execution, cancellation, isolation, resource limits, and teardown.

All other small-profile cases remain available through `--case` for focused diagnosis. The context-session and scaled commands are optional model-characterization tools. Do not run them for normal V1 acceptance, and do not make V1 depend on a larger or smarter model.

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
pnpm test:stress:m3:scaled:sequential
pnpm test:stress:m3:scaled:sequential -- --case workbook
pnpm test:stress:m3:scaled:concurrent
```

These optional commands are intentionally explicit and pass the runner's `--confirm-scaled` guard. Run them only after an explicit owner request. The corrected definitions were run on physical Apple silicon; the historical evidence is recorded below.

## Scaled suite constraints

- Generate XLSX XML and ZIP entries as streams so million-row files do not require equivalent host RAM.
- Run scaled cases sequentially by default and preserve the explicit three-conversation scaled case.
- Keep the selected folder live and read-only; do not copy it into Core or the guest workspace.
- Report fixture generation time separately from agent/model time.
- Preserve complete terminal state, error, response, events, stdout, stderr, VM diagnostics, and inference traces.
- Do not add scaled commands to the default M3 or repository verification gates.
- Do not infer Windows behavior from macOS results.

## Historical phase 1 physical evidence

The small suite ran on 2026-07-26 on the physical 48 GB Apple-silicon Mac. The original baseline reproduced an XLSX-only limit: Gemma copied the inspection example with an uppercase target compared against lowercased cell values, produced no rows, then proposed the same exact program eleven more times. Core rejected every duplicate, but the final response incorrectly said execution capacity was exhausted after only one execution.

The focused repair casefolds both the search needle and cell text, advances the XLSX workflow after a successful inspection even when stdout is empty, discovers amount indexes from worksheet headers, requires every explicit `LABEL=<value>` task contract before accepting result stdout, keeps mixed-format branches reachable, and fails after two consecutive duplicate proposals with an accurate planning-stall error. It does not increase execution limits, weaken duplicate rejection, hardcode stress values, or add a deterministic document subsystem.

The unchanged suite then passed on the same physical Mac under the context policy that preceded the 2026-08-01 cap amendment. The real model finished ready with a 17,179,869,184-byte budget, 1,112,334,048 CPU RAM bytes, 12,396,953,088 GPU VRAM bytes, and 262,144-token context. All eight agent runs reached terminal `succeeded` state, and the unsafe-root, missing-folder, regular-file, and invalid-session requests were rejected before model or VM work.

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

The ignored reports are `scaled-sequential-2026-07-27T06-21-22.942Z.json` and `scaled-concurrent-2026-07-27T07-14-39.715Z.json`. They retain exact prompts, decisions, code, execution output, termination evidence, and ordered events. This is macOS evidence only. At that point, they proved the million-row-file target and concurrent scheduling while identifying ten million streamed XLSX rows as beyond the bounded repair behavior; they did not authorize larger limits or a deterministic document subsystem.

## Latest continuation evidence

The minimal continuation repair kept the existing six-execution, 120-second, 4 GiB, and 128 MiB workspace limits. Stress commands now print event changes plus a 15-second heartbeat, and the runner simulates the user's explicit Continue action while retaining every prior snapshot and trace.

| Case | Latest physical result |
|---|---|
| Small suite | Passed all 8 sequential and concurrent runs; `maximumRunning: 3`. |
| 100-page PDF | Passed exact page count and checksum. |
| 1,000,000-row workbook | Passed exact aggregates. |
| 50 XLSX / 10,000,000 rows | Passed 500 matches and total 12,752,750 in three checkpointed executions. |
| Mixed XLSX and DOCX / 10,000,000 XLSX rows | Saved progress at 6 of 20 XLSX files and started a continuation correctly; the resumed model then used an incompatible checkpoint key and stalled. DOCX evidence remained exact. |

The passing small report is `small-2026-07-27T15-01-01.059Z.json`; the passing scaled XLSX-folder report is `scaled-sequential-2026-07-27T15-35-18.804Z.json`; and the mixed continuation limit is recorded in `scaled-sequential-2026-07-27T15-42-05.476Z.json`. The hours-long scaled concurrent suite was not rerun after these changes at the owner's direction; earlier concurrency evidence remains the current physical result.
