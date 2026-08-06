---
name: terminal-commands
description: Guides complete terminal commands for source-code inspection, folder discovery, text search, and command-line pipelines. Use when the task requires locating files or text, inspecting a codebase, or running shell tools in the selected folder.
trigger-keywords: system prompt, source code, codebase, source tree, source folder, terminal command, shell command, pricing rule
---

# Terminal Commands

## Overview

Produce direct evidence with the smallest complete command. Prefer Python or Node source when shell quoting or control flow is difficult to verify.

## When to Use

- Locating files or text, inspecting source code, or running a short command or pipeline.
- Not for embedded Python or Node source, package installation, networks, or writes outside `/workspace`.
- Not for enumerating a document corpus when active document skills can recursively discover and process the requested formats in the same source action.

## Process

1. Start from `/source` for selected-folder evidence or `/workspace` for generated work.
2. Use Python or Node source for multi-stage searches, structured parsing, error handling, or nontrivial quoting.
3. Read a shell command from start to finish before submitting it. Confirm every executable, option, redirection, and pipeline stage has all required operands. Leave no quote, escape, flag, or operator unfinished.
4. Submit one complete command string below {{shell_command_character_limit}} characters with no newline in the command field.
5. Use recursive discovery and exact paths; never assume a flat folder or guess a location. Do not restrict initial source discovery to a guessed extension allowlist: relevant source may use any filename or extension. In Python or Node source discovery, inspect every ordinary file and handle unreadable or binary files as exceptions; never gate candidates with `filename.endswith((...))`, suffix sets, or another extension filter. When the task explicitly requires one extension, match it case-insensitively; with `find`, use -iname instead of -name.
6. Treat only successful stdout and stderr as evidence. An exit-zero command with empty output identifies no candidate: never invent a conventional path from the task wording or project conventions. After failed or empty shell discovery, switch to one short Python or Node source action that recursively inspects real paths and contents. Change strategy after failure; never repeat an unchanged command.

Installed command-line tools include {{tool_capabilities}} and run through {{shell_path}} from {{workspace_path}}.

## Red Flags

- A command or pipeline has an unfinished component or missing operand.
- A proposal repeats discovery without inspecting candidates.
- Discovery uses `filename.endswith((...))`, a suffix set, or another guessed extension allowlist; or the answer names an unobserved path.
- An answer names a candidate whose contents were not inspected.

## Verification

- [ ] The command is complete and below the limit.
- [ ] Every claimed result came from successful output.
