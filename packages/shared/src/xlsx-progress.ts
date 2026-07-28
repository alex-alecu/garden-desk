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
const MARKER_PREFIX = "VAULT_XLSX_";

function normalizeMarkerAdjacency(stdout: string): string {
  const marker = Object.values(MARKERS).join("|");
  return stdout.replace(new RegExp(`((?:${marker})=\\d+)(?=${MARKER_PREFIX})`, "gu"), "$1 ");
}

function markerValue(stdout: string, marker: string): number | undefined {
  const pattern = new RegExp(`(?:^|\\s)${marker}=(\\d+)(?=\\s|$)`, "gu");
  const values = Array.from(stdout.matchAll(pattern), (match) => match[1] ?? "");
  if (values.length === 0) return undefined;
  const value = values.at(-1) ?? "";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseXlsxProgress(stdout: string): XlsxProgress | undefined {
  const evidence = normalizeMarkerAdjacency(stdout);
  const filesDone = markerValue(evidence, MARKERS.filesDone);
  const filesTotal = markerValue(evidence, MARKERS.filesTotal);
  const complete = markerValue(evidence, MARKERS.complete);
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
  const marker = Object.values(MARKERS).join("|");
  const pattern = new RegExp(`(?:^|\\s)(?:${marker})=\\d+(?=\\s|$)`, "gu");
  return normalizeMarkerAdjacency(stdout)
    .split(/\r?\n/u)
    .map((line) => line.replaceAll(pattern, " ").trim())
    .filter((line) => line.length > 0)
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
