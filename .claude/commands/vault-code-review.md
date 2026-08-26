---
allowed-tools: Bash(gh pr comment:*), Bash(gh pr diff:*), Bash(gh pr view:*), mcp__github_inline_comment__create_inline_comment
description: Review a pull request against REVIEW.md, with CLAUDE.md as secondary context
---

Review the given pull request. `REVIEW.md` at the repository root is the primary review instruction set; `CLAUDE.md` and the files it imports are secondary general project context.

**Agent assumptions (applies to all agents and subagents):**
- All tools are functional. Do not test tools or make exploratory calls.
- Only call a tool when required to complete the task.

Follow these steps precisely:

1. Launch a haiku agent to stop if any of the following are true: the pull request is closed, is a draft, or already has a review comment from claude (check `gh pr view <PR> --comments`).

2. Read `REVIEW.md` in full. Read `CLAUDE.md` and any file it references with `@` syntax. Identify the review lenses that `REVIEW.md` defines under "WHAT TO REVIEW"; each inline `[tag]` line that introduces a bullet list is one lens.

3. Launch a sonnet agent to view the pull request and return a summary of the changes, including the title and description.

4. Launch one opus agent per lens in parallel. Give each agent the full text of `REVIEW.md`, the paths of `CLAUDE.md` and its imports, the PR summary, and its assigned lens tag. Each agent reviews only through its lens and returns a list of issues. Each issue includes the lens tag, the severity from `REVIEW.md`, a `file:line` citation, a description, and the exact `REVIEW.md` or `CLAUDE.md` rule it violates. Agents must follow the "Skip these" list and flag only high-confidence issues; an issue that cannot be traced through the actual code is not reported.

5. For each issue, launch a parallel opus subagent that receives the PR summary and the issue and validates with high confidence that the issue is real, that the cited rule exists in `REVIEW.md` or `CLAUDE.md`, and that the rule applies to that file. Discard issues that fail validation.

6. Output the validated findings to the terminal using the "Summary Format" from `REVIEW.md`. If `--comment` was NOT provided, stop here.

7. If `--comment` was provided and there are no findings, post one comment with `gh pr comment` containing the `REVIEW.md` summary line and "No blocking issues." and stop.

8. If `--comment` was provided and there are findings, post one inline comment per unique issue using `mcp__github_inline_comment__create_inline_comment` with `confirmed: true`, formatted with the "COMMENT FORMAT" from `REVIEW.md`. Follow the "Suggestion Blocks" rule for single-line fixes; never post a committable suggestion unless committing it fixes the issue entirely. Then post one `gh pr comment` with the "Summary Format".

Notes:

- Use the gh CLI to interact with GitHub. Do not use web fetch.
- Link the cited rule and code in inline comments using the full git sha form `https://github.com/<owner>/<repo>/blob/<full-sha>/<path>#L<start>-L<end>`, with at least one line of context before and after.
- Do not approve, request changes, edit code, or push.
