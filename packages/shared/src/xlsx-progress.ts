export interface XlsxProgress {
  complete: boolean;
  filesDone: number;
  filesTotal: number;
}

const MARKERS = {
  complete: "VAULT_XLSX_COMPLETE",
  filesDone: "VAULT_XLSX_FILES_DONE",
  filesTotal: "VAULT_XLSX_FILES_TOTAL",
} as const;

function markerValue(lines: string[], marker: string): number | undefined {
  const prefix = `${marker}=`;
  const values = lines.filter((line) => line.startsWith(prefix));
  if (values.length === 0) return undefined;
  const value = values.at(-1)?.slice(prefix.length) ?? "";
  if (!/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseXlsxProgress(stdout: string): XlsxProgress | undefined {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim());
  const filesDone = markerValue(lines, MARKERS.filesDone);
  const filesTotal = markerValue(lines, MARKERS.filesTotal);
  const complete = markerValue(lines, MARKERS.complete);
  if (
    filesDone === undefined ||
    filesTotal === undefined ||
    complete === undefined ||
    filesDone > filesTotal ||
    (complete !== 0 && complete !== 1) ||
    (complete === 1) !== (filesDone === filesTotal)
  ) {
    return undefined;
  }
  return { filesDone, filesTotal, complete: complete === 1 };
}

export function stripXlsxProgress(stdout: string): string {
  const prefixes = Object.values(MARKERS).map((marker) => `${marker}=`);
  return stdout
    .split(/\r?\n/u)
    .filter((line) => !prefixes.some((prefix) => line.trim().startsWith(prefix)))
    .join("\n")
    .trim();
}

export function xlsxProgressAdvanced(previous: XlsxProgress, next: XlsxProgress): boolean {
  return next.filesTotal === previous.filesTotal && next.filesDone > previous.filesDone;
}

export function xlsxContinuationMessage(progress: XlsxProgress): string {
  return [
    `Processed ${progress.filesDone} of ${progress.filesTotal} XLSX files.`,
    "The task is stopped at a safe checkpoint and is not finished.",
    "Do you want to continue?",
  ].join("\n\n");
}
