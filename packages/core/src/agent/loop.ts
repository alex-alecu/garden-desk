import type {
  AgentDecision,
  AgentEventDetail,
  AgentEventType,
  AgentExecutionResult,
  AgentRunResult,
  StructuredGenerationResult,
} from "@vault/shared";
import type { AgentSessionExecution } from "@vault/workers";
import type { InferenceService } from "../runtime/inference.js";
import { createGenerationRequest } from "../runtime/inference.js";
import { addPerformance } from "./inference-performance.js";
import { finishRun, recordOutcome } from "./loop-outcomes.js";
import { structuredRetryInput } from "./loop-retry.js";
import { activateRequestedSkills, executeTurn, newProgress } from "./loop-turn.js";
import { progressContinuationResponse } from "./output-contract.js";
import {
  type AgentProgress,
  type AgentPromptInput,
  type GenerationRecovery,
  generationInput,
  MAX_EXECUTIONS,
  parseDecision,
} from "./prompt.js";
import { defaultPromptLibrary } from "./prompt-library.js";
import { progressEnabled } from "./prompt-progress.js";
import type { AgentTraceStore } from "./trace-store.js";

const MAX_DECISIONS = 12;
const GENERATION_LIMIT_ERROR = "generation_token_limit";

export interface AgentExecutor {
  execute(input: AgentSessionExecution, signal?: AbortSignal): Promise<AgentExecutionResult>;
}

export interface AgentRunInput extends AgentPromptInput {
  onEvent?(type: AgentEventType, summary: string, detail?: Partial<AgentEventDetail>): void;
  onThinking?(text: string | null): void;
  signal?: AbortSignal;
  trace?: { runId: string; store: AgentTraceStore };
}

export interface TracedDecision {
  decision: AgentDecision;
  turnId?: string;
}
type PreparedGeneration = ReturnType<typeof createGenerationRequest>;
interface GenerationRecoveryTurn {
  input: AgentRunInput;
  progress: AgentProgress;
  finalResponse: boolean;
  initialRequest: PreparedGeneration;
  recovery: Exclude<ReturnType<typeof generationRecovery>, undefined>;
}

function generationRecovery(error: unknown): GenerationRecovery | "structured_call" {
  if (!(error instanceof Error)) return undefined;
  if (error.message === "structured_tool_call_required") return "structured_call";
  return error.message === GENERATION_LIMIT_ERROR ? "generation_limit" : undefined;
}

export class AgentLoop {
  private contextTokens: number;
  constructor(
    private readonly inference: Pick<InferenceService, "generate">,
    private readonly executor: AgentExecutor,
    contextTokens = 8_192,
  ) {
    this.contextTokens = Math.max(8_192, contextTokens);
  }

  private async generateDecision(
    input: AgentRunInput,
    progress: AgentProgress,
    finalResponse: boolean,
    initialRequest: PreparedGeneration,
  ): Promise<{ generated: StructuredGenerationResult; turnId: string | undefined }> {
    try {
      return await this.generateTurn(input, finalResponse, initialRequest);
    } catch (error) {
      const recovery = generationRecovery(error);
      if (recovery === undefined) throw error;
      return this.generateRecoveryTurn({
        input,
        progress,
        finalResponse,
        initialRequest,
        recovery,
      });
    }
  }

  private async generateRecoveryTurn(
    turn: GenerationRecoveryTurn,
  ): Promise<{ generated: StructuredGenerationResult; turnId: string | undefined }> {
    const { input, progress, finalResponse, initialRequest, recovery } = turn;
    if (recovery === "generation_limit") {
      input.onEvent?.(
        "inference.started",
        "The local model reached its 32K generation limit. Continuing with a smaller workspace edit.",
      );
    }
    const request =
      recovery === "structured_call"
        ? createGenerationRequest(
            structuredRetryInput({
              input,
              progress,
              finalResponse,
              previous: initialRequest.input,
              contextTokens: this.contextTokens,
            }),
          )
        : createGenerationRequest(
            generationInput(input, progress, finalResponse, {
              contextTokens: this.contextTokens,
              recovery: "generation_limit",
            }),
          );
    try {
      return await this.generateTurn(input, finalResponse, request);
    } catch (error) {
      if (generationRecovery(error) === "generation_limit") {
        throw new Error("agent_generation_limit");
      }
      throw error;
    }
  }

