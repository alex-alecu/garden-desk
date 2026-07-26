# M3 Document Stress Evaluation

Created: 2026-07-26

This evaluation measures the existing M3 generic offline development agent with the real Gemma 4 12B QAT worker, current-user daemon, and no-NIC microVM. It does not add a product document parser or change agent behavior.

## Two-stage delivery

The work is intentionally split across two pull requests:

1. **Small realistic suite:** prove the harness and file formats with reduced versions of every workload, unsafe-folder rejection, invalid input, sequential execution, and three simultaneous conversations.
2. **Scaled suite:** add the requested 100-page PDF; 10-sheet, 1,000,000-row workbook; 100-workbook folder; mixed 20-workbook plus 100-DOCX folder; and three simultaneous scaled cases. The scaled suite is written but not executed in that stage unless the owner separately starts it.

Repository workflow requires the first pull request to merge or close before the second stage begins.

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

The suite exits nonzero when it finds a limit. A nonzero result is evidence to record, not authorization to change the agent. Agent changes require a separate owner-approved strategy after both stress suites are ready.

## Phase 2 constraints

- Generate XLSX XML and ZIP entries as streams so 1,000,000-row sheets do not require equivalent host RAM.
- Run scaled cases sequentially by default and preserve one explicit three-conversation scaled case.
- Keep the selected folder live and read-only; do not copy it into Core or the guest workspace.
- Report fixture generation time separately from agent/model time.
- Preserve complete terminal state, error, response, events, stdout, stderr, VM diagnostics, and inference traces.
- Do not add the scaled command to the default M3 or repository verification gates.
- Do not infer Windows behavior from macOS results.

## Phase 1 physical baseline

The small suite ran on 2026-07-26 on the physical 48 GB Apple-silicon Mac. The real model finished ready with a 17,179,869,184-byte budget, 1,112,334,048 CPU RAM bytes, 12,396,953,088 GPU VRAM bytes, and 262,144-token context. All eight agent runs reached a terminal `succeeded` state, and the unsafe-root, missing-folder, regular-file, and invalid-session requests were rejected before model or VM work.

| Case | Wall time | Evidence result |
|---|---:|---|
| PDF | 31.061 s | Passed 12-page count and checksum. |
| Workbook | 89.236 s | Limit found: missing both required XLSX aggregates. |
| XLSX folder | 89.259 s | Limit found: missing both required XLSX aggregates. |
| Mixed folder | 51.142 s | Passed all XLSX and DOCX aggregates. |
| Invalid PDF | 19.054 s | Passed bounded stop with one execution and no artifact. |
| Three concurrent cases | 157.511 s | Observed `maximumRunning: 3`; PDF and mixed passed, XLSX folder reproduced the sequential limit. |

The XLSX-only failure is reproducible and retained without an agent fix. Gemma copied the inspection example with an uppercase target compared against lowercased cell values, so it found no rows. It then proposed the same exact program eleven more times; Core rejected every duplicate and the final response incorrectly said execution capacity was exhausted after only one execution. The mixed workload generated a different two-execution program and passed all requested values, confirming that the streamed XLSX and DOCX fixtures and guest libraries are valid.

The complete local evidence is in the ignored `packages/eval/.generated/stress/small-2026-07-26T13-49-51.871Z.json` report. The suite correctly exits nonzero with `small_stress_limit_found`. No product or agent implementation was changed in response.
