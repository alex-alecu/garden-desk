import { totalmem } from "node:os";
import type {
  EmbeddingRequest,
  GenerationContextLimitReason,
  InferenceWorkerMessage,
  InferenceWorkerRequest,
  InferenceWorkerResponse,
  RequestId,
  StructuredGenerationRequest,
} from "@vault/shared";
import type {
  Llama,
  LlamaChatResponseChunk,
  LlamaChatSession,
  LlamaEmbeddingContext,
  LlamaModel,
  Token,
} from "node-llama-cpp";
import {
  encodeInferenceMessage,
  encodeInferenceResponse,
  InferenceRequestDecoder,
} from "./frames.js";
import {
  combinedAllocationBytes,
  fitCombinedGenerationContext,
  resolveGenerationContextLimit,
  resolveGenerationContextSize,
  resolveRuntimeMemoryBudget,
} from "./memory.js";
import { memoryReport } from "./memory-report.js";
import { probe } from "./probe.js";
import { loadLlamaRuntime } from "./runtime-loader.js";
import { structuredValue } from "./structured.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index === -1 || value === undefined) throw new Error(`Missing ${name}.`);
  return value;
}

function failure(requestId: RequestId, error: unknown): InferenceWorkerResponse {
  const text = error instanceof Error ? error.message : String(error);
  const code =
    text === "supported_gpu_required" ||
    text === "dedicated_gpu_vram_required" ||
    text === "context_size_exceeds_hardware_cap"
      ? "unsupported"
      : /memory|allocation|out of memory/iu.test(text)
        ? "out_of_memory"
        : "internal";
  return {
    protocolVersion: 1,
    requestId,
    status: "error",
    error: { code, message: text },
  };
}

