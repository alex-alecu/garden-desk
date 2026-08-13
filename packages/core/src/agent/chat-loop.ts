import { randomUUID } from "node:crypto";
import {
  type AgentExecutionResult,
  type AgentInferenceOutcome,
  type AgentRunResult,
  AgentRunResultSchema,
  type ChatGenerationResult,
  type ChatMessage,
  JobIdSchema,
} from "@vault/shared";
import type { InferenceService } from "../runtime/inference.js";
import { artifactCandidateNames } from "./artifact-results.js";
import { compactChatHistory } from "./chat-compaction.js";
import { initialChatMessages } from "./chat-initial-messages.js";
import type { ChatAgentInput, ChatRecoveryState } from "./chat-loop-input.js";
import { containsRawProtocolCall } from "./chat-protocol.js";
import {
  type ChatToolState,
  executeToolCalls,
  initialToolState,
  rollbackFailedDirection,
} from "./chat-tool-turn.js";
import { GenericToolRegistry } from "./generic-tools.js";
import { addPerformance, emptyPerformance } from "./inference-performance.js";

export type { ChatAgentInput } from "./chat-loop-input.js";

const HARD_TURN_LIMIT = 40;
const COMPACTION_RATIO = 0.8;
const CHAT_OUTPUT_TOKENS = 2_048;
const MAX_CHAT_OUTPUT_TOKENS = 8_192;
function currentArtifacts(executions: readonly AgentExecutionResult[]): string[] {
  return artifactCandidateNames(executions).filter(
    (path) => !path.startsWith(".vault-tools/") && !path.startsWith(".vault-output/"),
  );
}
function outputTokens(
  contextTokens: number,
  tools: readonly unknown[],
  phase: "chat" | "compaction",
) {
  if (phase === "compaction") return CHAT_OUTPUT_TOKENS;
  const scaled = Math.max(CHAT_OUTPUT_TOKENS, Math.floor(contextTokens / 8));
  const dynamic = Math.min(MAX_CHAT_OUTPUT_TOKENS, scaled);
  return tools.length === 0 ? Math.max(4_096, dynamic) : dynamic;
}
export class ChatAgentLoop {
  private contextTokens: number;
  private requestedContextSize: number | "auto";
  constructor(private readonly inference: Pick<InferenceService, "chat">) {
    this.contextTokens = 8_192;
    this.requestedContextSize = "auto";
  }
  private record(
    input: ChatAgentInput,
    turnId: string | undefined,
    outcome: AgentInferenceOutcome,
  ): void {
    if (turnId !== undefined) input.trace?.store.recordOutcome(turnId, outcome);
  }
  private async generate(
    input: ChatAgentInput,
    messages: ChatMessage[],
    tools: ReturnType<GenericToolRegistry["definitions"]>,
    phase: "chat" | "compaction",
  ): Promise<{ result: ChatGenerationResult; turnId?: string }> {
    const identity = {
      requestId: randomUUID(),
      jobId: JobIdSchema.parse(randomUUID()),
      ...(input.inferencePriority === undefined ? {} : { priority: input.inferencePriority }),
    };
    const request = {
      modelId: input.modelId,
      messages,
      tools,
      contextSize: this.requestedContextSize,
      maxTokens: outputTokens(this.contextTokens, tools, phase),
      temperature: phase === "compaction" ? 0 : input.agent.temperature,
    } as const;
    const turnId = await input.trace?.store.begin(input.trace.runId, phase, {
      input: request,
      ...identity,
    });
    let thinking = "";
    try {
      const result = await this.inference.chat(
        request,
        input.signal,
        (delta) => {
          thinking = `${thinking}${delta}`.slice(-64_000);
          input.onThinking?.(thinking);
        },
        identity,
      );
      await input.trace?.store.captureResponse(
        turnId as string,
        { text: result.text, toolCalls: result.toolCalls, stopReason: result.stopReason },
        result.memory.contextSizeTokens,
      );
      this.contextTokens = result.memory.contextSizeTokens ?? this.contextTokens;
      input.onContext?.(result.performance.promptTokens, this.contextTokens);
      return { result, ...(turnId === undefined ? {} : { turnId }) };
    } catch (error) {
      this.record(input, turnId, input.signal?.aborted ? "cancelled" : "inference_failed");
      throw error;
    } finally {
      input.onThinking?.(null);
    }
  }

  private async compact(
    input: ChatAgentInput,
    messages: ChatMessage[],
    keepTurns: number,
    performance: ReturnType<typeof emptyPerformance>,
  ): Promise<ChatMessage[]> {
    const compacted = await compactChatHistory(
      messages,
      input.systemPrompt("session-summary"),
      async (prompt) => {
        input.onEvent?.("inference.started", "Condensing the working context.");
        const generated = await this.generate(
          input,
          [
            {
              role: "system",
              text: "Summarize only the supplied local conversation for continuation.",
            },
            { role: "user", text: prompt },
          ],
          [],
          "compaction",
        );
        addPerformance(performance, generated.result.performance);
        this.record(input, generated.turnId, "accepted_compaction");
        return generated.result.text;
      },
      keepTurns,
    );
    return compacted.messages;
  }

