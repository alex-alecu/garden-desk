import type { AgentExecutionResult, ChatGenerationResult } from "@vault/shared";
import type { InferenceService } from "../runtime/inference.js";
import type { AgentExecutor } from "./agent-executor.js";
import type { ChatAgentInput } from "./chat-loop.js";

const performance = (promptTokens = 1) => ({
  promptTokens,
  outputTokens: 1,
  promptDurationMs: 1,
  generationDurationMs: 1,
  totalDurationMs: 2,
});

export function generated(
  text: string,
  toolCalls: ChatGenerationResult["toolCalls"] = [],
  promptTokens = 1,
): ChatGenerationResult {
  return {
    protocolVersion: 1,
    requestId: "chat-loop-test",
    status: "ok",
    operation: "chat",
    text,
    toolCalls,
    stopReason: toolCalls.length === 0 ? "text" : "toolCalls",
    memory: {
      cpuRamBytes: 1,
      gpuVramBytes: 1,
      budgetBytes: 1,
      detectedGpuVramBytes: 1,
      contextSizeTokens: 8_192,
    },
    performance: performance(promptTokens),
  };
}

export function execution(source: string, stderr = "", exitCode = 0): AgentExecutionResult {
  return {
    language: "python",
    path: ".vault-tools/test.py",
    source,
    command: null,
    exitCode,
    stdout: exitCode === 0 ? "done\n" : "",
    stderr,
    durationMs: 1,
    termination: "completed",
    artifacts: [],
  };
}

export function model(
  results: ChatGenerationResult[],
  requests: Parameters<InferenceService["chat"]>[0][],
): Pick<InferenceService, "chat"> {
  return {
    async chat(input) {
      requests.push(structuredClone(input));
      const result = results.shift();
      if (result === undefined) throw new Error("Missing chat result.");
      return result;
    },
  };
}

export function input(
  executor: AgentExecutor,
  tools: string[],
  extra: Partial<ChatAgentInput> = {},
): ChatAgentInput {
  return {
    agent: {
      name: "general",
      description: "Test agent",
      mode: "primary",
      body: "Work carefully.",
      steps: 12,
      temperature: 0,
      tools,
    },
    contextTokens: 8_192,
    executor,
    modelId: "test-model",
    skills: { metadata: () => [], read: () => "" },
    systemPrompt: () => "Keep durable facts only.",
    task: "Complete the task.",
    ...extra,
  };
}

export function tool(name: string, id: string, params: unknown) {
  return { id, name, params };
}

export function source(run: Parameters<AgentExecutor["execute"]>[0]): string {
  return run.language === "shell" ? run.command : run.source;
}
