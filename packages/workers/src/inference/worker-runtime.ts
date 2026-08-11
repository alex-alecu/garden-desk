import { totalmem } from "node:os";
import type {
  ChatGenerationRequest,
  GenerationContextLimitReason,
  StructuredGenerationRequest,
} from "@vault/shared";
import type {
  Llama,
  LlamaChat,
  LlamaChatSession,
  LlamaEmbeddingContext,
  LlamaModel,
} from "node-llama-cpp";
import {
  combinedAllocationBytes,
  fitCombinedGenerationContext,
  resolveGenerationContextLimit,
  resolveGenerationContextSize,
  resolveRuntimeMemoryBudget,
} from "./memory.js";
import { loadLlamaRuntime } from "./runtime-loader.js";

export interface LoadedRuntime {
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
  chat?: {
    requestedContextSize: ChatGenerationRequest["contextSize"];
    contextSize: number;
    contextLimitTokens: number;
    contextLimitReason: GenerationContextLimitReason;
    chat: LlamaChat;
  };
  embedding?: { contextSize: number; context: LlamaEmbeddingContext };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index === -1 || value === undefined) throw new Error(`Missing ${name}.`);
  return value;
}

let loadedRuntime: Promise<LoadedRuntime> | undefined;

export async function runtime(operation: "generate" | "embed"): Promise<LoadedRuntime> {
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
  request: StructuredGenerationRequest | ChatGenerationRequest,
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

export async function chatSession(request: ChatGenerationRequest, runtime: LoadedRuntime) {
  if (runtime.chat === undefined) {
    const { Gemma4ChatWrapper, LlamaChat } = await import("node-llama-cpp");
    const { context, contextLimit } = await createGenerationContext(request, runtime);
    runtime.chat = {
      requestedContextSize: request.contextSize,
      contextSize: context.contextSize,
      contextLimitTokens: contextLimit.maximumContextTokens,
      contextLimitReason: contextLimit.reason,
      chat: new LlamaChat({
        contextSequence: context.getSequence(),
        ...(request.modelId.startsWith("gemma-4")
          ? { chatWrapper: new Gemma4ChatWrapper({ reasoning: true }) }
          : {}),
      }),
    };
  }
  if (runtime.chat.requestedContextSize !== request.contextSize) {
    throw new Error("worker_context_size_change_unsupported");
  }
  return runtime.chat;
}

export async function generationSession(
  request: StructuredGenerationRequest,
  runtime: LoadedRuntime,
) {
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
