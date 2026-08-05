export interface WorkProgress {
  complete: boolean;
  done: number;
  total: number;
}

const MARKERS = {
  complete: "VAULT_PROGRESS_COMPLETE",
  done: "VAULT_PROGRESS_DONE",
  total: "VAULT_PROGRESS_TOTAL",
} as const;

function markerValue(stdout: string, marker: string): number | undefined {
  const pattern = new RegExp(`(?:^|\\s)${marker}=([^\\s]+)`, "gu");
  const values = Array.from(stdout.matchAll(pattern), (match) => match[1] ?? "");
  if (values.length === 0) return undefined;
  const value = values.at(-1) ?? "";
  if (!/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseWorkProgress(stdout: string): WorkProgress | undefined {
  const done = markerValue(stdout, MARKERS.done);
  const total = markerValue(stdout, MARKERS.total);
  const complete = markerValue(stdout, MARKERS.complete);
  if (
    done === undefined ||
    total === undefined ||
    complete === undefined ||
    done > total ||
    (complete !== 0 && complete !== 1) ||
    (complete === 1) !== (done === total)
  ) {
    return undefined;
  }
  return { done, total, complete: complete === 1 };
}

export function stripWorkProgress(stdout: string): string {
  const marker = Object.values(MARKERS).join("|");
  const pattern = new RegExp(`(?:^|\\s)(?:${marker})=[^\\s]+(?=\\s|$)`, "gu");
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.replaceAll(pattern, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

export function workProgressAdvanced(previous: WorkProgress, next: WorkProgress): boolean {
  return next.total === previous.total && next.done > previous.done;
}

export function workContinuationMessage(progress: WorkProgress): string {
  return [
    `Processed ${progress.done} of ${progress.total} items.`,
    "The task is stopped at a safe checkpoint and is not finished.",
    "Do you want to continue?",
  ].join("\n\n");
}
