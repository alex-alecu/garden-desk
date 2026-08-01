import { totalmem } from "node:os";
import type {
  EmbeddingRequest,
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
  resolveGenerationContextSize,
  resolveMaximumGenerationContext,
  resolveRuntimeMemoryBudget,
} from "./memory.js";
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
    text === "supported_gpu_required" || text === "context_size_exceeds_hardware_cap"
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
    session: LlamaChatSession;
  };
  embedding?: { contextSize: number; context: LlamaEmbeddingContext };
}

let loadedRuntime: Promise<LoadedRuntime> | undefined;

async function memoryReport(runtime: LoadedRuntime, contextSizeTokens: number) {
  const memory = await runtime.llama.getLlamaMemoryUsage();
  return {
    cpuRamBytes: memory.cpuRam,
    gpuVramBytes: memory.gpuVram,
    budgetBytes: runtime.budget,
    detectedGpuVramBytes: runtime.detectedGpuVramBytes,
    contextSizeTokens,
  };
}

async function runtime(operation: "generate" | "embed"): Promise<LoadedRuntime> {
  loadedRuntime ??= (async () => {
    const modelPath = argument("--model");
    const requestedBudget = Number(argument("--memory-budget"));
    if (modelPath === undefined || !Number.isSafeInteger(requestedBudget) || requestedBudget <= 0) {
      throw new Error("Invalid worker launch arguments.");
    }
    const llama = await loadLlamaRuntime();
    const vram = await llama.getVramState();
    const budget = resolveRuntimeMemoryBudget(
      requestedBudget,
      vram.total,
      process.platform,
      operation,
    );
    await llama.setVramCap(budget);
    return {
      budget,
      detectedGpuVramBytes: vram.total,
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
  const maximumContextSize = resolveMaximumGenerationContext(
    process.platform,
    totalmem(),
    runtime.detectedGpuVramBytes,
  );
  const contextSize =
    request.contextSize === "auto" && process.platform === "darwin"
      ? await automaticMacContextSize(runtime, maximumContextSize)
      : resolveGenerationContextSize(request.contextSize, maximumContextSize);
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
  return context;
}

async function generationSession(request: StructuredGenerationRequest, runtime: LoadedRuntime) {
  if (runtime.generation === undefined) {
    const { Gemma4ChatWrapper, LlamaChatSession } = await import("node-llama-cpp");
    const context = await createGenerationContext(request, runtime);
    runtime.generation = {
      requestedContextSize: request.contextSize,
      contextSize: context.contextSize,
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
  return runtime.generation.session;
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
  const session = await generationSession(request, runtime);
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
    memory: await memoryReport(runtime, session.sequence.contextSize),
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
  // Native resources remain process-scoped. Manual unload terminates this worker so the OS
  // reclaims the model and contexts together instead of relying on unsafe partial teardown.
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
