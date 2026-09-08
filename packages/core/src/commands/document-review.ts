import { randomUUID } from "node:crypto";
import { type AgentRunResult, type ChatGenerationResult, JobIdSchema } from "@gardendesk/shared";
import { withCurrentTimeContext } from "../agent/chat-current-time.js";
import type { ChatAgentInput } from "../agent/chat-loop-input.js";
import { streamCallbacks } from "../agent/chat-streaming.js";
import { isSuccessfulExecution } from "../agent/execution-success.js";
import type { InferenceService } from "../runtime/inference.js";
import { inferenceFailureCode } from "../runtime/inference-errors.js";
import type { CommandInvocation } from "./library.js";
import { reviewExtractionSource } from "./review-extraction.js";

async function extractDocument(input: ChatAgentInput) {
  const attachment = input.attachments?.[0];
  if (input.attachments?.length !== 1 || attachment === undefined) {
    throw new Error("agent_review_attachment_required");
  }
  const source = reviewExtractionSource(attachment.path);
  input.onEvent?.("execution.started", "Extracting document text.", { language: "python", source });
  const result = await input.executor.execute(
    { language: "python", path: ".garden-desk-tools/review-extract.py", source },
    input.signal,
  );
  input.onEvent?.("execution.completed", "Document extraction finished.", {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    termination: result.termination,
  });
  if (!isSuccessfulExecution(result)) throw new Error("agent_review_extraction_failed");
  if (result.stdoutTruncated) throw new Error("worker_input_limit_exceeded");
  if (!result.stdout.trim()) throw new Error("agent_review_extraction_failed");
  return { attachment, result };
}

function reviewResponse(result: ChatGenerationResult): string {
  if (result.toolCalls.length > 0) throw new Error("agent_review_tools_unavailable");
  if (result.stopReason === "maxTokens") throw new Error("agent_generation_limit");
  const response = result.text.trim();
  if (!response) throw new Error("agent_empty_response");
  return response;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep one inference call paired with its trace outcome and cleanup.
async function generateReview(
  input: ChatAgentInput,
  chat: InferenceService["chat"],
  request: Parameters<InferenceService["chat"]>[0],
) {
  const identity = { requestId: randomUUID(), jobId: JobIdSchema.parse(randomUUID()) };
  const trace = input.trace;
  const turnId = await trace?.store.begin(trace.runId, "final_response", {
    input: request,
    ...identity,
  });
  let received = false;
  try {
    const result = await chat(request, input.signal, streamCallbacks(input, "chat"), identity);
    received = true;
    input.signal?.throwIfAborted();
    if (turnId !== undefined) {
      await trace?.store.captureResponse(
        turnId,
        {
          text: result.text,
          toolCalls: result.toolCalls,
          stopReason: result.stopReason,
        },
        result.memory.contextSizeTokens,
      );
    }
    const response = reviewResponse(result);
    if (turnId !== undefined) trace?.store.recordOutcome(turnId, "accepted_response");
    return { result, response };
  } catch (error) {
    if (turnId !== undefined)
      trace?.store.recordOutcome(
        turnId,
        input.signal?.aborted ? "cancelled" : received ? "invalid_response" : "inference_failed",
      );
    if (inferenceFailureCode(error) === "invalid_argument")
      throw new Error("agent_review_input_unsupported");
    throw error;
  } finally {
    input.onThinking?.(null);
  }
}

export async function runDocumentReview(
  command: CommandInvocation,
  input: ChatAgentInput,
  chat: InferenceService["chat"],
): Promise<AgentRunResult> {
  const extracted = await extractDocument(input);
  input.signal?.throwIfAborted();
  const request = {
    modelId: input.modelId,
    contextSize: input.contextTokens,
    maxTokens: 4_096,
    temperature: 0,
    tools: [],
    messages: withCurrentTimeContext([
      { role: "system", text: command.body },
      {
        role: "user",
        text: command.arguments || "Review this document for internal inconsistencies.",
      },
      {
        role: "user",
        text: JSON.stringify({
          source: extracted.attachment.displayName,
          extractedText: extracted.result.stdout,
        }),
      },
    ]),
  };
  input.onEvent?.("inference.started", "Reviewing the extracted text.");
  const { result, response } = await generateReview(input, chat, request);
  const allocated = result.memory.contextSizeTokens;
  if (allocated !== undefined) input.onContext?.(result.contextUsedTokens, allocated, true);
  input.onResponse?.(response);
  input.onEvent?.("assistant.completed", "Review completed.");
  const sessionTitle = /^# (Review [^\r\n]+)/u.exec(response)?.[1]?.trim().slice(0, 60);
  return {
    response,
    ...(sessionTitle === undefined ? {} : { sessionTitle }),
    artifacts: [],
    executions: [extracted.result],
    guestExecutions: 1,
    inference: result.performance,
  };
}
