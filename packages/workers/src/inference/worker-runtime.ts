import type {
  ChatGenerationRequest,
  GenerationContextLimitReason,
  StructuredGenerationRequest,
} from "@vault/shared";
import type { LlamaChatSession, LlamaEmbeddingContext, LlamaModel } from "node-llama-cpp";
import { ChatSequencePool } from "./chat-pool.js";
import {
  combinedAllocationBytes,
  fitCombinedGenerationContext,
  resolveGenerationContextLimit,
  resolveGenerationContextSize,
  resolveSequenceCount,
} from "./memory.js";
import { loadSelectedRuntime, type SelectedRuntime } from "./worker-launch.js";

export interface LoadedRuntime extends SelectedRuntime {
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
    pool: ChatSequencePool;
    sequenceCount: number;
  };
  embedding?: { contextSize: number; context: LlamaEmbeddingContext };
}

type ChatRuntime = NonNullable<LoadedRuntime["chat"]>;

let loadedRuntime: Promise<LoadedRuntime> | undefined;

export async function runtime(operation: "generate" | "embed"): Promise<LoadedRuntime> {
  loadedRuntime ??= loadSelectedRuntime(operation);
  return loadedRuntime;
}

async function automaticUnifiedContextSize(
  runtime: LoadedRuntime,
  maximumContextSize: number,
): Promise<number> {
  const modelMemory = await runtime.llama.getLlamaMemoryUsage();
  return fitCombinedGenerationContext(
    runtime.budget,
    { cpuRamBytes: modelMemory.cpuRam, gpuMemoryBytes: modelMemory.gpuVram },
    maximumContextSize,
    async (contextSize) => {
      const estimate = await runtime.model.fileInsights.estimateContextResourceRequirementsV2({
        contextSize,
        modelGpuLayers: runtime.model.gpuLayers,
        flashAttention: runtime.model.defaultContextFlashAttention,
        swaFullCache: runtime.model.defaultContextSwaFullCache,
        useMmap: runtime.model.useMmap,
      });
      return { cpuRamBytes: estimate.cpuRam, gpuMemoryBytes: estimate.gpuVram };
    },
  );
}

async function createGenerationContext(
  request: StructuredGenerationRequest | ChatGenerationRequest,
  runtime: LoadedRuntime,
  sequences = 1,
) {
  const contextLimit = resolveGenerationContextLimit(
    process.platform,
    runtime.installedMemoryBytes,
    runtime.detectedGpuMemoryBytes,
    runtime.gpuMemoryKind,
  );
  const contextSize =
    request.contextSize === "auto" && runtime.gpuMemoryKind === "unified"
      ? await automaticUnifiedContextSize(runtime, contextLimit.maximumContextTokens)
      : resolveGenerationContextSize(request.contextSize, contextLimit.maximumContextTokens);
  const context = await runtime.model.createContext({ contextSize, sequences });
  if (runtime.gpuMemoryKind === "unified") {
    const memory = await runtime.llama.getLlamaMemoryUsage();
    if (
      combinedAllocationBytes({ cpuRamBytes: memory.cpuRam, gpuMemoryBytes: memory.gpuVram }) >
      runtime.budget
    ) {
      await context.dispose();
      throw new Error("combined_memory_budget_exceeded");
    }
  }
  return { context, contextLimit };
}

/**
 * Estimates how many parallel chat sequences fit the memory budget by measuring the marginal
 * cost of one additional sequence: it builds a single-sequence context, reads the combined
 * model-plus-context allocation, and asks {@link resolveSequenceCount} how many extra sequences
 * that per-sequence cost allows without exceeding the budget. Dedicated-memory profiles stay
 * single-sequence because their CPU and GPU allocations do not share one bounded pool.
 */
async function resolveChatSequenceCount(
  context: Awaited<ReturnType<LlamaModel["createContext"]>>,
  runtime: LoadedRuntime,
): Promise<number> {
  if (runtime.gpuMemoryKind !== "unified") return 1;
  const modelMemory = await runtime.llama.getLlamaMemoryUsage();
  const combined = combinedAllocationBytes({
    cpuRamBytes: modelMemory.cpuRam,
    gpuMemoryBytes: modelMemory.gpuVram,
  });
  const perSequenceBytes = await perSequenceContextBytes(context, runtime);
  const modelOnlyBytes = Math.max(0, combined - perSequenceBytes);
  return resolveSequenceCount(runtime.budget, modelOnlyBytes, perSequenceBytes);
}

async function perSequenceContextBytes(
  context: Awaited<ReturnType<LlamaModel["createContext"]>>,
  runtime: LoadedRuntime,
): Promise<number> {
  const estimate = await runtime.model.fileInsights.estimateContextResourceRequirementsV2({
    contextSize: context.contextSize,
    modelGpuLayers: runtime.model.gpuLayers,
    flashAttention: runtime.model.defaultContextFlashAttention,
    swaFullCache: runtime.model.defaultContextSwaFullCache,
    useMmap: runtime.model.useMmap,
  });
  return combinedAllocationBytes({
    cpuRamBytes: estimate.cpuRam,
    gpuMemoryBytes: estimate.gpuVram,
  });
}

let pendingChatRuntime: Promise<ChatRuntime> | undefined;

export async function chatSession(request: ChatGenerationRequest, runtime: LoadedRuntime) {
  if (runtime.chat === undefined) {
    pendingChatRuntime ??= buildChatPool(request, runtime).then((built) => {
      runtime.chat = built;
      return built;
    });
    runtime.chat = await pendingChatRuntime;
  }
  if (runtime.chat.requestedContextSize !== request.contextSize) {
    throw new Error("worker_context_size_change_unsupported");
  }
  return runtime.chat;
}

async function buildChatPool(request: ChatGenerationRequest, runtime: LoadedRuntime) {
  const { Gemma4ChatWrapper, LlamaChat } = await import("node-llama-cpp");
  const probe = await createGenerationContext(request, runtime);
  const sequenceCount = await resolveChatSequenceCount(probe.context, runtime);
  const context =
    sequenceCount === 1
      ? probe.context
      : await recreateContextWithSequences(probe.context, request, runtime, sequenceCount);
  const wrapper = request.modelId.startsWith("gemma-4")
    ? { chatWrapper: new Gemma4ChatWrapper({ reasoning: true }) }
    : {};
  const chats = Array.from(
    { length: context.totalSequences },
    () => new LlamaChat({ contextSequence: context.getSequence(), ...wrapper }),
  );
  return {
    requestedContextSize: request.contextSize,
    contextSize: context.contextSize,
    contextLimitTokens: probe.contextLimit.maximumContextTokens,
    contextLimitReason: probe.contextLimit.reason,
    pool: new ChatSequencePool(chats),
    sequenceCount: context.totalSequences,
  };
}

async function recreateContextWithSequences(
  probeContext: Awaited<ReturnType<LlamaModel["createContext"]>>,
  request: ChatGenerationRequest,
  runtime: LoadedRuntime,
  sequences: number,
) {
  await probeContext.dispose();
  const { context } = await createGenerationContext(request, runtime, sequences);
  return context;
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
