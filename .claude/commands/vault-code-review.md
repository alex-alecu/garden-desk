---
allowed-tools: Bash(gh pr comment:*), Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh api repos/alex-alecu/vault-desk/compare:*), Bash(gh api repos/alex-alecu/vault-desk/pulls:*), mcp__github_inline_comment__create_inline_comment
description: Review a pull request against REVIEW.md, with CLAUDE.md as secondary context
---

Review the given pull request. `REVIEW.md` at the repository root is the primary review instruction set; `CLAUDE.md` and the files it imports are secondary general project context.

**Agent assumptions (applies to all agents and subagents):**
- All tools are functional. Do not test tools or make exploratory calls.
- Only call a tool when required to complete the task.
- Read the pull request only with `gh pr view`, `gh pr diff`, and the `gh api .../compare` and `gh api .../pulls` read commands named below; read repository files only with `Read`, `Grep`, and `Glob`. Never run `git`.
- Models and thinking levels are pinned: the orchestrator runs on the model and effort set by the workflow; subagents are the `review-gate` (Haiku, low effort), `review-sonnet` (Sonnet 5, high effort), and `review-opus` (Opus 5, medium effort) agents defined in `.claude/agents/`. Launch every agent with `subagent_type` set to one of those names and never override its model or effort. Those agents have no Agent tool, so they cannot launch agents of their own.

**Waiting for agents (this runs unattended, so it must never stall or loop):**
- Agents run in the background. Tell every agent its time budget in its prompt ("You have N seconds; reply with what you have before then"). After launching a group of agents, call `TaskOutput` once per agent with `block: true` and the timeout given for that step. Do not poll, sleep, schedule wakeups, or use `Monitor`. Only a lens agent that is still running after its first wait gets one more `TaskOutput` with timeout `60000`; no agent gets a third.
- An agent whose final `TaskOutput` status is not `completed`, or whose output is empty or unusable, has failed: call `TaskStop` on it and apply the fallback given for that step.
- Never end your turn while an agent you launched is still running; every step below ends with all its agents collected or stopped.

**Review modes:**
- Full review: no earlier claude summary comment exists on the pull request. Review the whole `gh pr diff`.
- Incremental review: the newest claude summary comment ends with a `Reviewed <sha>` line. Review only the commits after that sha, so work is not repeated. Per `REVIEW.md`, an incremental review posts CRITICAL and WARNING findings only.

Follow these steps precisely:

1. Launch a `review-gate` agent that returns: whether the pull request is closed or a draft; the current head sha from `gh pr view <PR> --json headRefOid`; and the sha from the `Reviewed <sha>` line of the newest claude comment in `gh pr view <PR> --comments`, or `none`. Wait with timeout `45000`. Stop if the pull request is closed or a draft. Fallback: continue with a full review.

2. Read `REVIEW.md` in full. Read `CLAUDE.md` and any file it references with `@` syntax. Identify the review lenses that `REVIEW.md` defines under "WHAT TO REVIEW"; each inline `[tag]` line that introduces a bullet list is one lens.

3. Choose the mode. With a reviewed sha, run `gh api repos/<owner>/<repo>/compare/<reviewed-sha>...<head-sha> --jq '{status, files: [.files[] | {filename, patch}]}'`. If `status` is `ahead` and `files` is not empty, the mode is incremental and that output is the diff to review; also collect the earlier claude inline findings with `gh api repos/<owner>/<repo>/pulls/<number>/comments --jq '.[] | select(.user.login == "claude[bot]") | {path, line, body}'`. If `status` is `identical`, post nothing and stop. Otherwise (no reviewed sha, `behind`, `diverged`, or a failed command) the mode is full.

4. Launch a `review-sonnet` agent to view the pull request and return a summary of the changes, including the title and description, and, in incremental mode, which files and behaviors the new commits change. Wait with timeout `90000`. Fallback: write the summary yourself from `gh pr view` and the diff.

5. Launch one agent per lens in parallel: `review-opus` for `[security]` and `[business-logic]`, `review-sonnet` for `[performance]` and `[clean-code]`. Give each agent the full text of `REVIEW.md`, the paths of `CLAUDE.md` and its imports, the PR summary, the mode, the exact command that produces the diff to review, the earlier claude findings in incremental mode, and its assigned lens tag. Each agent reviews only through its lens and only the diff for the mode, and returns a list of issues. In incremental mode it does not repeat an earlier finding; it reports an earlier finding again only when the new commits claim to fix it and do not. Each issue includes the lens tag, the severity from `REVIEW.md`, a `file:line` citation (a line range when the finding spans lines), a description, and the exact `REVIEW.md` or `CLAUDE.md` rule it violates. Agents must follow the "Skip these" list and flag only high-confidence issues; an issue that cannot be traced through the actual code is not reported. Wait with timeout `300000` per agent (plus the single 60-second second wait). Fallback: that lens has no findings, and the summary comment lists it under "Lenses not completed".

6. For each issue, launch a parallel validation subagent, using the same agent type as the lens that found it, that receives the PR summary and the issue and validates with high confidence that the issue is real, that the cited rule exists in `REVIEW.md` or `CLAUDE.md`, and that the rule applies to that file. Wait with timeout `120000` per agent. Discard issues that fail validation. Fallback: discard the issue.

7. Output the validated findings to the terminal using the "Summary Format" from `REVIEW.md`. If `--comment` was NOT provided, stop here.

8. If `--comment` was provided, post every validated finding as its own inline comment on the line or line range it applies to, using `mcp__github_inline_comment__create_inline_comment` with `confirmed: true`, formatted with the "COMMENT FORMAT" from `REVIEW.md`. Never bundle findings into one comment. Follow the "Suggestion Blocks" rule for single-line fixes; never post a committable suggestion unless committing it fixes the issue entirely.

9. If `--comment` was provided, post one `gh pr comment` with the "Summary Format": the counts line, the highest-risk sentence or "No blocking issues.", any "Lenses not completed" line, and the closing `Reviewed <head-sha>` line. Post it in both modes, even with zero findings, so the next run knows where to continue.

Notes:

- Use the gh CLI to interact with GitHub. Do not use web fetch.
- Link the cited rule and code in inline comments using the full git sha form `https://github.com/<owner>/<repo>/blob/<full-sha>/<path>#L<start>-L<end>`, with at least one line of context before and after.
- Do not approve, request changes, edit code, or push.
