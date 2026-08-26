import { randomUUID } from "node:crypto";
import {
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
import { withCurrentTimeContext } from "./chat-current-time.js";
import { executeGeneratedTools } from "./chat-generated-tools.js";
import { generateWithInferenceRecovery } from "./chat-inference-recovery.js";
import { initialChatMessages } from "./chat-initial-messages.js";
import type { ChatAgentInput, ChatRecoveryState, ChatTurnOptions } from "./chat-loop-input.js";
import { createToolRegistry } from "./chat-loop-registry.js";
import { chatOutputTokens } from "./chat-output-budget.js";
import { recoverOutputLimit } from "./chat-output-recovery.js";
import { containsRawProtocolCall, visibleResponseText } from "./chat-protocol.js";
import { liveLoadedSkillNames } from "./chat-skill-state.js";
import { streamCallbacks } from "./chat-streaming.js";
import { type ChatToolState, initialToolState } from "./chat-tool-turn.js";
import type { GenericToolRegistry } from "./generic-tools.js";
import { addPerformance, emptyPerformance } from "./inference-performance.js";

export type { ChatAgentInput } from "./chat-loop-input.js";

const HARD_TURN_LIMIT = 40;
const COMPACTION_RATIO = 0.8;

function inferenceStepSummary(turn: number, modelNeedsLoad: boolean | undefined): string {
  if (turn > 0) return "Choosing the next action.";
  return modelNeedsLoad ? "Loading the local model into memory." : "Understanding the task.";
}
export class ChatAgentLoop {
  private contextTokens = 8_192;
  private requestedContextSize: number | "auto" = "auto";
  constructor(private readonly inference: Pick<InferenceService, "chat">) {}
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
      messages: withCurrentTimeContext(messages),
      tools,
      contextSize: this.requestedContextSize,
      maxTokens: chatOutputTokens(this.contextTokens, phase === "compaction"),
      temperature: phase === "compaction" ? 0 : input.agent.temperature,
    } as const;
    const turnId = await input.trace?.store.begin(input.trace.runId, phase, {
      input: request,
      ...identity,
    });
    try {
      const result = await this.inference.chat(
        request,
        input.signal,
        streamCallbacks(input, phase),
        identity,
      );
      await input.trace?.store.captureResponse(
        turnId as string,
        { text: result.text, toolCalls: result.toolCalls, stopReason: result.stopReason },
        result.memory.contextSizeTokens,
      );
      this.contextTokens = result.memory.contextSizeTokens ?? this.contextTokens;
      input.onContext?.(
        result.performance.promptTokens,
        this.contextTokens,
        result.memory.contextSizeTokens !== undefined,
      );
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
    state: ChatToolState,
    keepTurns: number,
    performance: ReturnType<typeof emptyPerformance>,
  ): Promise<ChatMessage[]> {
    const compacted = await compactChatHistory(
      state.messages,
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
      {
        assistantTurns: keepTurns,
        workspaceState: {
          scriptPaths: state.scriptPaths,
          ...(state.lastExecutionFailure === undefined
            ? {}
            : { lastExecutionFailure: state.lastExecutionFailure }),
        },
      },
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
    const response = visibleResponseText(generated.result.text).trim();
    if (response.length === 0) {
      input.onResponse?.(null);
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
      input.onResponse?.(null);
      this.record(input, generated.turnId, "rejected_unbacked_response");
      state.messages.pop();
      state.messages.push({
        role: "system",
        text: "The previous output contained raw function-call protocol text and was rejected. Use an available tool through a real function call, or return a plain final answer without protocol markers.",
      });
      return undefined;
    }
    this.record(input, generated.turnId, "accepted_response");
    input.onResponse?.(response);
    input.onEvent?.("assistant.completed", "Response completed.");
    return AgentRunResultSchema.parse({
      response,
      artifacts: artifactCandidateNames(state.artifactExecutions),
      executions: state.executions,
      guestExecutions: state.guestBudget.started,
      inference: performance,
    });
  }
  private async recoverContext(
    input: ChatAgentInput,
    state: ChatToolState,
    performance: ReturnType<typeof emptyPerformance>,
    promptTokens: number,
  ): Promise<void> {
    if (promptTokens >= this.contextTokens * COMPACTION_RATIO) {
      state.messages = await this.compact(input, state, 2, performance);
    }
  }
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: generation, tool execution, and recovery are one ordered model turn.
  private async turn(options: ChatTurnOptions): Promise<AgentRunResult | undefined> {
    const { input, state, registry, recovery, performance, finalTurn } = options;
    const tools = () =>
      registry.definitions(
        input.agent.tools,
        liveLoadedSkillNames(state.loadedSkills, state.messages),
      );
    const generated = await generateWithInferenceRecovery({
      generate: async () => await this.generate(input, state.messages, tools(), "chat"),
      recover: async () => {
        if (state.messages.length < 4) return;
        state.messages = await this.compact(input, state, 2, performance);
      },
      recovery,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      onRetry: () => input.onEvent?.("inference.started", "Retrying the local model once."),
    });
    addPerformance(performance, generated.result.performance);
    state.messages.push({
      role: "assistant",
      text: generated.result.text,
      toolCalls: generated.result.toolCalls,
    });
    const recovered = await recoverOutputLimit({
      compact: async () => await this.compact(input, state, 2, performance),
      contextTokens: this.contextTokens,
      finalTurn,
      record: () => this.record(input, generated.turnId, "invalid_response"),
      recovery,
      result: generated.result,
      state,
    });
    if (recovered) {
      input.onResponse?.(null);
      return undefined;
    }
    const result = this.finish(input, generated, state, { recovery, performance, finalTurn });
    if (result !== undefined) return result;
    if (generated.result.toolCalls.length === 0) return undefined;
    await executeGeneratedTools({
      input,
      state,
      registry,
      recovery,
      generated: generated.result,
      record: () => this.record(input, generated.turnId, "accepted_tool_calls"),
      recoverContext: async (promptTokens) =>
        await this.recoverContext(input, state, performance, promptTokens),
    });
    return undefined;
  }
  async run(input: ChatAgentInput): Promise<AgentRunResult> {
    this.requestedContextSize = input.contextTokens;
    this.contextTokens =
      input.knownContextTokens ??
      (input.contextTokens === "auto" ? 8_192 : Math.max(8_192, input.contextTokens));
    const registry = createToolRegistry(input);
    const performance = emptyPerformance();
    const state = initialToolState(initialChatMessages(input));
    const recovery: ChatRecoveryState = {
      emptyResponsePending: false,
      inferenceRetryUsed: false,
      outputLimitRetryUsed: false,
    };
    const turns = Math.min(HARD_TURN_LIMIT, input.agent.steps);
    for (let turn = 0; turn < turns; turn += 1) {
      input.signal?.throwIfAborted();
      input.onEvent?.("inference.started", inferenceStepSummary(turn, input.modelNeedsLoad));
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
