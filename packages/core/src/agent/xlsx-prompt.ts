const XLSX_SEARCH_EXAMPLE = [
  'Before importing openpyxl, call warnings.filterwarnings("ignore") so library warnings do not make an otherwise successful execution unverifiable through stderr.',
  "For XLSX files, use openpyxl.load_workbook(path, read_only=True, data_only=True).",
  "Use one rows = sheet.iter_rows(values_only=True) iterator: read the header with next(rows, ()), then continue that same iterator for data rows.",
  "Iterate worksheets as for sheet in workbook.worksheets; workbook.worksheets yields worksheet objects, not name-and-sheet pairs.",
  "Process the data rows inside every worksheet; never break or return from the worksheet loop after reading its header.",
  "Close each workbook in a finally block before opening another workbook.",
].join("\n");

export const XLSX_EXECUTION_INSTRUCTIONS = [
  "Search XLSX text as a case-insensitive substring in every nonempty cell, not as equality or in an assumed column; use discovered headers for named columns.",
  'Discover workbook filenames case-insensitively, for example with path.suffix.lower() == ".xlsx"; never assume the filesystem uses a lowercase extension.',
  "With os.walk, keep the workbook accumulator distinct from the current filenames variable; never append to the filenames list while iterating it.",
  "Unless the user explicitly requested other formats, process only XLSX workbooks; an earlier broad discovery command does not expand the task.",
  XLSX_SEARCH_EXAMPLE,
  "Choose the simplest bounded strategy that fits the task. You may inspect, aggregate in one pass, batch files, or replace a failed approach with different code.",
  "A program may discover and finish a small corpus in one short pass without checkpointing. Use resumable batching only when the discovered work may not fit comfortably inside the 75-second work window.",
  "Sort relative workbook paths deterministically. When the complete scan may exceed one execution, atomically checkpoint the corpus path list, completed file paths, next work item, and every cumulative result under /workspace.",
  "For mixed-format tasks, keep every requested format branch reachable. When checkpointing is needed, include every format's completed paths and cumulative results so resumed executions never double count it. python-docx Document objects have no close() method.",
  "Restore cumulative values from the checkpoint at process start. Measure the 75-second work window from a new monotonic timer on every execution; never persist or reuse an old start time.",
  "Compute FILES_DONE from the complete restored set of completed workbook paths, never from only the files processed in the current execution. Persist the final completed-path set before printing progress markers.",
  "Stop starting new workbook work after about 75 seconds so the program exits normally before the 120-second limit. Never advance the cursor or mark a workbook complete after any parse error; print the error to stderr and exit nonzero so the model can repair or change strategy.",
  "At the end of every successful XLSX execution print exactly VAULT_XLSX_FILES_DONE=<integer>, VAULT_XLSX_FILES_TOTAL=<integer>, and VAULT_XLSX_COMPLETE=<0-or-1>. DONE and TOTAL count XLSX workbooks only, even for a mixed-format task. Set COMPLETE=1 only when DONE equals TOTAL and the complete XLSX corpus was read.",
  "Print each progress marker on its own line with a normal print call and no end= argument. DONE is the numeric count of fully completed files. COMPLETE must be the integer 0 or 1, never True, False, or a comparison expression.",
  "Print requested final output labels only with COMPLETE=1. Intermediate cumulative values belong in the checkpoint, not in final-label stdout.",
] as const;

export const XLSX_WORK_PHASE = [
  "Current required phase: perform bounded XLSX work.",
  "Name the selected strategy in the summary before generating at most 160 complete source lines. Use any correct strategy that preserves the streaming, checkpoint, progress, and coverage requirements.",
] as const;

export const XLSX_REPAIR_PHASE = [
  "Current required phase: recover from an incomplete XLSX execution.",
  "Repair the recorded program or replace it with a different bounded strategy. Do not repeat an unbounded full-corpus scan after a timeout.",
] as const;

export const XLSX_CONTINUE_PHASE = [
  "Current required phase: continue verified XLSX progress.",
  "Resume the saved checkpoint with the same program or choose another compatible bounded strategy. Preserve cumulative results and do not rescan completed files.",
] as const;
