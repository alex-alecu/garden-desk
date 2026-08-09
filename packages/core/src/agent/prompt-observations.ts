import type { AgentExecutionResult } from "@vault/shared";
import { defaultPromptLibrary, type PromptLibrary } from "./prompt-library.js";

const OBSERVATION_STREAM_TOKENS = 8_000;
const MINIMUM_OBSERVATION_STREAM_CHARACTERS = 2_048;

export const OBSERVATION_STREAM_CHARACTERS = OBSERVATION_STREAM_TOKENS * 4;

function executionHasUsableEvidence(execution: AgentExecutionResult): boolean {
  return (
    execution.exitCode === 0 &&
    (execution.termination === "completed" || execution.termination === "resource_limit") &&
    execution.stderr.trim().length === 0 &&
    execution.stdout.trim().length > 0
  );
}

export function executionContextCharacters(executions: readonly AgentExecutionResult[]): number {
  return executions.reduce(
    (total, execution) =>
      total +
      (execution.source?.length ?? 0) +
      (execution.command?.length ?? 0) +
      execution.stdout.length +
      execution.stderr.length,
    0,
  );
}

/**
 * All observed streams together may use half of the space the prompt has left, so a
 * small context degrades to shorter excerpts instead of exhausting the window.
 */
export function observationStreamCharacters(usableTokens: number): number {
  const share = Math.floor((Math.max(0, usableTokens) * 4) / 2);
  return Math.max(
    MINIMUM_OBSERVATION_STREAM_CHARACTERS,
    Math.min(OBSERVATION_STREAM_CHARACTERS, share),
  );
}

function elisionNotice(omittedCharacters: number, library: PromptLibrary): string {
  return `\n${library.state("observation-elision", {
    omitted_characters: omittedCharacters.toLocaleString("en-US"),
  })}\n`;
}

export function boundedObservationStream(
  text: string,
  maximumCharacters = OBSERVATION_STREAM_CHARACTERS,
  library: PromptLibrary = defaultPromptLibrary(),
): string {
  if (text.length <= maximumCharacters) return text;
  if (maximumCharacters <= 0) return "";
  const notice = elisionNotice(text.length, library);
  if (notice.length >= maximumCharacters) return notice.slice(0, maximumCharacters);
  const excerptCharacters = maximumCharacters - notice.length;
  const headCharacters = Math.ceil(excerptCharacters / 2);
  const tailCharacters = excerptCharacters - headCharacters;
  const head = text.slice(0, headCharacters);
  const tail = tailCharacters === 0 ? "" : text.slice(-tailCharacters);
  return `${head}${elisionNotice(text.length - head.length - tail.length, library)}${tail}`;
}

export function observations(
  executions: AgentExecutionResult[],
  totalStreamCharacters = OBSERVATION_STREAM_CHARACTERS,
  library: PromptLibrary = defaultPromptLibrary(),
) {
  const mandatoryCharacters = executions.reduce((total, result) => {
    if (executionHasUsableEvidence(result)) return total;
    return total + (result.source?.length ?? 0) + (result.command?.length ?? 0);
  }, 0);
  let remainingCharacters = Math.max(0, totalStreamCharacters - mandatoryCharacters);
  let remainingStreams = executions.reduce((count, result) => {
    const compactableProgram = executionHasUsableEvidence(result)
      ? Number((result.source?.length ?? 0) > 0) + Number((result.command?.length ?? 0) > 0)
      : 0;
    return (
      count +
      compactableProgram +
      Number(result.stdout.length > 0) +
      Number(result.stderr.length > 0)
    );
  }, 0);
  const bounded = (text: string) => {
    if (text.length === 0) return text;
    const share = Math.floor(remainingCharacters / remainingStreams);
    const excerpt = boundedObservationStream(text, share, library);
    remainingCharacters -= excerpt.length;
    remainingStreams -= 1;
    return excerpt;
  };
  return executions.map((result, index) => ({
    step: index + 1,
    language: result.language,
    path: result.path,
    source:
      result.source === null || !executionHasUsableEvidence(result)
        ? result.source
        : bounded(result.source),
    command:
      result.command === null || !executionHasUsableEvidence(result)
        ? result.command
        : bounded(result.command),
    exitCode: result.exitCode,
    stdout: bounded(result.stdout),
    stderr: bounded(result.stderr),
    termination: result.termination,
    artifacts: result.artifacts.map((artifact) => artifact.name),
  }));
}
