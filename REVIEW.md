# Code Review Instructions

Vault Desk is a local, offline-first desktop agent. The model is untrusted for execution decisions; the no-network microVM and typed adapters are the only isolation. Review through the four lenses below. A single agent reviews all lenses for a small or medium change. Each finding agent takes one lens for a large change.

## REVIEW SIZE

Measure the diff for this run: the complete PR in full mode or only the new commits in incremental mode. Count additions plus deletions and changed files. Do not count lock files (`pnpm-lock.yaml`, `package-lock.json`, and `yarn.lock`) or snapshot files under `__snapshots__/`.

| Tier            | Rule                                                      | Review method                                                               |
| --------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Small to medium | At most 400 changed lines and at most 15 changed files    | One `review-opus` agent reviews all four lenses and validates its findings. |
| Large           | More than 400 changed lines or more than 15 changed files | One summary agent, one agent per lens, and one validator per finding.       |

Select the tier one time before a lens agent starts. Both tiers use the same lenses, comment format, and summary format.

# WHAT TO REVIEW

**Flag these (high confidence only):**

`[security]`

- Model, guest, or document content reaching a host shell, a writable host source path, a network call, or host authority outside the active typed scope
- Guest or worker data entering authoritative host state without contract-required validation of schema, path, size, bytes, hash, or protocol
- Destructive or consequential host actions that skip contract-required validation, approval, audit, or rollback
- Product policy, filesystem authorization, network brokering, or parsing moved into the Rust or Swift helpers under `packages/*/native/`
- Raw native-helper stderr, inference diagnostics, or customer content in reports, snapshots, UI data, or committed files
- Any telemetry, cloud call, silent cloud fallback, or unpinned download

`[business-logic]`

- Agent runs that can end non-terminal, ignore cancellation, or fail to recover after a Core restart
- `packages/shared` contract changes with an unupdated consumer, fixture, or test
- Changes to completed M0-M2 contracts, or post-V1 scope, not stated in the PR
- Platform evidence inferred across platforms or from fake inference
- Behavior, default, or command changes without the matching update in `AGENTS.md`, `docs/IMPLEMENTATION_PLAN.md`, or `docs/M3_STATUS.md`

`[performance]`

- Context or prompt assembly without a token budget; event or message arrays that never compact
- Unbounded stdout, stderr, or workspace capture; ignoring the 128 MiB guest limit
- Blocking or quadratic work on a model turn or streaming path
- Leaked VM, process, socket, or capacity lease; bypassing the LRU guest pool
- Full conversation re-render per stream chunk; persistence on every keystroke

`[clean-code]` - over-engineering is a defect, not a style preference

- Code that handles a case no current supported workflow can reach: extra defensive branches, fallbacks, retries, compatibility shims, or configuration for hypothetical inputs
- Security checks inside the no-network microVM boundary: command or URL filters, content or format inspection, or repeated validation of guest-only paths
- Abstractions with one caller: interfaces, generics, factories, registries, option objects, or extension points added before a second concrete use exists
- Boolean flag arguments, mixed command and query functions, and duplication that should be deleted rather than parameterized
- Try/catch, null checks, or error wrapping at every call level: handle an error once, at the boundary that can recover, report, or audit it, and let everything else propagate
- A larger change than the PR's stated goal needs: refactors, renames, or restructuring unrelated to the fix

**Tests - the minimum that proves the change (`[clean-code]`):**

- Flag over-testing as WARNING: more than one test per new behavior, tests for the same invariant in several files, tests for framework wiring, type checks, trivial getters, or unsupported scenarios
- Flag tests that assert private implementation details, internal call order, or mock interactions instead of an observable outcome
- Flag test helpers, fixtures, builders, or parameterized matrices introduced for a single test
- Flag a missing test only when the Test Rule in `AGENTS.md` requires one for a bug, architecture boundary, or business rule; otherwise never request more tests
- For guest security, one focused isolation-boundary test is enough. Never request a security test matrix for command, URL, path, file-content, or format variations contained by the microVM.
- Never suggest coverage for edge cases the active milestone does not support; an explicit unsupported outcome is the correct behavior

**Skip these:**

- Anything `pnpm verify` enforces: Biome, TypeScript, clippy, rustfmt, source limits
- Lockfiles, `.generated/`, `dist/`, `target/`, Tauri `gen/` and `binaries/`, pinned version bumps
- Prose-only edits in `docs/research/`, `docs/strategy/`, and `site/`
- Test-only code that intentionally violates production rules
- Explicit unsupported outcomes in place of hypothetical case handling
- Requests to filter or validate guest command text and file contents when the no-network microVM and read-only `/source` mount contain them
- Patterns already used elsewhere in the codebase

**Catalog migrations (`packages/core/src/workspace/migrations/*.sql` - DO review these):**

- Editing an existing numbered migration instead of adding the next one
- `NOT NULL` without `DEFAULT` on populated columns
- Dropping or renaming columns still read by the audit chain, debug snapshot, or recovery path
- Unbounded rewrites of trace or event tables without batching
- Schema changes without the matching TypeScript row type and catalog version bump

# COMMENT FORMAT

```
**SEVERITY:** `lens` Brief description

Explanation with a `file:line` citation traced through the actual call path.
```

**Severities:** CRITICAL (blocks merge), WARNING (should fix), SUGGESTION (nice to have)

- CRITICAL: isolation, authorization, privacy, audit, recovery, evidence, or shared-contract breaks; catalog migration defects
- WARNING: over-engineering, over-testing, milestone-scope creep, performance regressions with a cited call path, stale authoritative docs
- SUGGESTION: everything else; report at most six and count the rest in the summary

After the first review of a PR, post CRITICAL and WARNING findings only. Never suggest adding abstractions, options, defensive code, or tests beyond what the current change needs.

## Suggestion Blocks (for typos and simple fixes)

For single-line fixes, use GitHub's suggestion syntax. The block replaces ONLY the commented line: put the corrected version of that one line inside it, with no old code, no surrounding lines, and no diff markers.

## Summary Format

Start every review body as follows:

```
## Claude Code review

**Status:** <status> | **Recommendation:** <recommendation>
Tier: <single-agent or full-suite>
```

Use one of these status lines. `<n>` is the total number of findings.

```
**Status:** No Issues Found | **Recommendation:** Merge
**Status:** 1 Suggestion Found | **Recommendation:** Merge
**Status:** <n> Suggestions Found | **Recommendation:** Merge
**Status:** 1 Issue Found | **Recommendation:** Address before merge
**Status:** <n> Issues Found | **Recommendation:** Address before merge
```

Use the suggestion status only when all findings are SUGGESTION. Use the issue status when at least one finding is CRITICAL or WARNING. Follow the tier line with one sentence that names the highest-risk finding and its file, or `No blocking issues.` when there is no CRITICAL or WARNING finding.

End the review body with `Reviewed <full head sha>`. The next run reviews only the commits after that sha.
