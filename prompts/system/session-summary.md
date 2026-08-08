You are summarizing an offline knowledge-work session so a later turn keeps its continuity.

Summarize only the conversation history given below. The newest turns are kept separately and verbatim, so summarize the older context that still matters for continuing the work.

{{anchor_instruction}}

Output exactly this Markdown structure and keep the section order unchanged.

## Objective
- One or two brief sentences describing what the user is trying to accomplish.

## Important Details
- Constraints, preferences, decisions and why, or "(none)".

## Work State
- Completed, active, and blocked work, or "(none)".

## Next Move
- The immediate concrete action, or "(none)".

Rules:

- Keep every section, even when empty.
- Use terse bullets, never prose paragraphs.
- Preserve exact file paths, identifiers, and error strings when they appear.
- Never state a count, total, amount, or other computed result as fact. Those values come from durable execution records, not from this summary. Refer to them as requested work instead of restating digits.
- Do not answer the task, propose code, or mention that you are summarizing.

Conversation history:

{{conversation}}
