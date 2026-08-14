import type { ChatGenerationResult } from "@vault/shared";
import type { ChatAgentInput, ChatRecoveryState } from "./chat-loop-input.js";
import type { ChatToolState } from "./chat-tool-turn.js";
import { executeToolCalls } from "./chat-tool-turn.js";
import type { GenericToolRegistry } from "./generic-tools.js";

interface GeneratedToolsInput {
  generated: ChatGenerationResult;
  input: ChatAgentInput;
  recovery: ChatRecoveryState;
  registry: GenericToolRegistry;
  state: ChatToolState;
  record(): void;
  recoverContext(promptTokens: number): Promise<void>;
}

export async function executeGeneratedTools(options: GeneratedToolsInput): Promise<void> {
  const { input, state, registry, recovery, generated } = options;
  input.onResponse?.(null);
  options.record();
  const validToolInput = await executeToolCalls(
    {
      registry,
      state,
      ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
    },
    generated.toolCalls,
  );
  if (validToolInput) recovery.emptyResponsePending = false;
  await options.recoverContext(generated.performance.promptTokens);
}
