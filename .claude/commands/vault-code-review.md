---
allowed-tools: Bash(gh pr comment:*), Bash(gh pr diff:*), Bash(gh pr view:*), mcp__github_inline_comment__create_inline_comment
description: Review a pull request against REVIEW.md, with CLAUDE.md as secondary context
---

Review the given pull request. `REVIEW.md` at the repository root is the primary review instruction set; `CLAUDE.md` and the files it imports are secondary general project context.

**Agent assumptions (applies to all agents and subagents):**
- All tools are functional. Do not test tools or make exploratory calls.
- Only call a tool when required to complete the task.
- Read the pull request only with `gh pr view` and `gh pr diff`; read repository files only with `Read`, `Grep`, and `Glob`. Never run `git`.
- Models and thinking levels are pinned: the orchestrator runs on the model and effort set by the workflow; subagents are the `review-gate` (Haiku, low effort), `review-sonnet` (Sonnet 5, high effort), and `review-opus` (Opus 5, medium effort) agents defined in `.claude/agents/`. Launch every agent with `subagent_type` set to one of those names and never override its model or effort. Those agents have no Agent tool, so they cannot launch agents of their own.

**Waiting for agents (this runs unattended, so it must never stall or loop):**
- Agents run in the background. Tell every agent its time budget in its prompt ("You have N seconds; reply with what you have before then"). After launching a group of agents, call `TaskOutput` once per agent with `block: true` and the timeout given for that step. Do not poll, sleep, schedule wakeups, or use `Monitor`. Only a lens agent that is still running after its first wait gets one more `TaskOutput` with timeout `60000`; no agent gets a third.
- An agent whose final `TaskOutput` status is not `completed`, or whose output is empty or unusable, has failed: call `TaskStop` on it and apply the fallback given for that step.
- Never end your turn while an agent you launched is still running; every step below ends with all its agents collected or stopped.

Follow these steps precisely:

1. Launch a `review-gate` agent that returns whether the pull request is closed, is a draft, or already has a review comment from claude (check `gh pr view <PR> --comments`). Wait with timeout `45000`. Stop if any is true. Fallback: continue with the review.

2. Read `REVIEW.md` in full. Read `CLAUDE.md` and any file it references with `@` syntax. Identify the review lenses that `REVIEW.md` defines under "WHAT TO REVIEW"; each inline `[tag]` line that introduces a bullet list is one lens.

3. Launch a `review-sonnet` agent to view the pull request and return a summary of the changes, including the title and description. Wait with timeout `90000`. Fallback: write the summary yourself from `gh pr view` and `gh pr diff`.

4. Launch one agent per lens in parallel: `review-opus` for `[security]` and `[business-logic]`, `review-sonnet` for `[performance]` and `[clean-code]`. Give each agent the full text of `REVIEW.md`, the paths of `CLAUDE.md` and its imports, the PR summary, and its assigned lens tag. Each agent reviews only through its lens and returns a list of issues. Each issue includes the lens tag, the severity from `REVIEW.md`, a `file:line` citation, a description, and the exact `REVIEW.md` or `CLAUDE.md` rule it violates. Agents must follow the "Skip these" list and flag only high-confidence issues; an issue that cannot be traced through the actual code is not reported. Wait with timeout `300000` per agent (plus the single 60-second second wait). Fallback: that lens has no findings, and the summary comment lists it under "Lenses not completed".

5. For each issue, launch a parallel validation subagent, using the same agent type as the lens that found it, that receives the PR summary and the issue and validates with high confidence that the issue is real, that the cited rule exists in `REVIEW.md` or `CLAUDE.md`, and that the rule applies to that file. Wait with timeout `120000` per agent. Discard issues that fail validation. Fallback: discard the issue.

6. Output the validated findings to the terminal using the "Summary Format" from `REVIEW.md`. If `--comment` was NOT provided, stop here.

7. If `--comment` was provided and there are no findings, post one comment with `gh pr comment` containing the `REVIEW.md` summary line and "No blocking issues." and stop.

8. If `--comment` was provided and there are findings, post one inline comment per unique issue using `mcp__github_inline_comment__create_inline_comment` with `confirmed: true`, formatted with the "COMMENT FORMAT" from `REVIEW.md`. Follow the "Suggestion Blocks" rule for single-line fixes; never post a committable suggestion unless committing it fixes the issue entirely. Then post one `gh pr comment` with the "Summary Format".

Notes:

- Use the gh CLI to interact with GitHub. Do not use web fetch.
- Link the cited rule and code in inline comments using the full git sha form `https://github.com/<owner>/<repo>/blob/<full-sha>/<path>#L<start>-L<end>`, with at least one line of context before and after.
- Do not approve, request changes, edit code, or push.
