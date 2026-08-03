# Headless Stress Testing

## How the headless runner works

The macOS headless paths run the shipped backend without the desktop UI. `pnpm test:stress:m3:macos:small` starts Vault Core and its current-user daemon, verifies the pinned `gemma-4-12b-it-qat-q4_0` model, and uses the generated macOS Virtualization.framework helper and agent image to run work inside the real no-NIC guest. `pnpm test:m3:macos` exercises the broader canonical M3 contract.

The runner creates its state and realistic fixture roots under `/tmp`, grants a selected folder through `folders.add`, creates sessions, starts work through `agent.start`, and polls `agent.get` until every run is terminal. The selected folder is mounted live and read-only at `/source`; only the bounded guest `/workspace` is writable. The runner also tests policy rejections and concurrent sessions, collects `agent.trace`, validates exact output tokens from terminal snapshots and execution output, verifies the audit chain, revokes grants, deletes sessions, closes the daemon, and removes temporary fixtures. Complete ignored evidence is written under `packages/eval/.generated/stress/`.

Task-specific evaluations use an ignored TypeScript runner under `packages/eval/.generated/` with the same Core, daemon, CLI RPC, real Gemma worker, and no-NIC guest. Expected answers must remain outside the model prompt, and success must come from current execution evidence rather than response text or historical runs alone.

## Latest results

The latest run was performed on 2026-08-03 on physical Apple silicon against `main` at `58937a4` (`Centralize agent prompts and skills`). This is macOS evidence only; it does not establish current Windows behavior.

- `pnpm test:stress:m3:macos:small` returned `small_stress_limit_found`: 6 of 8 cases passed. All three concurrent PDF, XLSX-folder, and mixed-folder cases passed with `maximumRunning: 3`. The sequential three-workbook case returned `XLSX_TOTAL=0.0` instead of `12009` because the generated program found row amounts but never added them to the total. The invalid-PDF case printed the requested stop token, then incorrectly attempted repairs, executed four times, and ended in `agent_stalled_duplicate`.
- A realistic 10-file Q2 review fixture included TypeScript, JSON, CSV, Markdown, two XLSX workbooks with 10,000 rows, two DOCX files with 16 pages, and an eight-page PDF. Five sessions were started together. Direct response, hidden-answer XLSX analysis, and attached-PDF analysis passed; terminal-only source discovery and combined source-plus-XLSX analysis failed in duplicate stalls. The terminal failures included incomplete or malformed commands such as `grep -r ` and `grep, -r`, extension-limited discovery that omitted the real `.ts` file, and a guessed nonexistent path.
- Dynamic skill disclosure was correct on every traced turn: the direct task loaded no skill body, terminal inspection loaded only `terminal-commands`, workbook analysis loaded only `xlsx-workbooks`, the attached PDF loaded only `pdf-reading`, and the combined task loaded `terminal-commands` plus `xlsx-workbooks`. Unselected skills remained catalogued as available with their bodies omitted. Correct loading did not guarantee that Gemma followed the terminal guidance.
- The realistic audit chain passed, the model moved from `unloaded` to `ready`, XLSX execution produced `XLSX_MATCHES=4` and `XLSX_TOTAL=6006.0`, and PDF execution produced `PDF_PAGES=8` and `PDF_CHECKSUM=612` from the real files.
- `pnpm test:m3:macos` returned `certified`. It passed real Python and Node tasks and artifacts, persistence, cancellation, timeout and output limits, live read-only source behavior, network and write confinement, session cleanup, and two overlapping real VM lifetimes at the certified 131,072-token context cap.
- `pnpm verify` passed: source limits, lint, type checking, 328 unit tests with one skip, two native tests, native helper checks/builds, desktop sidecar and web builds, and Rust formatting and linting.

The backend, daemon, model, guest isolation, audit, and canonical gate remained healthy. The stress result is still a limit rather than a pass because realistic terminal-command reliability and two bounded agent-loop behaviors were incorrect.
