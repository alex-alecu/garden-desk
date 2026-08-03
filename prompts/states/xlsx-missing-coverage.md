The last execution produced every requested output label, but it did not prove complete XLSX coverage with the three required `VAULT_XLSX` progress markers.

Execute corrected source now. Reuse or replace the working calculation, then print `FILES_DONE` as the fully processed XLSX file count, `FILES_TOTAL` as the discovered XLSX file count, and `COMPLETE=1` only when they are equal and every workbook was read.

Do not respond and do not repeat the unchanged source.