async function embed(
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

interface LoadedRuntime {
  budget: number;
  detectedGpuVramBytes: number;
  llama: Llama;
  model: LlamaModel;
  generation?: {
    requestedContextSize: StructuredGenerationRequest["contextSize"];
    contextSize: number;
    contextLimitTokens: number;
    contextLimitReason: GenerationContextLimitReason;
    session: LlamaChatSession;
  };
  embedding?: { contextSize: number; context: LlamaEmbeddingContext };
}

let loadedRuntime: Promise<LoadedRuntime> | undefined;

async function runtime(operation: "generate" | "embed"): Promise<LoadedRuntime> {
  loadedRuntime ??= (async () => {
    const modelPath = argument("--model");
    const requestedBudget = Number(argument("--memory-budget"));
    if (modelPath === undefined || !Number.isSafeInteger(requestedBudget) || requestedBudget <= 0) {
      throw new Error("Invalid worker launch arguments.");
    }
    const { llama, detectedGpuVramBytes } = await loadLlamaRuntime();
    const budget = resolveRuntimeMemoryBudget(
      requestedBudget,
      detectedGpuVramBytes,
      process.platform,
      operation,
    );
    await llama.setVramCap(budget);
    return {
      budget,
      detectedGpuVramBytes,
      llama,
      model: await llama.loadModel({ modelPath }),
    };
  })();
  return loadedRuntime;
}

async function automaticMacContextSize(
  runtime: LoadedRuntime,
  maximumContextSize: number,
): Promise<number> {
  const modelMemory = await runtime.llama.getLlamaMemoryUsage();
  return fitCombinedGenerationContext(
    runtime.budget,
    { cpuRamBytes: modelMemory.cpuRam, gpuVramBytes: modelMemory.gpuVram },
    maximumContextSize,
    async (contextSize) => {
      const estimate = await runtime.model.fileInsights.estimateContextResourceRequirementsV2({
        contextSize,
        modelGpuLayers: runtime.model.gpuLayers,
        flashAttention: runtime.model.defaultContextFlashAttention,
        swaFullCache: runtime.model.defaultContextSwaFullCache,
        useMmap: runtime.model.useMmap,
      });
      return { cpuRamBytes: estimate.cpuRam, gpuVramBytes: estimate.gpuVram };
    },
  );
}

async function createGenerationContext(
  request: StructuredGenerationRequest,
  runtime: LoadedRuntime,
) {
  const contextLimit = resolveGenerationContextLimit(
    process.platform,
    totalmem(),
    runtime.detectedGpuVramBytes,
  );
  const contextSize =
    request.contextSize === "auto" && process.platform === "darwin"
      ? await automaticMacContextSize(runtime, contextLimit.maximumContextTokens)
      : resolveGenerationContextSize(request.contextSize, contextLimit.maximumContextTokens);
  const context = await runtime.model.createContext({ contextSize });
  if (process.platform === "darwin") {
    const memory = await runtime.llama.getLlamaMemoryUsage();
    if (
      combinedAllocationBytes({ cpuRamBytes: memory.cpuRam, gpuVramBytes: memory.gpuVram }) >
      runtime.budget
    ) {
      await context.dispose();
      throw new Error("combined_memory_budget_exceeded");
    }
  }
  return { context, contextLimit };
}

async function generationSession(request: StructuredGenerationRequest, runtime: LoadedRuntime) {
  if (runtime.generation === undefined) {
    const { Gemma4ChatWrapper, LlamaChatSession } = await import("node-llama-cpp");
    const { context, contextLimit } = await createGenerationContext(request, runtime);
    runtime.generation = {
      requestedContextSize: request.contextSize,
      contextSize: context.contextSize,
      contextLimitTokens: contextLimit.maximumContextTokens,
      contextLimitReason: contextLimit.reason,
      session: new LlamaChatSession({
        contextSequence: context.getSequence(),
        ...(request.modelId.startsWith("gemma-4")
          ? { chatWrapper: new Gemma4ChatWrapper({ reasoning: true }) }
          : {}),
      }),
    };
  }
  if (runtime.generation.requestedContextSize !== request.contextSize) {
    throw new Error("worker_context_size_change_unsupported");
  }
  runtime.generation.session.resetChatHistory();
  return runtime.generation;
}

function performanceReport(input: {
  initial: { usedInputTokens: number; usedOutputTokens: number };
  final: { usedInputTokens: number; usedOutputTokens: number };
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

async function generate(
  request: StructuredGenerationRequest,
  runtime: LoadedRuntime,
  emit: (message: InferenceWorkerMessage) => void,
): Promise<InferenceWorkerResponse> {
  const generation = await generationSession(request, runtime);
  const { session } = generation;
  const initialMeter = session.sequence.tokenMeter.getState();
  const startedAt = performance.now();
  let firstTokenAt: number | undefined;
  const onResponseChunk = (chunk: LlamaChatResponseChunk) => {
    if (chunk.type === "segment" && chunk.segmentType === "thought" && chunk.text.length > 0) {
      emit({
        protocolVersion: 1,
        requestId: request.requestId,
        status: "stream",
        event: "thinking.delta",
        text: chunk.text,
      });
    }
  };
  const onToken = (_tokens: Token[]) => {
    firstTokenAt ??= performance.now();
  };
  const value = await structuredValue(request, runtime.llama, session, {
    onResponseChunk,
    onToken,
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
      firstTokenAt,
      completedAt,
    }),
  };
}

async function infer(
  request: InferenceWorkerRequest,
  emit: (message: InferenceWorkerMessage) => void,
): Promise<InferenceWorkerResponse> {
  if (request.operation === "probe") return probe(request);
  const loaded = await runtime(request.operation);
  // Manual unload terminates the worker so the OS safely reclaims all native resources.
  return request.operation === "embed"
    ? await embed(request, loaded)
    : await generate(request, loaded, emit);
}

let requestId: RequestId = "00000000-0000-4000-8000-000000000000";
const decoder = new InferenceRequestDecoder();
const emit = (message: InferenceWorkerMessage) =>
  process.stdout.write(encodeInferenceMessage(message));
try {
  for await (const chunk of process.stdin) {
    for (const request of decoder.push(Buffer.from(chunk))) {
      requestId = request.requestId;
      try {
        process.stdout.write(encodeInferenceResponse(await infer(request, emit)));
      } catch (error) {
        process.stdout.write(encodeInferenceResponse(failure(requestId, error)));
      }
    }
  }
  decoder.finish();
} catch (error) {
  process.stdout.write(encodeInferenceResponse(failure(requestId, error)));
}
