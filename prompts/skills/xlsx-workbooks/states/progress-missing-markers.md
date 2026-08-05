The last execution finished cleanly but did not print all three required `VAULT_PROGRESS` progress markers.

Repair or replace the program so every normal exit path, including the 75-second checkpoint path, prints `VAULT_PROGRESS_DONE`, `VAULT_PROGRESS_TOTAL`, and `VAULT_PROGRESS_COMPLETE`. Print final output labels only when `VAULT_PROGRESS_COMPLETE=1`.

Do not repeat the unchanged source.
