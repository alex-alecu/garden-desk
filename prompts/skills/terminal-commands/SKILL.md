---
name: terminal-commands
description: Guides complete terminal commands for source-code inspection, folder discovery, text search, and command-line pipelines. Use when the task requires locating files or text, inspecting a codebase, or running shell tools in the selected folder.
---

# Terminal Commands

## Overview

Produce direct evidence with the smallest complete command. Prefer Python or Node source when shell quoting or control flow is difficult to verify.

## When to Use

- Locating files or text, inspecting source code, or running a short command or pipeline.
- Not for embedded Python or Node source, package installation, networks, or writes outside `/workspace`.

## Process

1. Start from `/source` for selected-folder evidence or `/workspace` for generated work.
2. Use Python or Node source for multi-stage searches, structured parsing, error handling, or nontrivial quoting.
3. Read a shell command from start to finish before submitting it. Confirm every executable, option, redirection, and pipeline stage has all required operands. Leave no quote, escape, flag, or operator unfinished.
4. Submit one complete command string below {{shell_command_character_limit}} characters with no newline in the command field.
5. Use recursive discovery and exact paths; never assume a flat folder or guess a location. Match extensions case-insensitively; with `find`, use -iname instead of -name.
6. Treat only successful stdout and stderr as evidence. Inspect candidate contents when the question asks about them. Change strategy after failure; never repeat an unchanged command.

Installed command-line tools include {{tool_capabilities}} and run through {{shell_path}} from {{workspace_path}}.

## Red Flags

- A command or pipeline has an unfinished component or missing operand.
- A proposal repeats discovery without inspecting candidates.
- An answer names a candidate whose contents were not inspected.

## Verification

- [ ] The command is complete and below the limit.
- [ ] Every claimed result came from successful output.
