import type { GenerationInput } from "../runtime/inference.js";
import { type AgentProgress, type AgentPromptInput, generationInput } from "./prompt.js";
import { defaultPromptLibrary } from "./prompt-library.js";

const STRUCTURED_RETRY_CONTEXT_TOKENS = 16_384;

/**
 * Inserts the retry instruction ahead of any trailing function-call sentence so the
 * prompt keeps exactly one such instruction as its final line.
 */
function withStructuredRetryInstruction(
  prompt: string,
  instruction: string,
  functionCallSuffix: string,
): string {
  return prompt.endsWith(functionCallSuffix)
    ? `${prompt.slice(0, -functionCallSuffix.length)}\n${instruction}${functionCallSuffix}`
    : `${prompt}\n${instruction}`;
}

interface StructuredRetry {
  input: AgentPromptInput;
  progress: AgentProgress;
  finalResponse: boolean;
  previous: GenerationInput;
  contextTokens: number;
}

/**
 * Rebuilds a missing-function-call retry against a smaller context so oversized
 * observations shrink instead of being resent verbatim. When the rebuild is not smaller
 * the original request is reused unchanged apart from the added instruction, so prompt
 * and token budget always stay paired. The schema still permits a response action, which
 * is what lets the worker salvage bounded plain text.
 */
export function structuredRetryInput(retry: StructuredRetry): GenerationInput {
  let rebuilt: GenerationInput;
  try {
    rebuilt = generationInput(retry.input, retry.progress, retry.finalResponse, {
      contextTokens: Math.min(STRUCTURED_RETRY_CONTEXT_TOKENS, retry.contextTokens),
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "agent_context_exhausted") throw error;
    rebuilt = retry.previous;
  }
  const base = rebuilt.prompt.length < retry.previous.prompt.length ? rebuilt : retry.previous;
  const library = retry.input.promptLibrary ?? defaultPromptLibrary();
  const functionCallSuffix = `\n${library.system("function-call")}`;
  return {
    ...base,
    prompt: withStructuredRetryInstruction(
      base.prompt,
      library.recovery("structured-call"),
      functionCallSuffix,
    ),
  };
}
