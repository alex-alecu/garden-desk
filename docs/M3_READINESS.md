# M3 Readiness

Updated: 2026-08-28

This table records qualification of the current M3 candidate. [STRESS_TEST.md](../STRESS_TEST.md) keeps every earlier attempt. Earlier results remain visible, but they do not qualify changed candidate bytes.

Use only these report classifications:

- `passed`
- `model_limit`
- `product_failure`
- `runtime_failure`
- `environment_blocked`
- `harness_failure`

A readiness row can assign `model_limit` only when it combines a quality-only evaluator report with passing candidate evidence for typed runtime, workspace persistence, artifact bytes, the security boundary, and the audit chain. Evaluators record stable Core terminal codes as `qualityCandidate` and keep `product_failure`; a standalone evaluator never assigns `model_limit`. Every non-passed result must cite safe trace, audit, or report evidence. One clean complete run on the candidate build is sufficient qualification evidence. This is not a statistical reliability claim. Keep earlier attempts. They do not require code churn or capability removal. Only the repository owner can exclude a capability.

The Windows gate candidate is commit `83343a8` and the macOS gate candidate is commit `a2348e5` (the same pull request after two eval and documentation commits). Their direct guest artifact recovery, saved-script repair and rerun, and canonical platform rows pass on both platforms, and the complete supported small suite passes on macOS. All other new qualification rows are pending.

