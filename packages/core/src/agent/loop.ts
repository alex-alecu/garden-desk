import {
  type AgentDecision,
  type AgentEventDetail,
  type AgentEventType,
  type AgentExecutionResult,
  type AgentInferenceOutcome,
  type AgentRunResult,
  AgentRunResultSchema,
  type StructuredGenerationResult,
} from "@vault/shared";
import type { AgentSessionExecution } from "@vault/workers";
import type { InferenceService } from "../runtime/inference.js";
import { createGenerationRequest } from "../runtime/inference.js";
import { addPerformance, emptyPerformance } from "./inference-performance.js";
import { rejectedExecutionReason } from "./loop-decisions.js";
import { executeAgentDecision, rejectExecution } from "./loop-execution.js";
import { structuredRetryInput } from "./loop-retry.js";
import { xlsxContinuationResponse } from "./output-contract.js";
import {
  type AgentProgress,
  type AgentPromptInput,
  executionBackedResponse,
  type GenerationRecovery,
  generationInput,
  MAX_EXECUTIONS,
  parseDecision,
  requiresXlsxWorkflow,
} from "./prompt.js";
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

interface TracedDecision {
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
  ): Promise<TracedDecision> {
    const { executions, inference } = progress;
    input.onEvent?.(
      "inference.started",
      finalResponse
        ? "Preparing the final response."
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
      this.recordOutcome(input, turnId, input.signal?.aborted ? "cancelled" : "inference_failed");
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
      this.recordOutcome(input, turnId, input.signal?.aborted ? "cancelled" : "invalid_response");
      throw error;
    }
  }

  private recordOutcome(
    input: AgentRunInput,
    turnId: string | undefined,
    outcome: AgentInferenceOutcome,
    executionSequence?: number,
  ): void {
    if (turnId !== undefined) input.trace?.store.recordOutcome(turnId, outcome, executionSequence);
  }

  private finish(input: AgentRunInput, progress: AgentProgress, response: string): AgentRunResult {
    input.onEvent?.("assistant.completed", "Response completed.");
    return AgentRunResultSchema.parse({
      response: executionBackedResponse(input, progress, response),
      ...progress,
    });
  }

  private async finishAfterLoop(
    input: AgentRunInput,
    progress: AgentProgress,
  ): Promise<AgentRunResult> {
    input.signal?.throwIfAborted();
    const continuation = xlsxContinuationResponse(progress.executions);
    if (continuation !== undefined) return this.finish(input, progress, continuation);
    if (progress.executions.length < MAX_EXECUTIONS) {
      throw new Error("agent_decision_limit_exceeded");
    }
    const traced = await this.decide(input, progress, true);
    if (traced.decision.action !== "respond") {
      this.recordOutcome(input, traced.turnId, "invalid_response");
      throw new Error("agent_execution_limit_exceeded");
    }
    this.recordOutcome(input, traced.turnId, "accepted_response");
    return this.finish(input, progress, traced.decision.response);
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const progress: AgentProgress = {
      executions: [],
      inference: emptyPerformance(),
      rejectedDuplicates: 0,
    };
    let consecutiveDuplicates = 0;
    for (
      let decisionCount = 0;
      decisionCount < MAX_DECISIONS && progress.executions.length < MAX_EXECUTIONS;
      decisionCount += 1
    ) {
      input.signal?.throwIfAborted();
      const traced = await this.decide(input, progress);
      const { decision } = traced;
      if (decision.action === "respond") {
        this.recordOutcome(input, traced.turnId, "accepted_response");
        return this.finish(input, progress, decision.response);
      }
      const rejection = rejectedExecutionReason(
        decision,
        progress.executions,
        requiresXlsxWorkflow(input, progress.executions),
        input.task,
      );
      if (rejection !== undefined) {
        consecutiveDuplicates = rejectExecution(input, progress, {
          consecutive: consecutiveDuplicates,
          reason: rejection,
          turnId: traced.turnId,
        });
        continue;
      }
      consecutiveDuplicates = 0;
      progress.lastRejectedProgramReason = undefined;
      this.recordOutcome(input, traced.turnId, "accepted_execution", progress.executions.length);
      await executeAgentDecision(this.executor, input, decision, progress);
      const verifiedResponse = executionBackedResponse(input, progress, "");
      if (verifiedResponse.length > 0) return this.finish(input, progress, verifiedResponse);
    }
    return this.finishAfterLoop(input, progress);
  }
}
