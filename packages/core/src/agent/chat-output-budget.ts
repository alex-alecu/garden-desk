const COMPACTION_OUTPUT_TOKENS = 2_048;
const MAX_CHAT_OUTPUT_TOKENS = 16_384;
const MINIMUM_PROMPT_RESERVE = 4_096;

export function chatOutputTokens(contextTokens: number, compacting: boolean): number {
  if (compacting) return COMPACTION_OUTPUT_TOKENS;
  return Math.min(MAX_CHAT_OUTPUT_TOKENS, Math.max(1, contextTokens - MINIMUM_PROMPT_RESERVE));
}