  private finish(
    input: ChatAgentInput,
    generated: { result: ChatGenerationResult; turnId?: string },
    state: ChatToolState,
    options: {
      recovery: ChatRecoveryState;
      performance: ReturnType<typeof emptyPerformance>;
      finalTurn: boolean;
    },
  ): AgentRunResult | undefined {
    const { recovery, performance, finalTurn } = options;
    if (generated.result.toolCalls.length > 0) return undefined;
    const response = generated.result.text.trim();
    if (response.length === 0) {
      this.record(input, generated.turnId, "invalid_response");
      if (recovery.emptyResponsePending || finalTurn) throw new Error("agent_empty_response");
      recovery.emptyResponsePending = true;
      state.messages.pop();
      state.messages.push({
        role: "system",
        text: "The previous answer was empty and was rejected. Return the completed result using the retained execution evidence.",
      });
      return undefined;
    }
    if (containsRawProtocolCall(response)) {
      this.record(input, generated.turnId, "rejected_unbacked_response");
      state.responseOnly = false;
      state.messages.pop();
      state.messages.push({
        role: "system",
        text: "The previous output contained raw function-call protocol text and was rejected. Use an available tool through a real function call, or return a plain final answer without protocol markers.",
      });
      return undefined;
    }
    this.record(input, generated.turnId, "accepted_response");
    input.onEvent?.("assistant.completed", "Response completed.");
    return AgentRunResultSchema.parse({
      response,
      artifacts: currentArtifacts(state.executions),
      executions: state.executions,
      inference: performance,
    });
  }

  private async recoverContext(
    input: ChatAgentInput,
    state: ChatToolState,
    performance: ReturnType<typeof emptyPerformance>,
    promptTokens: number,
  ): Promise<void> {
    if (state.failedTools >= 3) {
      rollbackFailedDirection(state);
      input.onEvent?.("inference.started", "Backtracking to the last working step.");
      return;
    }
    if (state.failedTools === 0) state.checkpoint = state.messages.length;
    if (promptTokens >= this.contextTokens * COMPACTION_RATIO) {
      state.messages = await this.compact(input, state.messages, 2, performance);
      state.checkpoint = state.messages.length;
    }
  }

  private async generateWithRecovery(
    input: ChatAgentInput,
    state: ChatToolState,
    tools: ReturnType<GenericToolRegistry["definitions"]>,
    performance: ReturnType<typeof emptyPerformance>,
  ) {
    try {
      return await this.generate(input, state.messages, tools, "chat");
    } catch (error) {
      if (state.messages.length < 4) throw error;
      state.messages = await this.compact(input, state.messages, 2, performance);
      state.checkpoint = state.messages.length;
      state.failedTools = 0;
      return await this.generate(input, state.messages, tools, "chat");
    }
  }
  private async turn(options: {
    input: ChatAgentInput;
    state: ChatToolState;
    registry: GenericToolRegistry;
    recovery: ChatRecoveryState;
    performance: ReturnType<typeof emptyPerformance>;
    finalTurn: boolean;
  }): Promise<AgentRunResult | undefined> {
    const { input, state, registry, recovery, performance, finalTurn } = options;
    const tools = finalTurn || state.responseOnly ? [] : registry.definitions(input.agent.tools);
    const generated = await this.generateWithRecovery(input, state, tools, performance);
    addPerformance(performance, generated.result.performance);
    state.messages.push({
      role: "assistant",
      text: generated.result.text,
      toolCalls: generated.result.toolCalls,
    });
    if (generated.result.stopReason === "maxTokens" && generated.result.toolCalls.length === 0) {
      this.record(input, generated.turnId, "invalid_response");
      state.messages.pop();
      state.messages = await this.compact(input, state.messages, 1, performance);
      state.checkpoint = state.messages.length;
      state.messages.push({
        role: "system",
        text: "The previous answer hit its output limit and was discarded. Return the complete answer once, using the retained evidence, without preamble or omitted rows.",
      });
      state.responseOnly = true;
      return undefined;
    }
    const result = this.finish(input, generated, state, { recovery, performance, finalTurn });
    if (result !== undefined) return result;
    if (generated.result.toolCalls.length === 0) return undefined;
    this.record(input, generated.turnId, "accepted_tool_calls");
    const validToolInput = await executeToolCalls(
      {
        registry,
        state,
        ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
      },
      generated.result.toolCalls,
    );
    if (validToolInput) recovery.emptyResponsePending = false;
    await this.recoverContext(input, state, performance, generated.result.performance.promptTokens);
    return undefined;
  }
  async run(input: ChatAgentInput): Promise<AgentRunResult> {
    this.requestedContextSize = input.contextTokens;
    this.contextTokens =
      input.contextTokens === "auto" ? 8_192 : Math.max(8_192, input.contextTokens);
    const registry = new GenericToolRegistry({
      executor: input.executor,
      skills: input.skills,
      ...(input.spawnTask === undefined ? {} : { spawnTask: input.spawnTask }),
      ...(input.askQuestion === undefined ? {} : { askQuestion: input.askQuestion }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const performance = emptyPerformance();
    const state = initialToolState(initialChatMessages(input));
    const recovery: ChatRecoveryState = { emptyResponsePending: false };
    const turns = Math.min(HARD_TURN_LIMIT, input.agent.steps);
    for (let turn = 0; turn < turns; turn += 1) {
      input.signal?.throwIfAborted();
      input.onEvent?.(
        "inference.started",
        turn === 0 ? "Understanding the task." : "Choosing the next action.",
      );
      const result = await this.turn({
        input,
        state,
        registry,
        recovery,
        performance,
        finalTurn: turn === turns - 1,
      });
      if (result !== undefined) return result;
    }
    throw new Error("agent_turn_limit_exceeded");
  }
}
