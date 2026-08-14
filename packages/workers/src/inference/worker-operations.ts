import type {
  ChatGenerationRequest,
  EmbeddingRequest,
  InferenceWorkerMessage,
  InferenceWorkerResponse,
  RequestId,
  StructuredGenerationRequest,
} from "@vault/shared";
import type { LlamaChatResponseChunk, Token } from "node-llama-cpp";
import { generateChatTurn } from "./chat.js";
import { memoryReport } from "./memory-report.js";
import { structuredValue } from "./structured.js";
import { chatSession, generationSession, type LoadedRuntime } from "./worker-runtime.js";

interface TokenMeter {
  usedInputTokens: number;
  usedOutputTokens: number;
}

function performanceReport(input: {
  initial: TokenMeter;
  final: TokenMeter;
  startedAt: number;
  firstTokenAt: number | undefined;
  completedAt: number;
}) {
  const generationStartedAt = input.firstTokenAt ?? input.completedAt;
  return {
    promptTokens: input.final.usedInputTokens - input.initial.usedInputTokens,
    outputTokens: input.final.usedOutputTokens - input.initial.usedOutputTokens,
    promptDurationMs: Math.max(0, Math.round(generationStartedAt - input.startedAt)),
    generationDurationMs: Math.max(0, Math.round(input.completedAt - generationStartedAt)),
    totalDurationMs: Math.max(0, Math.round(input.completedAt - input.startedAt)),
  };
}

export function generationCallbacks(
  requestId: RequestId,
  emit: (message: InferenceWorkerMessage) => void,
  streamResponseText = false,
) {
  let firstTokenAt: number | undefined;
  return {
    onResponseChunk(chunk: LlamaChatResponseChunk) {
      if (chunk.type === "segment" && chunk.segmentType === "thought" && chunk.text.length > 0) {
        emit({
          protocolVersion: 1,
          requestId,
          status: "stream",
          event: "thinking.delta",
          text: chunk.text,
        });
      }
      if (streamResponseText && chunk.type === undefined && chunk.text.length > 0) {
        emit({
          protocolVersion: 1,
          requestId,
          status: "stream",
          event: "response.delta",
          text: chunk.text,
        });
      }
    },
    onToken(_tokens: Token[]) {
      firstTokenAt ??= performance.now();
    },
    firstTokenAt: () => firstTokenAt,
  };
}

export async function embed(
  request: EmbeddingRequest,
  runtime: LoadedRuntime,
): Promise<InferenceWorkerResponse> {
  runtime.embedding ??= {
    contextSize: request.contextSize,
    context: await runtime.model.createEmbeddingContext({ contextSize: request.contextSize }),
  };
  if (runtime.embedding.contextSize !== request.contextSize) {
    throw new Error("worker_context_size_change_unsupported");
  }
  const embedding = await runtime.embedding.context.getEmbeddingFor(request.input);
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    status: "ok",
    operation: "embed",
    vector: Array.from(embedding.vector),
    memory: await memoryReport(runtime, request.contextSize),
  };
}

export async function generate(
  request: StructuredGenerationRequest,
  runtime: LoadedRuntime,
  emit: (message: InferenceWorkerMessage) => void,
  signal?: AbortSignal,
): Promise<InferenceWorkerResponse> {
  const generation = await generationSession(request, runtime);
  const { session } = generation;
  const initialMeter = session.sequence.tokenMeter.getState();
  const startedAt = performance.now();
  const callbacks = generationCallbacks(request.requestId, emit);
  const value = await structuredValue({
    request,
    llama: runtime.llama,
    session,
    callbacks,
    ...(signal === undefined ? {} : { signal }),
  });
  const completedAt = performance.now();
  const finalMeter = session.sequence.tokenMeter.getState();
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    status: "ok",
    operation: "generate",
    value,
    memory: await memoryReport(runtime, session.sequence.contextSize, {
      tokens: generation.contextLimitTokens,
      reason: generation.contextLimitReason,
    }),
    performance: performanceReport({
      initial: initialMeter,
      final: finalMeter,
      startedAt,
      firstTokenAt: callbacks.firstTokenAt(),
      completedAt,
    }),
  };
}

export async function chat(
  request: ChatGenerationRequest,
  runtime: LoadedRuntime,
  emit: (message: InferenceWorkerMessage) => void,
  signal?: AbortSignal,
): Promise<InferenceWorkerResponse> {
  const session = await chatSession(request, runtime);
  return await session.pool.use(async (chat) => {
    const initialMeter = chat.sequence.tokenMeter.getState();
    const startedAt = performance.now();
    const callbacks = generationCallbacks(request.requestId, emit, true);
    const turn = await generateChatTurn(request, chat, callbacks, signal);
    const completedAt = performance.now();
    const finalMeter = chat.sequence.tokenMeter.getState();
    return {
      protocolVersion: 1,
      requestId: request.requestId,
      status: "ok",
      operation: "chat",
      text: turn.text,
      toolCalls: turn.toolCalls,
      stopReason: turn.stopReason,
      memory: await memoryReport(runtime, chat.sequence.contextSize, {
        tokens: session.contextLimitTokens,
        reason: session.contextLimitReason,
        sequenceCount: session.sequenceCount,
      }),
      performance: performanceReport({
        initial: initialMeter,
        final: finalMeter,
        startedAt,
        firstTokenAt: callbacks.firstTokenAt(),
        completedAt,
      }),
    };
  });
}