  private async generateTurn(
    input: AgentRunInput,
    finalResponse: boolean,
    request: PreparedGeneration,
  ): Promise<{ generated: StructuredGenerationResult; turnId: string | undefined }> {
    const turnId = await input.trace?.store.begin(
      input.trace.runId,
      finalResponse ? "final_response" : "decision",
      { input: request.input, ...request.identity },
    );
    return { generated: await this.generate(input, request, turnId), turnId };
  }

  private async decide(
    input: AgentRunInput,
    progress: AgentProgress,
    finalResponse = false,
    revising = false,
  ): Promise<TracedDecision> {
    const { executions, inference } = progress;
    input.onEvent?.(
      "inference.started",
      finalResponse
        ? "Preparing the final response."
        : revising
          ? `Revising the plan for step ${executions.length + 1}.`
          : executions.length === 0
            ? "Loading the local model and planning the task."
            : `Planning step ${executions.length + 1}.`,
    );
    input.onThinking?.(null);
    const request = createGenerationRequest(
      generationInput(input, progress, finalResponse, { contextTokens: this.contextTokens }),
    );
    const { generated, turnId } = await this.generateDecision(
      input,
      progress,
      finalResponse,
      request,
    );
    if (turnId !== undefined) {
      await input.trace?.store.captureResponse(
        turnId,
        generated.value,
        generated.memory.contextSizeTokens,
      );
    }
    addPerformance(inference, generated.performance);
    this.contextTokens = generated.memory.contextSizeTokens ?? this.contextTokens;
    input.onThinking?.(null);
    return this.parseTracedDecision(input, generated.value, turnId);
  }

  private async generate(
    input: AgentRunInput,
    request: PreparedGeneration,
    turnId: string | undefined,
  ): Promise<StructuredGenerationResult> {
    let thinking = "";
    try {
      return await this.inference.generate(
        request.input,
        input.signal,
        (delta) => {
          thinking = `${thinking}${delta}`.slice(-64_000);
          input.onThinking?.(thinking);
        },
        request.identity,
      );
    } catch (error) {
      recordOutcome(input, turnId, input.signal?.aborted ? "cancelled" : "inference_failed");
      throw error;
    }
  }

  private parseTracedDecision(
    input: AgentRunInput,
    value: unknown,
    turnId: string | undefined,
  ): TracedDecision {
    try {
      const decision = parseDecision(value);
      input.signal?.throwIfAborted();
      return { decision, ...(turnId === undefined ? {} : { turnId }) };
    } catch (error) {
      recordOutcome(input, turnId, input.signal?.aborted ? "cancelled" : "invalid_response");
      throw error;
    }
  }

  private async finishAfterLoop(
    input: AgentRunInput,
    progress: AgentProgress,
  ): Promise<AgentRunResult> {
    input.signal?.throwIfAborted();
    const continuation = progressEnabled(
      input,
      progress,
      input.promptLibrary ?? defaultPromptLibrary(),
    )
      ? progressContinuationResponse(progress.executions)
      : undefined;
    if (continuation !== undefined) return finishRun(input, progress, continuation);
    if (progress.executions.length < MAX_EXECUTIONS) {
      throw new Error("agent_decision_limit_exceeded");
    }
    const traced = await this.decide(input, progress, true);
    if (traced.decision.action !== "respond") {
      recordOutcome(input, traced.turnId, "invalid_response");
      throw new Error("agent_execution_limit_exceeded");
    }
    recordOutcome(input, traced.turnId, "accepted_response");
    return finishRun(input, progress, traced.decision.response, traced.decision.artifacts ?? []);
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const progress = newProgress();
    let consecutiveDuplicates = 0;
    let revisePlanning = false;
    for (
      let decisionCount = 0;
      decisionCount < MAX_DECISIONS && progress.executions.length < MAX_EXECUTIONS;
      decisionCount += 1
    ) {
      input.signal?.throwIfAborted();
      const traced = await this.decide(input, progress, false, revisePlanning);
      revisePlanning = false;
      if (activateRequestedSkills(input, progress, traced)) continue;
      const rejectedBefore = progress.rejectedDuplicates;
      const turn = await executeTurn({
        executor: this.executor,
        input,
        progress,
        traced,
        consecutiveDuplicates,
      });
      if (turn.result !== undefined) return turn.result;
      revisePlanning = progress.rejectedDuplicates > rejectedBefore;
      consecutiveDuplicates = turn.consecutiveDuplicates;
    }
    return this.finishAfterLoop(input, progress);
  }
}
