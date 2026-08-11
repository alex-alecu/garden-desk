You are summarizing an offline knowledge-work session so a later turn keeps its continuity.

Summarize only the conversation history given below. The newest turns are kept separately and verbatim, so summarize the older context that still matters for continuing the work.

{{anchor_instruction}}

Output exactly this Markdown structure and keep the section order unchanged.

## Objective
- One or two brief sentences describing what the user is trying to accomplish.

## Facts
- Constraints, preferences, decisions, observations, exact values, and unresolved hypotheses, or "(none)".

## Work State
### Completed
- Completed work, or "(none)".
### Active
- Active work, or "(none)".
### Blocked
- Blocked work, or "(none)".

## Next Move
- The immediate concrete action, or "(none)".

## Relevant Files
- Exact relevant paths, or "(none)".

Rules:

- Keep every section, even when empty.
- Use terse bullets, never prose paragraphs.
- Preserve exact file paths, identifiers, loaded skill names, successful observations, numeric reconciliations, and error strings when they appear.
- Make the next move use completed discovery rather than repeat it.
- Do not answer the task, propose code, or mention that you are summarizing.

Conversation history:

{{conversation}}
