# Current task state

Selected input count: {{selected_input_count}}.
Selected input files: {{selected_input_files}}.
{{selected_input_instruction}}

Task: {{task}}

Completed execution observations: {{observations}}

- Successful execution count: {{successful_execution_count}}.
- Remaining execution capacity: {{remaining_execution_capacity}}.
- Rejected duplicate or pathologically repetitive programs: {{rejected_duplicates}}. A rejected program was not executed and does not advance the task. After a rejection, start from a fresh short strategy instead of copying the rejected source.
- Required output labels: {{required_output_labels}}. A result is complete only when stdout contains every label exactly as `LABEL=value` with no spaces around the equals sign.
- Produced artifact names: {{artifact_names}}.

These observations are authoritative. Never repeat completed code or a completed task step.

When an execution failed or produced no useful output, repair its recorded source or command or replace it with a different bounded strategy. For ordered task steps, completed execution 1 means step 1 is done; the next action must implement step 2.

Choose execute only if a requested step is still missing from the observations. If every requested execution and artifact is evidenced, you must choose respond now and must not execute again.
