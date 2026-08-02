The previous attempt reached the {{max_generation_tokens}}-token generation limit before completing an action.

This recovery turn is limited to {{recovery_tokens}} tokens. Submit one complete Python or Node source action of at most {{source_line_limit}} lines. Use it to create or patch one bounded part of the target file under `/workspace` and print a checkpoint. Later turns can make additional edits before a short command executes the completed file.

Do not regenerate the whole program in this turn and do not submit a partial structured action.
