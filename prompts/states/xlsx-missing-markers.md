The last execution finished cleanly but did not print all three required `VAULT_XLSX` progress markers.

Repair or replace the program so every normal exit path, including the 75-second checkpoint path, prints `FILES_DONE`, `FILES_TOTAL`, and `COMPLETE`. Print final output labels only when `COMPLETE=1`.

Do not repeat the unchanged source.