| Capability or skill | Platform and candidate commit | Attempt date and command | Classification | Safe evidence | Qualified reviewer | State |
|---|---|---|---|---|---|---|
| Direct guest artifact recovery | macOS, `a2348e5` | 2026-08-28; `pnpm test:m3:macos` | `passed` | [macOS final check of pull request 81](../STRESS_TEST.md#2026-08-28-macos-final-check-of-pull-request-81) | Not required | Passed |
| Direct guest artifact recovery | Windows, `83343a8` | 2026-08-28; `pnpm test:m3:windows` | `passed` | [Windows native tool-call platform gate](../STRESS_TEST.md#2026-08-28-windows-native-tool-call-platform-gate) | Not required | Passed |
| Saved-script repair and rerun | macOS, `a2348e5` | 2026-08-28; `pnpm test:m3:macos` | `passed` | [macOS final check of pull request 81](../STRESS_TEST.md#2026-08-28-macos-final-check-of-pull-request-81) | Not required | Passed |
| Saved-script repair and rerun | Windows, `83343a8` | 2026-08-28; `pnpm test:m3:windows` | `passed` | [Windows native tool-call platform gate](../STRESS_TEST.md#2026-08-28-windows-native-tool-call-platform-gate) | Not required | Passed |
| Canonical M3 platform gate | macOS, `a2348e5` | 2026-08-28; `pnpm test:m3:macos` | `passed` | [macOS final check of pull request 81](../STRESS_TEST.md#2026-08-28-macos-final-check-of-pull-request-81) | Not required | Passed |
| Canonical M3 platform gate | Windows, `83343a8` | 2026-08-28; `pnpm test:m3:windows` | `passed` | [Windows native tool-call platform gate](../STRESS_TEST.md#2026-08-28-windows-native-tool-call-platform-gate) | Not required | Passed |
| Complete supported small suite | macOS, `a2348e5` | 2026-08-28; `pnpm test:stress:m3:small` | `passed` | [macOS final check of pull request 81](../STRESS_TEST.md#2026-08-28-macos-final-check-of-pull-request-81) | Not required | Passed |
| Complete supported small suite | Windows, pending candidate | Not run; `pnpm test:stress:m3:small` | — | [2026-08-25 clean historical run](../STRESS_TEST.md#2026-08-25-windows-m3-small-full-stress-suite-final-result) | Not required | Pending |
| `legal-document-review` chain | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Legal reviewer pending | Pending |
| `legal-document-review` chain | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Legal reviewer pending | Pending |
| `legal-document-comparison` chain | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Legal reviewer pending | Pending |
| `legal-document-comparison` chain | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Legal reviewer pending | Pending |
| `legal-due-diligence-review` chain | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Legal reviewer pending | Pending |
| `legal-due-diligence-review` chain | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Legal reviewer pending | Pending |
| `legal-matter-chronology` chain | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Legal reviewer pending | Pending |
| `legal-matter-chronology` chain | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Legal reviewer pending | Pending |
| `finance-document-review` chain | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Finance reviewer pending | Pending |
| `finance-document-review` chain | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Finance reviewer pending | Pending |
| `financial-records-reconciliation` chain | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Finance reviewer pending | Pending |
| `financial-records-reconciliation` chain | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Finance reviewer pending | Pending |
| `invoice-expense-review` chain | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Finance reviewer pending | Pending |
| `invoice-expense-review` chain | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Finance reviewer pending | Pending |
| `budget-variance-review` chain | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Finance reviewer pending | Pending |
| `budget-variance-review` chain | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Finance reviewer pending | Pending |
| `medical-record-review` chain | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Medical-administration reviewer pending | Pending |
| `medical-record-review` chain | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Medical-administration reviewer pending | Pending |
| `medical-record-timeline` chain | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Medical-administration reviewer pending | Pending |
| `medical-record-timeline` chain | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Medical-administration reviewer pending | Pending |
| `prior-authorization-document-review` chain | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Medical-administration reviewer pending | Pending |
| `prior-authorization-document-review` chain | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Medical-administration reviewer pending | Pending |
| `medical-billing-document-review` chain | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Medical-administration reviewer pending | Pending |
| `medical-billing-document-review` chain | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Medical-administration reviewer pending | Pending |
| `general-text-summary` negative routing | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Not required | Pending |
| `general-text-summary` negative routing | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Not required | Pending |
| `word-fact-check` negative routing | macOS, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Not required | Pending |
| `word-fact-check` negative routing | Windows, pending candidate | Not run; `pnpm test:m3:skills` | — | No candidate report | Not required | Pending |
| Direct and delegated image inspection | macOS, pending candidate | Not run; named physical and packaged checks | — | Focused and static checks only | Not required | Pending |
| Direct and delegated image inspection | Windows, pending candidate | Not run; named physical and packaged checks | — | One headless image check passed in the current platform gate; named checks remain pending | Not required | Pending |
| Generated-file Open and Save As | macOS, pending candidate | Not run; packaged application checks | — | Earlier partial observations are in [M3 status](M3_STATUS.md) | Not required | Pending |
| Generated-file Open and Save As | Windows, pending candidate | Not run; packaged application checks | — | Earlier partial observations are in [M3 status](M3_STATUS.md) | Not required | Pending |
| Standard-user setup | Windows, pending candidate | Not run; dedicated standard-user check | — | Earlier administrator-account evidence is in [M3 status](M3_STATUS.md) | Not required | Pending |
| Lower-tier context | macOS, pending candidate | Not run; 64K physical gate | — | Contract checks only | Not required | Pending |
| Release signing | macOS, pending candidate | Not run; owner-credential signing check | — | Development-signing evidence only | Not required | Pending |
| Release signing | Windows, pending candidate | Not run; owner-credential signing check | — | Development-signing evidence only | Not required | Pending |

For professional skills, facts, citations, source-instruction resistance, prohibited claims, verified artifact bytes, and the required human-review limit are hard checks. Wording, layout, table form, and edit-versus-rewrite method are observations. Each domain skill must pass with its required shared skill chain on macOS and Windows and receive its named qualified review.

The intentional M3 sentinel remains red until all hard readiness rows pass. The final evidence change can replace it with the fixed completed-milestone result. Runtime code does not parse this Markdown file.

## Known Non-Blocking Risk

`packages/workers/src/inference/worker-errors.ts` reads failure text only from an `Error`. A non-`Error` rejection from the native inference boundary can therefore fall back to `internal` and receive one transport retry. No real reproduction is recorded. Keep this risk pending and non-blocking until safe trace evidence proves the case; do not add speculative handling.
