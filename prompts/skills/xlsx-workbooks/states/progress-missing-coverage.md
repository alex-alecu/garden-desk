The last execution produced every requested output label, but it did not prove complete workbook coverage with the three required `VAULT_PROGRESS` progress markers.

Execute corrected source now. Reuse or replace the working calculation, then print `VAULT_PROGRESS_DONE` as the fully processed workbook count, `VAULT_PROGRESS_TOTAL` as the discovered workbook count, and `VAULT_PROGRESS_COMPLETE=1` only when they are equal and every workbook was read.

Do not respond and do not repeat the unchanged source.
