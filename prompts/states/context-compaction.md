# Compacted task state

The completed observations exceeded the active evidence budget, so Vault Core compacted them before this model turn. The durable execution records and workspace files remain unchanged.

- Task ledger: {{execution_ledger}}
- Evidence ledger: {{evidence_ledger}}
- Artifact ledger: {{artifact_ledger}}
- Warning ledger: {{warning_ledger}}
- Raw observation characters omitted from the live prompt: {{omitted_characters}}

Continue from these inspectable ledgers. Do not repeat a completed execution merely because its raw output was compacted. Use the evidence ledger for exact task-relevant values and read a bounded part of a workspace file only when required evidence is absent.

An empty evidence ledger means the compacted output held no task-relevant labels or values, not that the work is unfinished. When the task ledger already shows every requested execution completed successfully, the task is complete: respond now and describe that result instead of executing again.
