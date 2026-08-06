import { type DurableAgentHistory, executionSucceeded } from "./history.js";
import type { PromptLibrary } from "./prompt-library.js";

export function attachmentFiles(inputNames: string[]) {
  return inputNames.map((name, index) => ({
    name,
    path: `/run/attachments/${String(index + 1).padStart(2, "0")}-${name}`,
  }));
}

/**
 * True when earlier runs in this session already read every attachment, so the
 * next turn is free to answer from durable history instead of extracting the file again.
 */
export function attachmentsAlreadyRead(
  inputNames: string[],
  history: DurableAgentHistory | undefined,
): boolean {
  const paths = attachmentFiles(inputNames).map((file) => file.path);
  if (paths.length === 0 || history === undefined) return false;
  return paths.every((path) =>
    history.runs.some((run) =>
      run.events.some(
        (event) =>
          event.type === "execution.completed" &&
          executionSucceeded(event) &&
          (event.source ?? "").includes(path),
      ),
    ),
  );
}

export function selectedInputInstructions(
  inputNames: string[],
  library: PromptLibrary,
): readonly string[] {
  const files = attachmentFiles(inputNames);
  return files.length === 0 ? [] : [library.state("selected-inputs")];
}

export function continuationInstructions(
  continuation: boolean | undefined,
  library: PromptLibrary,
): readonly string[] {
  return continuation === true ? [library.state("continuation")] : [];
}
