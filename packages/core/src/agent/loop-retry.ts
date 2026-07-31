import { GEMMA_FUNCTION_CALL_SUFFIX, type GenerationInput } from "../runtime/inference.js";
import { type AgentProgress, type AgentPromptInput, generationInput } from "./prompt.js";

const STRUCTURED_RETRY_INSTRUCTION =
  "\nYour previous attempt returned prose instead of calling a function. Observations below are shorter than the previous attempt; do not restate them.";
const STRUCTURED_RETRY_CONTEXT_TOKENS = 16_384;

/**
 * Inserts the retry instruction ahead of any trailing function-call sentence so the
 * prompt keeps exactly one such instruction as its final line.
 */
function withStructuredRetryInstruction(prompt: string): string {
  return prompt.endsWith(GEMMA_FUNCTION_CALL_SUFFIX)
    ? `${prompt.slice(0, -GEMMA_FUNCTION_CALL_SUFFIX.length)}${STRUCTURED_RETRY_INSTRUCTION}${GEMMA_FUNCTION_CALL_SUFFIX}`
    : `${prompt}${STRUCTURED_RETRY_INSTRUCTION}`;
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
  return { ...base, prompt: withStructuredRetryInstruction(base.prompt) };
}
