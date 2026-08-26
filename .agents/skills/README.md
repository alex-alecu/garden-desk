# Agent Skills

Short, on-demand instructions that package the [development workflow](../../docs/DEVELOPMENT_WORKFLOW.md) for coding agents. Codex reads this directory; Claude Code reads the `.claude/skills` symlink to it (on a Windows checkout without symlink support, Claude Code will not see them). They do not override [AGENTS.md](../../AGENTS.md), ADRs, or the active milestone, and they cannot install tools, mutate external systems, or broaden permissions.
