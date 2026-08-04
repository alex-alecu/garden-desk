# Headless Stress Testing

## How the headless runner works

### macOS runner

The macOS headless paths run the shipped backend without the desktop UI. `pnpm test:stress:m3:macos:small` starts Vault Core and its current-user daemon, verifies the pinned `gemma-4-12b-it-qat-q4_0` model, and uses the generated macOS Virtualization.framework helper and agent image to run work inside the real no-NIC guest. `pnpm test:m3:macos` exercises the broader canonical M3 contract.

The runner creates its state and realistic fixture roots under `/tmp`, grants a selected folder through `folders.add`, creates sessions, starts work through `agent.start`, and polls `agent.get` until every run is terminal. The selected folder is mounted live and read-only at `/source`; only the bounded guest `/workspace` is writable. The runner also tests policy rejections and concurrent sessions, collects `agent.trace`, validates exact output tokens from terminal snapshots and execution output, verifies the audit chain, revokes grants, deletes sessions, closes the daemon, and removes temporary fixtures. Complete ignored evidence is written under `packages/eval/.generated/stress/`.

Task-specific evaluations use an ignored TypeScript runner under `packages/eval/.generated/` with the same Core, daemon, CLI RPC, real Gemma worker, and no-NIC guest. Expected answers must remain outside the model prompt, and success must come from current execution evidence rather than response text or historical runs alone.

### Windows runner

The Windows headless paths run the shipped backend without the desktop UI. `pnpm test:m3:windows` uses the real Gemma worker, AppContainer launcher, Hyper-V HCS helper, and x86_64 agent image to exercise the canonical no-NIC guest and agent contract. `pnpm test:m3:windows:memory` separately verifies the physical GPU-memory-derived context cap and clean worker shutdown. Windows currently has no document-stress profile equivalent to the macOS-only small and scaled suites.

## Latest macOS results - 2026-08-03

The latest run was performed on 2026-08-03 on physical Apple silicon against `main` at `58937a4` (`Centralize agent prompts and skills`). This is macOS evidence only; it does not establish current Windows behavior.

The realistic fixture contained 10 files: TypeScript, JSON, CSV, Markdown, two XLSX workbooks with 10,000 rows, two DOCX files with 16 pages, and an eight-page PDF. Five sessions were started together.

| Suite or check | Result | Evidence | Failure or limit |
|---|---|---|---|
| Small stress suite | **LIMIT FOUND** | 6 of 8 cases passed. | Sequential XLSX-folder and invalid-PDF cases failed. |
| Sequential PDF | **PASS** | `PDF_PAGES=12`; `PDF_CHECKSUM=1326`. | None. |
| Sequential workbook | **PASS** | `XLSX_MATCHES=2`; `XLSX_TOTAL=2003`. | None. |
| Sequential XLSX folder | **FAIL** | Found all 6 matches and all 3 workbooks. | Returned `XLSX_TOTAL=0.0` instead of `12009`; generated code found row amounts but never added them to the total. |
| Sequential mixed folder | **PASS** | Exact XLSX and DOCX counts and checksums. | None. |
| Invalid PDF | **FAIL** | Printed the requested stop token. | Incorrectly attempted repairs, executed four times, and ended in `agent_stalled_duplicate`. |
| Three concurrent cases | **PASS** | PDF, XLSX-folder, and mixed-folder cases passed with `maximumRunning: 3`. | None. |
| Realistic skill suite | **LIMIT FOUND** | 3 of 5 cases passed across five simultaneously started sessions. | Terminal-only and combined terminal-plus-XLSX cases stalled. |
| Direct response; no skill | **PASS** | Returned a correct concise response with zero executions. | None. |
| Terminal-only source discovery | **FAIL** | `terminal-commands` was active on every turn. | Emitted malformed or incomplete commands such as `grep, -r` and `grep -r `, then duplicate-stalled. |
| Hidden-answer XLSX analysis | **PASS** | `XLSX_MATCHES=4`; `XLSX_TOTAL=6006.0`. | None. |
| Attached-PDF analysis | **PASS** | `PDF_PAGES=8`; `PDF_CHECKSUM=612`. | None. |
| Combined terminal and XLSX | **FAIL** | Both required skills were active. | Discovery omitted the real `.ts` file, guessed a nonexistent path, and duplicate-stalled before workbook analysis. |
| Dynamic skill disclosure | **PASS** | Direct: none; terminal: `terminal-commands`; workbook: `xlsx-workbooks`; PDF: `pdf-reading`; combined: terminal plus XLSX. Unselected skill bodies remained unloaded. | Correct disclosure did not guarantee that Gemma followed the terminal guidance. |
| Model and audit | **PASS** | Audit chain verified; model moved from `unloaded` to `ready`. | None. |
| Canonical `pnpm test:m3:macos` gate | **CERTIFIED** | Real Python and Node artifacts, persistence, cancellation, limits, live read-only source, confinement, cleanup, two overlapping VM lifetimes, and the 131,072-token cap passed. | macOS evidence only. |
| `pnpm verify` | **PASS** | Source limits, lint, type checking, 328 unit tests with one skip, two native tests, native helpers, desktop builds, and Rust checks passed. | None. |

