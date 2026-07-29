import type { AgentExecutionResult } from "@vault/shared";

const OBSERVATION_STREAM_TOKENS = 8_000;
const MINIMUM_OBSERVATION_STREAM_CHARACTERS = 2_048;

export const OBSERVATION_STREAM_CHARACTERS = OBSERVATION_STREAM_TOKENS * 4;

/**
 * Each observed stream may use half of the space the prompt has left, so a small
 * context degrades to a shorter excerpt instead of exhausting the window.
 */
export function observationStreamCharacters(usableTokens: number): number {
  const share = Math.floor((Math.max(0, usableTokens) * 4) / 2);
  return Math.max(
    MINIMUM_OBSERVATION_STREAM_CHARACTERS,
    Math.min(OBSERVATION_STREAM_CHARACTERS, share),
  );
}

function elisionNotice(omittedCharacters: number): string {
  return `\n[${omittedCharacters.toLocaleString("en-US")} characters omitted from the middle of this stream. This observation is an excerpt, not the complete output. Write the complete text to a /workspace file and read back the part you need instead of printing it again.]\n`;
}

export function boundedObservationStream(
  text: string,
  maximumCharacters = OBSERVATION_STREAM_CHARACTERS,
): string {
  if (text.length <= maximumCharacters) return text;
  const excerptCharacters = Math.max(0, maximumCharacters - elisionNotice(text.length).length);
  const headCharacters = Math.ceil(excerptCharacters / 2);
  const tailCharacters = excerptCharacters - headCharacters;
  const head = text.slice(0, headCharacters);
  const tail = tailCharacters === 0 ? "" : text.slice(-tailCharacters);
  return `${head}${elisionNotice(text.length - head.length - tail.length)}${tail}`;
}

export function observations(
  executions: AgentExecutionResult[],
  streamCharacters = OBSERVATION_STREAM_CHARACTERS,
) {
  return executions.map((result, index) => ({
    step: index + 1,
    language: result.language,
    path: result.path,
    source: result.source,
    command: result.command,
    exitCode: result.exitCode,
    stdout: boundedObservationStream(result.stdout, streamCharacters),
    stderr: boundedObservationStream(result.stderr, streamCharacters),
    termination: result.termination,
    artifacts: result.artifacts.map((artifact) => artifact.name),
  }));
}
