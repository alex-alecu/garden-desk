The proposed workbook program was rejected before execution because its coverage markers were missing or malformed.

Submit one fresh complete program of at most 80 short lines. After every corpus loop, print each marker exactly once as `VAULT_PROGRESS_DONE={done}`, `VAULT_PROGRESS_TOTAL={total}`, and `VAULT_PROGRESS_COMPLETE={1 if done == total else 0}`. DONE is the number of fully processed workbooks, not a constant or result-row count. Do not run a separate verification step while coverage is incomplete.