The backend, daemon, model, guest isolation, audit, and canonical gate remained healthy. The stress result is still a limit rather than a pass because realistic terminal-command reliability and two bounded agent-loop behaviors were incorrect.

## Latest Windows results - 2026-08-04

The full supported Windows stress path ran on physical Windows 11 x64 against `main` at `b08f455`. The host reported 33,408,679,936 bytes of RAM, Hyper-V active, and an NVIDIA GeForce RTX 5070 Ti. The macOS-only document stress profiles were not run and no macOS result is inferred from this evidence.

| Suite or check | Result | Evidence | Failure or limit |
|---|---|---|---|
| Canonical `pnpm test:m3:windows` gate | **CERTIFIED** | The refreshed-helper rerun returned `certified_headless` in 452.3 s. Live read-only source, persistent workspace, Python, Node.js, shell, repair, cancellation, timeout, output, process, memory, quota, crash, escaping-link, rehydration, no-NIC isolation, one-million-byte stdout truncation, malformed-frame teardown, and retained VM teardown diagnostics passed. | The first attempt stopped during the primary guest launch with `agent_helper_exited_1`; HCS recorded startup termination `0xC0370103`. Rebuilding the current locked HCS helper succeeded, and the identical rerun passed. |
| `pnpm test:m3:windows:memory` | **PASS** | After refreshing the generated worker from current TypeScript output, the canary passed in 46.7 s with `status: ok`, 33,744,748,544 detected GPU-memory bytes, 10,249,468,672 GPU bytes, 977,854,432 CPU bytes, the 131,072-token `windows_gpu_vram_above_24_gib` cap, and clean shutdown. | Two preliminary attempts used an ignored worker bundle dated before the context-cap amendment and correctly failed after reporting a 262,144-token context. The native-launcher build alone did not refresh that TypeScript bundle; `pnpm typecheck` followed by `pnpm workers:windows-native:build` did. |
| `pnpm verify` | **PASS** | Completed in 84.6 s. Source limits, lint, type checking, 79 unit test files passed and one was skipped by its platform condition; 327 tests passed and two were skipped. Two native tests, Rust checks, signed helper and sidecar builds, resource checks, and the desktop production build passed. | Vite retained its informational chunk-size warning; no verification command failed. |

The final current-source Windows agent gate, memory canary, and repository verification all passed. This run does not resolve the macOS realistic skill limits recorded above, does not exercise the macOS-only scaled document profiles, and does not satisfy the remaining installed-Windows UI, standard-user setup, or public release-signing evidence required for the global M3 gate.
